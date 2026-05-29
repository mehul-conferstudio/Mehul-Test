const { MongoClient } = require('mongodb');
const dns = require('dns');

// Force IPv4 DNS resolution — Node.js defaults to IPv6 which some ISP routers
// refuse for SRV record queries (e.g. mongodb+srv:// lookups).
dns.setDefaultResultOrder('ipv4first');


// ==========================================================================
// CONNECTION
// ==========================================================================
// NOTE: MONGO_URI is read inside connectDb() (not at module level) so that
// server.js has a chance to load the .env file before this value is evaluated.

let _client = null;
let _db = null;

async function connectDb() {
  if (_db) return _db; // Already connected

  const MONGO_URI = process.env.MONGODB_URI;
  const DB_NAME = 'jobguard';

  if (!MONGO_URI) {
    throw new Error(
      'MONGODB_URI environment variable is not set. ' +
      'Add it to your .env file (local) or Render dashboard (production).'
    );
  }

  _client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
  });

  await _client.connect();
  _db = _client.db(DB_NAME);
  console.log(`[DB] Connected to MongoDB Atlas — database: "${DB_NAME}"`);

  // Seed reference data on first boot
  await seedIfEmpty(_db);

  return _db;
}

function getDb() {
  if (!_db) throw new Error('[DB] Database not connected. Call connectDb() first.');
  return _db;
}

// ==========================================================================
// SEEDING — runs only if collections are empty
// ==========================================================================
async function seedIfEmpty(database) {
  const discussions = database.collection('discussions');
  const count = await discussions.countDocuments();

  if (count === 0) {
    console.log('[DB] Seeding initial discussions and scam alerts...');
    await discussions.insertMany([
      {
        id: 'disc-1',
        authorName: 'Anukrati',
        authorRole: 'Job Seeker',
        tag: 'Alert',
        title: "Warning: WhatsApp recruiter from 'Apex Global'",
        content: "Got a message offering $200/day for liking YouTube videos. They asked for a 'refundable training deposit' of $50. Definitely a scam, block them immediately!",
        upvotes: 18,
        upvotedBy: [],
        replies: [
          {
            authorName: 'Rohan S.',
            content: 'Thanks for posting, they messaged me yesterday as well! Blocked.',
            createdAt: '2026-05-28T09:00:00Z'
          }
        ],
        createdAt: '2026-05-28T08:30:00Z'
      },
      {
        id: 'disc-2',
        authorName: 'Dev M.',
        authorRole: 'Community Verifier',
        tag: 'Guide',
        title: 'How to check if a company email domain is legitimate',
        content: "Always check the domain MX records. Scammers often use domains like '@gmail-recruiting.com' instead of the official corporate domain. You can use command-line 'nslookup -type=mx domain.com' to verify.",
        upvotes: 24,
        upvotedBy: [],
        replies: [],
        createdAt: '2026-05-27T14:15:00Z'
      }
    ]);
  }

  const scamAlerts = database.collection('scamAlerts');
  const alertCount = await scamAlerts.countDocuments();

  if (alertCount === 0) {
    await scamAlerts.insertMany([
      {
        id: 'alert-1',
        title: 'Social Media Optimizer',
        company: 'Apex Global Solutions',
        platform: 'Naukri',
        dateReported: '2026-05-28T08:30:00Z'
      },
      {
        id: 'alert-2',
        title: 'Data Entry Clerk (Work From Home)',
        company: 'Universal Tech Group',
        platform: 'Monster',
        dateReported: '2026-05-28T10:15:00Z'
      }
    ]);
    console.log('[DB] Seed complete.');
  }
}

// ==========================================================================
// DB MODULE — same public interface as the old file-based version
// ==========================================================================
const db = {

  // ---------- USER OPERATIONS ----------

  async getUser(email) {
    const col = getDb().collection('users');
    return col.findOne({ email: email.toLowerCase() }, { projection: { _id: 0 } });
  },

  async createUser(user) {
    const col = getDb().collection('users');
    const cleanEmail = user.email.toLowerCase();

    const existing = await col.findOne({ email: cleanEmail });
    if (existing) throw new Error('User already exists');

    const newUser = {
      email: cleanEmail,
      name: user.name,
      role: user.role || 'Job Seeker',
      phone: user.phone || '',
      points: 0,
      createdAt: new Date().toISOString()
    };

    await col.insertOne(newUser);
    const { _id, ...userWithoutId } = newUser;
    return userWithoutId;
  },

  async updateUser(email, updates) {
    const col = getDb().collection('users');
    const cleanEmail = email.toLowerCase();

    const allowed = {};
    if (updates.name !== undefined) allowed.name = updates.name;
    if (updates.role !== undefined) allowed.role = updates.role;
    if (updates.points !== undefined) allowed.points = updates.points;

    const result = await col.findOneAndUpdate(
      { email: cleanEmail },
      { $set: allowed },
      { returnDocument: 'after', projection: { _id: 0 } }
    );

    if (!result) throw new Error('User not found');
    return result;
  },

  async getAllUsers() {
    const col = getDb().collection('users');
    return col.find({}, { projection: { _id: 0 } }).toArray();
  },

  async deleteUser(email) {
    const col = getDb().collection('users');
    const cleanEmail = email.toLowerCase();

    // Also clean up OTPs and applications
    await getDb().collection('otps').deleteMany({ email: cleanEmail });
    await getDb().collection('applications').deleteMany({ userEmail: cleanEmail });

    const result = await col.deleteOne({ email: cleanEmail });
    return result.deletedCount > 0;
  },

  // ---------- OTP OPERATIONS ----------

  async getOtp(email) {
    const col = getDb().collection('otps');
    return col.findOne({ email: email.toLowerCase() }, { projection: { _id: 0 } });
  },

  async saveOtp(email, otpHash, expiresAt) {
    const col = getDb().collection('otps');
    const cleanEmail = email.toLowerCase();

    const existing = await col.findOne({ email: cleanEmail });
    const now = Date.now();
    const tenMinsAgo = now - 10 * 60 * 1000;

    // Merge request times, keep only last 10 minutes
    const prevTimes = existing ? existing.requestTimes : [];
    const requestTimes = [...prevTimes.filter(t => t > tenMinsAgo), now];

    const record = {
      email: cleanEmail,
      hash: otpHash,
      expiresAt,
      attempts: 0,
      requestTimes
    };

    await col.replaceOne({ email: cleanEmail }, record, { upsert: true });
    return record;
  },

  async updateOtp(email, updates) {
    const col = getDb().collection('otps');
    const result = await col.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: updates },
      { returnDocument: 'after', projection: { _id: 0 } }
    );
    return result || null;
  },

  async deleteOtp(email) {
    const col = getDb().collection('otps');
    await col.deleteOne({ email: email.toLowerCase() });
  },

  // ---------- APPLICATION OPERATIONS ----------

  async getApplications(email) {
    const col = getDb().collection('applications');
    return col
      .find({ userEmail: email.toLowerCase() }, { projection: { _id: 0 } })
      .toArray();
  },

  async saveApplication(email, app) {
    const col = getDb().collection('applications');
    const newApp = {
      id: app.id || `app-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userEmail: email.toLowerCase(),
      title: app.title,
      company: app.company,
      location: app.location || 'Remote',
      salary: app.salary || 'Not Disclosed',
      originalLink: app.originalLink || '',
      platform: app.platform || 'LinkedIn',
      status: app.status || 'Saved',
      trustScore: app.trustScore !== undefined ? app.trustScore : 100,
      responseTime: app.responseTime || 'Average',
      updatedAt: new Date().toISOString()
    };

    await col.insertOne(newApp);
    const { _id, ...appWithoutId } = newApp;
    return appWithoutId;
  },

  async updateApplication(email, id, updates) {
    const col = getDb().collection('applications');
    const cleanEmail = email.toLowerCase();

    const allowed = { updatedAt: new Date().toISOString() };
    if (updates.status !== undefined) allowed.status = updates.status;
    if (updates.notes !== undefined) allowed.notes = updates.notes;

    const result = await col.findOneAndUpdate(
      { id, userEmail: cleanEmail },
      { $set: allowed },
      { returnDocument: 'after', projection: { _id: 0 } }
    );

    if (!result) throw new Error('Application not found');
    return result;
  },

  async deleteApplication(email, id) {
    const col = getDb().collection('applications');
    await col.deleteOne({ id, userEmail: email.toLowerCase() });
  },

  // ---------- COMMUNITY OPERATIONS ----------

  async getDiscussions() {
    const col = getDb().collection('discussions');
    return col.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
  },

  async addDiscussion(email, authorName, authorRole, post) {
    const col = getDb().collection('discussions');
    const newPost = {
      id: `disc-${Date.now()}`,
      authorName,
      authorRole,
      tag: post.tag || 'General',
      title: post.title,
      content: post.content,
      upvotes: 0,
      upvotedBy: [],
      replies: [],
      createdAt: new Date().toISOString()
    };

    await col.insertOne(newPost);
    const { _id, ...postWithoutId } = newPost;
    return postWithoutId;
  },

  async upvoteDiscussion(postId, email) {
    const col = getDb().collection('discussions');
    const userEmail = email.toLowerCase();

    const post = await col.findOne({ id: postId });
    if (!post) throw new Error('Post not found');

    const hasVoted = post.upvotedBy.includes(userEmail);

    const result = await col.findOneAndUpdate(
      { id: postId },
      hasVoted
        ? { $pull: { upvotedBy: userEmail }, $inc: { upvotes: -1 } }
        : { $push: { upvotedBy: userEmail }, $inc: { upvotes: 1 } },
      { returnDocument: 'after', projection: { _id: 0 } }
    );

    return result;
  },

  async addReply(postId, replyAuthorName, replyContent) {
    const col = getDb().collection('discussions');

    const reply = {
      authorName: replyAuthorName,
      content: replyContent,
      createdAt: new Date().toISOString()
    };

    const result = await col.findOneAndUpdate(
      { id: postId },
      { $push: { replies: reply } },
      { returnDocument: 'after', projection: { _id: 0 } }
    );

    if (!result) throw new Error('Post not found');
    return result;
  },

  async getScamAlerts() {
    const col = getDb().collection('scamAlerts');
    return col.find({}, { projection: { _id: 0 } }).sort({ dateReported: -1 }).toArray();
  },

  async addScamAlert(alert) {
    const col = getDb().collection('scamAlerts');
    const newAlert = {
      id: `alert-${Date.now()}`,
      title: alert.title,
      company: alert.company,
      platform: alert.platform,
      dateReported: new Date().toISOString()
    };

    await col.insertOne(newAlert);
    const { _id, ...alertWithoutId } = newAlert;
    return alertWithoutId;
  }
};

module.exports = { connectDb, ...db };
