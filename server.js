const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const https = require('https');
const querystring = require('querystring');
const { connectDb, ...db } = require('./db');
const auth = require('./auth');

// Manually load .env file for local development if it exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?[\s]*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value.trim();
    }
  });
  console.log('.env configuration file loaded successfully.');
}

const app = express();
const PORT = process.env.PORT || 8080;

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const IS_PROD = process.env.NODE_ENV === 'production';

// ==========================================================================
// SECURITY HEADERS (OWASP)
// ==========================================================================
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================================================
// NODEMAILER SMTP TRANSPORTER
// ==========================================================================
let mailTransporter = null;

function buildTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[SMTP] No SMTP credentials found — email delivery is DISABLED.');
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT) || 587;
  const isSecure = port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: isSecure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    // Prevent hanging connections — hard timeout after 15s
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      rejectUnauthorized: IS_PROD // Strict in prod, lenient in dev
    }
  });

  console.log(`[SMTP] Transporter configured — host: ${process.env.SMTP_HOST}, port: ${port}, secure: ${isSecure}`);
  return transporter;
}

// Helper: send OTP email with a hard 12-second timeout to prevent server hang
async function sendOtpEmail(email, otp) {
  if (!mailTransporter) return false;

  const senderEmail = process.env.SENDGRID_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;

  const sendPromise = mailTransporter.sendMail({
    from: `"JobGuard Security" <${senderEmail}>`,
    to: email,
    subject: 'Your JobGuard Verification Code',
    text: `Your verification code is: ${otp}. It is valid for 3 minutes. If you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #0f172a; color: #f8fafc;">
        <h2 style="color: #4f46e5; text-align: center;">JobGuard Authentication</h2>
        <hr style="border: 0; border-top: 1px solid #334155; margin: 20px 0;"/>
        <p style="font-size: 16px; line-height: 1.5;">Hi,</p>
        <p style="font-size: 16px; line-height: 1.5;">Your JobGuard verification code is:</p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 12px 24px; background-color: #1e293b; border-radius: 6px; border: 1px solid #4f46e5; color: #38bdf8;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #94a3b8; line-height: 1.5;">This code will expire in <strong>3 minutes</strong>. If you did not request this verification code, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #334155; margin: 20px 0;"/>
        <p style="font-size: 12px; text-align: center; color: #64748b;">JobGuard Scam Aggregator &amp; Job Tracker</p>
      </div>
    `
  });

  // Race against a 12-second timeout — never let SMTP hang the server
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('SMTP send timed out after 12 seconds')), 12000)
  );

  try {
    await Promise.race([sendPromise, timeoutPromise]);
    console.log(`[SMTP] Email sent successfully to ${email}`);
    return true;
  } catch (err) {
    console.error('[SMTP] Failed to send OTP email details:', err);
    return false;
  }
}

// Helper: send Twilio SMS
async function sendTwilioSms(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return false;
  }

  return new Promise((resolve) => {
    const postData = querystring.stringify({ To: to, From: fromNumber, Body: body });
    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Twilio] SMS sent to ${to}`);
          resolve(true);
        } else {
          console.error(`[Twilio] Error (HTTP ${res.statusCode}):`, body);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error('[Twilio] Connection failed:', e);
      resolve(false);
    });

    req.setTimeout(10000, () => {
      console.error('[Twilio] Request timed out');
      req.destroy();
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

// Admin key middleware
function checkAdminKey(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return next(); // Dev convenience — no key set = open
  const providedKey = req.query.key || req.headers['x-admin-key'];
  if (providedKey !== adminKey) {
    return res.status(403).json({ message: 'Forbidden. Invalid admin key.' });
  }
  next();
}

/* ==========================================================================
   AUTH API ENDPOINTS
   ========================================================================== */

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, role, phone } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ message: 'Name, email, and role are required.' });
  }
  try {
    const result = await auth.registerUser(name, email, role, phone);
    if (!result.success) {
      return res.status(result.status || 500).json({ message: result.message });
    }
    return res.status(201).json(result);
  } catch (err) {
    console.error('[Register] Unexpected error:', err);
    return res.status(500).json({ message: 'Internal server error during registration.' });
  }
});

// POST /api/auth/request-otp
app.post('/api/auth/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  try {
    const result = await auth.requestOtp(email);
    if (!result.success) {
      return res.status(result.status || 500).json({ message: result.message });
    }

    const user = await db.getUser(email);
    let sentRealEmail = false;
    let sentRealSms = false;

    if (result.otp) {
      sentRealEmail = await sendOtpEmail(email, result.otp);

      if (user && user.phone) {
        sentRealSms = await sendTwilioSms(
          user.phone,
          `Your JobGuard verification code is: ${result.otp}. It expires in 3 minutes.`
        );
      }
    }

    // In production: if SMTP is configured but email failed to send, return an error.
    // This prevents users from being stuck with no code and no feedback.
    if (IS_PROD && mailTransporter && !sentRealEmail && !sentRealSms) {
      console.error(`[OTP] Email delivery failed for ${email} in production mode.`);
      return res.status(503).json({
        message: 'Email delivery failed. Please wait a moment and try again, or contact support if the issue persists.'
      });
    }

    return res.status(200).json({
      message: result.message,
      otp: result.showOtpInResponse && !sentRealEmail ? result.otp : undefined,
      emailSent: sentRealEmail,
      smsSent: sentRealSms,
      simulated: !sentRealEmail && !sentRealSms
    });
  } catch (err) {
    console.error('[RequestOTP] Unexpected error:', err);
    return res.status(500).json({ message: 'Internal server error. Please try again.' });
  }
});

// POST /api/auth/verify-otp
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP code are required.' });
  }
  try {
    const result = await auth.verifyOtp(email, otp);
    if (!result.success) {
      return res.status(result.status || 500).json({ message: result.message });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[VerifyOTP] Unexpected error:', err);
    return res.status(500).json({ message: 'Internal server error. Please try again.' });
  }
});

/* ==========================================================================
   ADMIN API ENDPOINTS
   ========================================================================== */

// GET /api/admin/users
app.get('/api/admin/users', checkAdminKey, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    return res.status(200).json({
      count: users.length,
      users: users.map(u => ({
        email: u.email,
        name: u.name,
        role: u.role,
        phone: u.phone,
        createdAt: u.createdAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to retrieve users.' });
  }
});

// DELETE /api/admin/users/:email
app.delete('/api/admin/users/:email', checkAdminKey, async (req, res) => {
  const emailToDelete = decodeURIComponent(req.params.email).toLowerCase();
  try {
    const deleted = await db.deleteUser(emailToDelete);
    if (!deleted) {
      return res.status(404).json({ message: `User '${emailToDelete}' not found in database.` });
    }
    const remaining = await db.getAllUsers();
    return res.status(200).json({
      message: `User '${emailToDelete}' deleted successfully.`,
      remainingUsers: remaining.length
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete user.' });
  }
});

// GET /api/admin/diagnostics
app.get('/api/admin/diagnostics', checkAdminKey, (req, res) => {
  return res.status(200).json({
    nodeEnv: process.env.NODE_ENV,
    smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    smtpHost: process.env.SMTP_HOST || 'NOT SET',
    smtpPort: process.env.SMTP_PORT || 'NOT SET',
    smtpUser: process.env.SMTP_USER ? '***configured***' : 'NOT SET',
    senderEmail: process.env.SENDGRID_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER || 'NOT SET',
    twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    mailTransporterActive: !!mailTransporter,
    mongoConnected: true, // If this endpoint is reachable, DB is connected
    dbType: 'MongoDB Atlas'
  });
});

// GET /api/admin/otps (Only in dev or if authenticated with ADMIN_KEY)
app.get('/api/admin/otps', checkAdminKey, async (req, res) => {
  try {
    const list = await db.getDb().collection('otps').find({}).toArray();
    const merged = list.map(item => {
      const copy = { ...item };
      if (global.devOtps && global.devOtps[copy.email]) {
        copy.otp = global.devOtps[copy.email];
      }
      return copy;
    });
    return res.status(200).json(merged);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to retrieve OTP records.' });
  }
});

// GET /api/admin/test-email — smoke-test email delivery without needing a real user
app.get('/api/admin/test-email', checkAdminKey, async (req, res) => {
  const to = req.query.to;
  if (!to) {
    return res.status(400).json({ message: 'Provide ?to=email@example.com to test delivery.' });
  }

  const testOtp = '123456';
  const sent = await sendOtpEmail(to, testOtp);
  if (sent) {
    return res.status(200).json({ message: `Test email sent to ${to}`, emailSent: true });
  } else {
    return res.status(503).json({
      message: 'Test email delivery failed. Check SMTP configuration.',
      emailSent: false,
      smtpConfigured: !!mailTransporter,
      smtpHost: process.env.SMTP_HOST || 'NOT SET'
    });
  }
});

/* ==========================================================================
   USER API ENDPOINTS (AUTHENTICATED)
   ========================================================================== */

// GET /api/user/profile
app.get('/api/user/profile', auth.authenticateToken, async (req, res) => {
  try {
    const user = await db.getUser(req.user.email);
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.status(200).json({
      email: user.email,
      name: user.name,
      role: user.role,
      points: user.points
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch profile.' });
  }
});

// POST /api/user/points
app.post('/api/user/points', auth.authenticateToken, async (req, res) => {
  const { amount } = req.body;
  if (amount === undefined || typeof amount !== 'number') {
    return res.status(400).json({ message: 'Points amount is required and must be a number.' });
  }
  try {
    const user = await db.getUser(req.user.email);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const updatedUser = await db.updateUser(req.user.email, { points: user.points + amount });
    return res.status(200).json({ points: updatedUser.points, message: `Earned +${amount} verification points!` });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update points.' });
  }
});

/* ==========================================================================
   APPLICATION CRM ENDPOINTS (AUTHENTICATED)
   ========================================================================== */

// GET /api/applications
app.get('/api/applications', auth.authenticateToken, async (req, res) => {
  try {
    const list = await db.getApplications(req.user.email);
    return res.status(200).json(list);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch applications.' });
  }
});

// POST /api/applications
app.post('/api/applications', auth.authenticateToken, async (req, res) => {
  const appData = req.body;
  if (!appData.title || !appData.company) {
    return res.status(400).json({ message: 'Job title and company name are required.' });
  }
  try {
    const newApp = await db.saveApplication(req.user.email, appData);
    return res.status(201).json(newApp);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to save application.' });
  }
});

// PUT /api/applications/:id
app.put('/api/applications/:id', auth.authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await db.updateApplication(req.user.email, id, req.body);
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
});

// DELETE /api/applications/:id
app.delete('/api/applications/:id', auth.authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.deleteApplication(req.user.email, id);
    return res.status(200).json({ message: 'Application archived successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete application.' });
  }
});

/* ==========================================================================
   COMMUNITY ENDPOINTS
   ========================================================================== */

// GET /api/discussions
app.get('/api/discussions', async (req, res) => {
  try {
    return res.status(200).json(await db.getDiscussions());
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch discussions.' });
  }
});

// POST /api/discussions
app.post('/api/discussions', auth.authenticateToken, async (req, res) => {
  const { title, content, tag } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: 'Discussion title and content are required.' });
  }
  try {
    const user = await db.getUser(req.user.email);
    const post = await db.addDiscussion(req.user.email, user.name, user.role, { title, content, tag });
    return res.status(201).json(post);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to post discussion.' });
  }
});

// POST /api/discussions/:id/upvote
app.post('/api/discussions/:id/upvote', auth.authenticateToken, async (req, res) => {
  try {
    const post = await db.upvoteDiscussion(req.params.id, req.user.email);
    return res.status(200).json(post);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
});

// POST /api/discussions/:id/reply
app.post('/api/discussions/:id/reply', auth.authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ message: 'Reply content cannot be blank.' });
  }
  try {
    const user = await db.getUser(req.user.email);
    const post = await db.addReply(req.params.id, user.name, content);
    return res.status(201).json(post);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
});

// GET /api/scam-alerts
app.get('/api/scam-alerts', async (req, res) => {
  try {
    return res.status(200).json(await db.getScamAlerts());
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch scam alerts.' });
  }
});

// POST /api/scam-alerts
app.post('/api/scam-alerts', auth.authenticateToken, async (req, res) => {
  const alertData = req.body;
  if (!alertData.title || !alertData.company) {
    return res.status(400).json({ message: 'Job title and company name are required for reporting.' });
  }
  try {
    const newAlert = await db.addScamAlert(alertData);
    return res.status(201).json(newAlert);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to add scam alert.' });
  }
});

/* ==========================================================================
   SPA FALLBACK
   ========================================================================== */
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ==========================================================================
   SERVER STARTUP — Connect to MongoDB first, then start accepting requests
   ========================================================================== */
async function startServer() {
  console.log('===============================================');
  console.log(' JobGuard — Starting up...');
  console.log(` Environment: ${process.env.NODE_ENV}`);
  console.log('===============================================');

  // 1. Connect to MongoDB Atlas (fail fast if unreachable)
  try {
    await connectDb();
  } catch (err) {
    console.error('[FATAL] Could not connect to MongoDB:', err.message);
    console.error('Ensure MONGODB_URI is set correctly in your .env or Render dashboard.');
    process.exit(1);
  }

  // 2. Build SMTP transporter and verify connection
  mailTransporter = buildTransporter();
  if (mailTransporter) {
    mailTransporter.verify((err) => {
      if (err) {
        console.error('[SMTP] ⚠️  SMTP verification FAILED:', err.message);
        console.error('[SMTP] OTP emails will NOT be delivered. Check credentials.');
      } else {
        console.log('[SMTP] ✅ SMTP connection verified — email delivery is operational.');
      }
    });
  }

  // 3. Start HTTP server
  app.listen(PORT, () => {
    console.log('===============================================');
    console.log(` JobGuard Server Running!`);
    console.log(` Port: ${PORT}`);
    console.log(` DB:   MongoDB Atlas`);
    console.log('===============================================');
  });
}

startServer();
