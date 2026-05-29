const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'jobguard-super-secret-dev-key-12345';
const OTP_EXPIRY_MS = 3 * 60 * 1000;       // 3 minutes
const OTP_RATE_LIMIT_MS = 10 * 60 * 1000;  // 10 minutes
const MAX_OTP_REQUESTS = 3;
const MAX_OTP_ATTEMPTS = 3;

const OTP_SALT = process.env.OTP_SALT || 'jobguard-otp-salt-9876';

function hashOtp(otp) {
  return crypto.createHmac('sha256', OTP_SALT).update(otp).digest('hex');
}

const auth = {

  // -----------------------------------------------------------------------
  // Request OTP for Email (async — db operations are now MongoDB)
  // -----------------------------------------------------------------------
  async requestOtp(email) {
    const cleanEmail = email.toLowerCase();

    // User must be registered first
    const user = await db.getUser(cleanEmail);
    if (!user) {
      return { success: false, status: 404, message: 'Email not registered. Please sign up first.' };
    }

    // Rate limit check
    const existingOtp = await db.getOtp(cleanEmail);
    const now = Date.now();

    if (existingOtp) {
      const recentRequests = existingOtp.requestTimes.filter(t => now - t < OTP_RATE_LIMIT_MS);
      if (recentRequests.length >= MAX_OTP_REQUESTS) {
        const oldestRequest = recentRequests[0];
        const waitTimeMinutes = Math.ceil((OTP_RATE_LIMIT_MS - (now - oldestRequest)) / (60 * 1000));
        return {
          success: false,
          status: 429,
          message: `Too many OTP requests. Please wait ${waitTimeMinutes} minute(s) before trying again.`
        };
      }
    }

    // Generate secure 6-digit OTP using CSPRNG
    const otp = crypto.randomInt(100000, 999999).toString();
    const hash = hashOtp(otp);
    const expiresAt = now + OTP_EXPIRY_MS;

    await db.saveOtp(cleanEmail, hash, expiresAt);

    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      console.log(`[DEV MODE] OTP for ${cleanEmail} is: ${otp}`);
      // Store the raw OTP temporarily in memory for the admin diagnostics endpoint to query
      if (!global.devOtps) global.devOtps = {};
      global.devOtps[cleanEmail] = otp;
    }

    return {
      success: true,
      otp,
      showOtpInResponse: isDev,
      message: 'OTP sent successfully. Please check your email inbox.'
    };
  },

  // -----------------------------------------------------------------------
  // Verify OTP (async)
  // -----------------------------------------------------------------------
  async verifyOtp(email, otp) {
    const cleanEmail = email.toLowerCase();
    const otpRecord = await db.getOtp(cleanEmail);
    const now = Date.now();

    if (!otpRecord) {
      return { success: false, status: 400, message: 'No active OTP session found. Please request a new OTP.' };
    }

    if (now > otpRecord.expiresAt) {
      await db.deleteOtp(cleanEmail);
      return { success: false, status: 400, message: 'OTP has expired. Please request a new code.' };
    }

    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      await db.deleteOtp(cleanEmail);
      return { success: false, status: 403, message: 'Too many failed attempts. This OTP has been invalidated. Please request a new one.' };
    }

    const enteredHash = hashOtp(otp);
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(otpRecord.hash, 'hex'),
      Buffer.from(enteredHash, 'hex')
    );

    if (isMatch) {
      await db.deleteOtp(cleanEmail);
      const user = await db.getUser(cleanEmail);

      const token = jwt.sign(
        { email: user.email, name: user.name, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return {
        success: true,
        token,
        user: {
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone || '',
          points: user.points
        }
      };
    } else {
      const newAttempts = otpRecord.attempts + 1;
      await db.updateOtp(cleanEmail, { attempts: newAttempts });

      if (newAttempts >= MAX_OTP_ATTEMPTS) {
        await db.deleteOtp(cleanEmail);
        return {
          success: false,
          status: 403,
          message: 'Too many failed attempts. This OTP has been invalidated. Please request a new one.'
        };
      }

      const remaining = MAX_OTP_ATTEMPTS - newAttempts;
      return {
        success: false,
        status: 400,
        message: `Incorrect code. You have ${remaining} attempt(s) remaining.`
      };
    }
  },

  // -----------------------------------------------------------------------
  // Register User (async)
  // -----------------------------------------------------------------------
  async registerUser(name, email, role, phone) {
    const cleanEmail = email.toLowerCase();

    if (!name || name.trim().length < 2) {
      return { success: false, status: 400, message: 'Name must be at least 2 characters long.' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(cleanEmail)) {
      return { success: false, status: 400, message: 'Invalid email address format.' };
    }

    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
      return {
        success: false,
        status: 400,
        message: 'Invalid phone number format. Must start with \'+\' and include country code (e.g. +919876543210).'
      };
    }

    if (!role || !['Job Seeker', 'Community Verifier'].includes(role)) {
      return { success: false, status: 400, message: 'Invalid user role.' };
    }

    const existing = await db.getUser(cleanEmail);
    if (existing) {
      return { success: false, status: 400, message: 'Email is already registered. Please login.' };
    }

    try {
      const user = await db.createUser({ name, email: cleanEmail, role, phone });
      return {
        success: true,
        user: {
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone || '',
          points: user.points
        },
        message: 'Registration successful! You can now request an OTP to log in.'
      };
    } catch (err) {
      return { success: false, status: 500, message: 'Database registration failed. Please try again.' };
    }
  },

  // -----------------------------------------------------------------------
  // JWT Middleware (sync — no db call needed)
  // -----------------------------------------------------------------------
  authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Access denied. Authentication token missing.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ message: 'Invalid or expired session token.' });
      }
      req.user = decoded;
      next();
    });
  }
};

module.exports = auth;
