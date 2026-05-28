const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const https = require('https');
const querystring = require('querystring');
const db = require('./db');
const auth = require('./auth');

// Manually load .env file for local development if it exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Remove quotes
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value.trim();
    }
  });
  console.log(".env configuration file loaded successfully.");
}

const app = express();
const PORT = process.env.PORT || 8080;

// Set development mode env if not specified
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

// OWASP Security Headers Middleware
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Enforce HSTS in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
});

// JSON and URL-encoded body parsers with size limits to prevent DOS
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Email Transporter (Nodemailer) setup
let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  const isSecure = process.env.SMTP_PORT === '465' || process.env.SMTP_SECURE === 'true';
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: isSecure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  console.log("Nodemailer SMTP Transporter configured. Secure:", isSecure);
} else {
  console.log("Nodemailer: No SMTP credentials found. Defaulting to Console/API response logging in development.");
}

// Helper to send actual email if configured
async function sendOtpEmail(email, otp) {
  if (!mailTransporter) return false;
  try {
    const senderEmail = process.env.SENDGRID_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    await mailTransporter.sendMail({
      from: `"JobGuard Security" <${senderEmail}>`,
      to: email,
      subject: "Your JobGuard Verification Code",
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
          <p style="font-size: 12px; text-align: center; color: #64748b;">JobGuard Scam Aggregator & Job Tracker</p>
        </div>
      `
    });
    return true;
  } catch (err) {
    console.error("Failed to send OTP email via SMTP:", err);
    return false;
  }
}

// Helper to send actual SMS via Twilio using native HTTPS module (zero-dependency)
async function sendTwilioSms(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log("Twilio SMS: Credentials missing from environment. Skipping SMS delivery.");
    return false;
  }

  return new Promise((resolve) => {
    const postData = querystring.stringify({
      To: to,
      From: fromNumber,
      Body: body
    });

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
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Twilio: SMS successfully sent to ${to}`);
          resolve(true);
        } else {
          console.error(`Twilio error (HTTP ${res.statusCode}):`, responseBody);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error("Twilio connection failed:", e);
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

/* =========================================================================
   AUTH API ENDPOINTS
   ========================================================================= */

// POST /api/auth/register - Signup Route
app.post('/api/auth/register', (req, res) => {
  const { name, email, role, phone } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ message: "Name, email, and role are required." });
  }
  const result = auth.registerUser(name, email, role, phone);
  if (!result.success) {
    return res.status(result.status || 500).json({ message: result.message });
  }
  return res.status(201).json(result);
});

// POST /api/auth/request-otp - Send OTP Route
app.post('/api/auth/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }
  
  const result = auth.requestOtp(email);
  if (!result.success) {
    return res.status(result.status || 500).json({ message: result.message });
  }

  const user = db.getUser(email);
  let sentRealEmail = false;
  let sentRealSms = false;
  
  if (result.otp) { // Available in dev or prod (it generates the code)
    // Send email via SendGrid (Nodemailer)
    sentRealEmail = await sendOtpEmail(email, result.otp);
    
    // Send SMS via Twilio if user has registered a phone number
    if (user && user.phone) {
      sentRealSms = await sendTwilioSms(user.phone, `Your JobGuard verification code is: ${result.otp}. It expires in 3 minutes.`);
    }
  }

  return res.status(200).json({
    message: result.message,
    otp: process.env.NODE_ENV === 'development' && !sentRealEmail ? result.otp : undefined,
    emailSent: sentRealEmail,
    smsSent: sentRealSms,
    simulated: !sentRealEmail && !sentRealSms
  });
});

// POST /api/auth/verify-otp - Verify OTP and login
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP code are required." });
  }
  
  const result = auth.verifyOtp(email, otp);
  if (!result.success) {
    return res.status(result.status || 500).json({ message: result.message });
  }
  return res.status(200).json(result);
});

/* =========================================================================
   USER API ENDPOINTS (AUTHENTICATED)
   ========================================================================= */

// GET /api/user/profile - Get profile data
app.get('/api/user/profile', auth.authenticateToken, (req, res) => {
  const user = db.getUser(req.user.email);
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.status(200).json({
    email: user.email,
    name: user.name,
    role: user.role,
    points: user.points
  });
});

// POST /api/user/points - Reward points (e.g. for crowdsourced votes)
app.post('/api/user/points', auth.authenticateToken, (req, res) => {
  const { amount } = req.body;
  if (amount === undefined || typeof amount !== 'number') {
    return res.status(400).json({ message: "Points amount is required and must be a number." });
  }
  
  const user = db.getUser(req.user.email);
  if (!user) return res.status(404).json({ message: "User not found" });

  const updatedUser = db.updateUser(req.user.email, { points: user.points + amount });
  return res.status(200).json({
    points: updatedUser.points,
    message: `Earned +${amount} verification points!`
  });
});

/* =========================================================================
   APPLICATION CRM ENDPOINTS (AUTHENTICATED)
   ========================================================================= */

// GET /api/applications - Get all applications for the user
app.get('/api/applications', auth.authenticateToken, (req, res) => {
  const list = db.getApplications(req.user.email);
  return res.status(200).json(list);
});

// POST /api/applications - Add a new application
app.post('/api/applications', auth.authenticateToken, (req, res) => {
  const appData = req.body;
  if (!appData.title || !appData.company) {
    return res.status(400).json({ message: "Job title and company name are required." });
  }
  
  const newApp = db.saveApplication(req.user.email, appData);
  return res.status(201).json(newApp);
});

// PUT /api/applications/:id - Update an application status/notes
app.put('/api/applications/:id', auth.authenticateToken, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  try {
    const updated = db.updateApplication(req.user.email, id, updates);
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
});

// DELETE /api/applications/:id - Delete an application
app.delete('/api/applications/:id', auth.authenticateToken, (req, res) => {
  const { id } = req.params;
  db.deleteApplication(req.user.email, id);
  return res.status(200).json({ message: "Application archived successfully." });
});

/* =========================================================================
   COMMUNITY ALERTS & DISCUSSIONS ENDPOINTS
   ========================================================================= */

// GET /api/discussions - Get discussions list (Public)
app.get('/api/discussions', (req, res) => {
  return res.status(200).json(db.getDiscussions());
});

// POST /api/discussions - Post a new discussion (Authed)
app.post('/api/discussions', auth.authenticateToken, (req, res) => {
  const { title, content, tag } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: "Discussion title and content are required." });
  }
  
  const user = db.getUser(req.user.email);
  const post = db.addDiscussion(req.user.email, user.name, user.role, { title, content, tag });
  return res.status(201).json(post);
});

// POST /api/discussions/:id/upvote - Upvote/un-upvote a discussion (Authed)
app.post('/api/discussions/:id/upvote', auth.authenticateToken, (req, res) => {
  const { id } = req.params;
  try {
    const post = db.upvoteDiscussion(id, req.user.email);
    return res.status(200).json(post);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
});

// POST /api/discussions/:id/reply - Post a reply to a discussion (Authed)
app.post('/api/discussions/:id/reply', auth.authenticateToken, (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ message: "Reply content cannot be blank." });
  }
  
  try {
    const user = db.getUser(req.user.email);
    const post = db.addReply(id, user.name, content);
    return res.status(201).json(post);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
});

// GET /api/scam-alerts - Get live scam alerts (Public)
app.get('/api/scam-alerts', (req, res) => {
  return res.status(200).json(db.getScamAlerts());
});

// POST /api/scam-alerts - Add a live scam alert (Authed)
app.post('/api/scam-alerts', auth.authenticateToken, (req, res) => {
  const alertData = req.body;
  if (!alertData.title || !alertData.company) {
    return res.status(400).json({ message: "Job title and company name are required for reporting." });
  }
  
  const newAlert = db.addScamAlert(alertData);
  return res.status(201).json(newAlert);
});

/* =========================================================================
   FALLBACK ROUTE - SPA ROUTER
   ========================================================================= */

// Serve index.html for all other routes to support client-side routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` JobGuard Full-stack Server Running!`);
  console.log(` Port: ${PORT}`);
  console.log(` Environment: ${process.env.NODE_ENV}`);
  console.log(`===============================================`);
});
