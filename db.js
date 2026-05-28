const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_DIR = path.join(__dirname, 'data');

// Initialize DB structure
const initialDb = {
  users: [],
  otps: [],
  applications: [],
  discussions: [
    {
      id: "disc-1",
      authorName: "Anukrati",
      authorRole: "Job Seeker",
      tag: "Alert",
      title: "Warning: WhatsApp recruiter from 'Apex Global'",
      content: "Got a message offering $200/day for liking YouTube videos. They asked for a 'refundable training deposit' of $50. Definitely a scam, block them immediately!",
      upvotes: 18,
      upvotedBy: [],
      replies: [
        {
          authorName: "Rohan S.",
          content: "Thanks for posting, they messaged me yesterday as well! Blocked.",
          createdAt: "2026-05-28T09:00:00Z"
        }
      ],
      createdAt: "2026-05-28T08:30:00Z"
    },
    {
      id: "disc-2",
      authorName: "Dev M.",
      authorRole: "Community Verifier",
      tag: "Guide",
      title: "How to check if a company email domain is legitimate",
      content: "Always check the domain MX records. Scammers often use domains like '@gmail-recruiting.com' instead of the official corporate domain. You can use command-line 'nslookup -type=mx domain.com' to verify.",
      upvotes: 24,
      upvotedBy: [],
      replies: [],
      createdAt: "2026-05-27T14:15:00Z"
    }
  ],
  scamAlerts: [
    {
      id: "alert-1",
      title: "Social Media Optimizer",
      company: "Apex Global Solutions",
      platform: "Naukri",
      dateReported: "2026-05-28T08:30:00Z"
    },
    {
      id: "alert-2",
      title: "Data Entry Clerk (Work From Home)",
      company: "Universal Tech Group",
      platform: "Monster",
      dateReported: "2026-05-28T10:15:00Z"
    }
  ]
};

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Atomically write database to prevent corruption
function writeDb(data) {
  const tempPath = DB_PATH + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, DB_PATH);
}

// Read database
function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    writeDb(initialDb);
    return initialDb;
  }
  try {
    const content = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error("Failed to read database, resetting to default:", err);
    return initialDb;
  }
}

// User Operations
const db = {
  getUser(email) {
    const data = readDb();
    return data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  },

  createUser(user) {
    const data = readDb();
    const cleanEmail = user.email.toLowerCase();
    if (data.users.some(u => u.email.toLowerCase() === cleanEmail)) {
      throw new Error("User already exists");
    }
    const newUser = {
      email: cleanEmail,
      name: user.name,
      role: user.role || 'Job Seeker',
      points: 0,
      createdAt: new Date().toISOString()
    };
    data.users.push(newUser);
    writeDb(data);
    return newUser;
  },

  updateUser(email, updates) {
    const data = readDb();
    const idx = data.users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) throw new Error("User not found");
    
    // Whitelist updates
    if (updates.name !== undefined) data.users[idx].name = updates.name;
    if (updates.role !== undefined) data.users[idx].role = updates.role;
    if (updates.points !== undefined) data.users[idx].points = updates.points;
    
    writeDb(data);
    return data.users[idx];
  },

  // OTP Operations (Ephemeral Auth Session Token)
  getOtp(email) {
    const data = readDb();
    return data.otps.find(o => o.email.toLowerCase() === email.toLowerCase());
  },

  saveOtp(email, otpHash, expiresAt) {
    const data = readDb();
    const cleanEmail = email.toLowerCase();
    const idx = data.otps.findIndex(o => o.email.toLowerCase() === cleanEmail);

    const record = {
      email: cleanEmail,
      hash: otpHash,
      expiresAt,
      attempts: 0,
      requestTimes: idx !== -1 ? [...data.otps[idx].requestTimes, Date.now()] : [Date.now()]
    };

    // Filter request times to keep only those within last 10 minutes
    const tenMinsAgo = Date.now() - 10 * 60 * 1000;
    record.requestTimes = record.requestTimes.filter(t => t > tenMinsAgo);

    if (idx !== -1) {
      data.otps[idx] = record;
    } else {
      data.otps.push(record);
    }
    writeDb(data);
    return record;
  },

  updateOtp(email, updates) {
    const data = readDb();
    const idx = data.otps.findIndex(o => o.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return null;
    
    data.otps[idx] = { ...data.otps[idx], ...updates };
    writeDb(data);
    return data.otps[idx];
  },

  deleteOtp(email) {
    const data = readDb();
    data.otps = data.otps.filter(o => o.email.toLowerCase() !== email.toLowerCase());
    writeDb(data);
  },

  // Application Tracker Operations
  getApplications(email) {
    const data = readDb();
    return data.applications.filter(a => a.userEmail.toLowerCase() === email.toLowerCase());
  },

  saveApplication(email, app) {
    const data = readDb();
    const newApp = {
      id: app.id || `app-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userEmail: email.toLowerCase(),
      title: app.title,
      company: app.company,
      location: app.location || 'Remote',
      salary: app.salary || 'Not Disclosed',
      originalLink: app.originalLink || '',
      platform: app.platform || 'LinkedIn',
      status: app.status || 'Saved', // Saved, Applied, Interviewing, Offer, Scam Blocked
      trustScore: app.trustScore !== undefined ? app.trustScore : 100,
      responseTime: app.responseTime || 'Average',
      updatedAt: new Date().toISOString()
    };
    data.applications.push(newApp);
    writeDb(data);
    return newApp;
  },

  updateApplication(email, id, updates) {
    const data = readDb();
    const idx = data.applications.findIndex(a => a.id === id && a.userEmail.toLowerCase() === email.toLowerCase());
    if (idx === -1) throw new Error("Application not found");

    const app = data.applications[idx];
    if (updates.status !== undefined) app.status = updates.status;
    if (updates.notes !== undefined) app.notes = updates.notes;
    app.updatedAt = new Date().toISOString();

    writeDb(data);
    return app;
  },

  deleteApplication(email, id) {
    const data = readDb();
    data.applications = data.applications.filter(a => !(a.id === id && a.userEmail.toLowerCase() === email.toLowerCase()));
    writeDb(data);
  },

  // Community Operations
  getDiscussions() {
    const data = readDb();
    return data.discussions;
  },

  addDiscussion(email, authorName, authorRole, post) {
    const data = readDb();
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
    data.discussions.push(newPost);
    writeDb(data);
    return newPost;
  },

  upvoteDiscussion(postId, email) {
    const data = readDb();
    const idx = data.discussions.findIndex(d => d.id === postId);
    if (idx === -1) throw new Error("Post not found");

    const post = data.discussions[idx];
    const userEmail = email.toLowerCase();
    const upvoteIdx = post.upvotedBy.indexOf(userEmail);

    if (upvoteIdx === -1) {
      post.upvotedBy.push(userEmail);
      post.upvotes += 1;
    } else {
      post.upvotedBy.splice(upvoteIdx, 1);
      post.upvotes -= 1;
    }
    
    writeDb(data);
    return post;
  },

  addReply(postId, replyAuthorName, replyContent) {
    const data = readDb();
    const idx = data.discussions.findIndex(d => d.id === postId);
    if (idx === -1) throw new Error("Post not found");

    const reply = {
      authorName: replyAuthorName,
      content: replyContent,
      createdAt: new Date().toISOString()
    };

    data.discussions[idx].replies.push(reply);
    writeDb(data);
    return data.discussions[idx];
  },

  getScamAlerts() {
    const data = readDb();
    return data.scamAlerts;
  },

  addScamAlert(alert) {
    const data = readDb();
    const newAlert = {
      id: `alert-${Date.now()}`,
      title: alert.title,
      company: alert.company,
      platform: alert.platform,
      dateReported: new Date().toISOString()
    };
    data.scamAlerts.unshift(newAlert); // Newest first
    writeDb(data);
    return newAlert;
  }
};

module.exports = db;
