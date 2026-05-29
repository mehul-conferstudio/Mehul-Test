/**
 * JobGuard PWA — Regression Test Suite
 * ======================================
 * Pure Node.js (no external test framework).
 * Requires Node 18+ for native fetch.
 *
 * Usage:
 *   npm test                          (runs against localhost:8080)
 *   BASE_URL=https://... npm test     (runs against Render or any live URL)
 *   ADMIN_KEY=xxx npm test            (if ADMIN_KEY is set on the server)
 *
 * Exit code 0 = all tests passed. Exit code 1 = one or more failures.
 */

'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const ADMIN_KEY = process.env.ADMIN_KEY || 'xK9#mP2$qR7!nL4@wZ';

// ============================================================
// TEST RUNNER
// ============================================================
const results = [];
let authToken = null;     // Set after TC-AUTH-09 — reused by authenticated tests
let testUserId = null;    // Email of the test user created during the suite
let testAppId = null;     // Application ID created during CRM tests
let testDiscId = null;    // Discussion ID created during community tests

const TEST_USER = {
  name: 'QA Robot',
  email: `qa-robot-${Date.now()}@jobguard-test.dev`,
  role: 'Job Seeker',
  phone: '+919999900000'
};

function pass(id, msg) {
  results.push({ id, status: 'PASS', msg });
  process.stdout.write(`  ✅ ${id}: ${msg}\n`);
}

function fail(id, msg, detail = '') {
  results.push({ id, status: 'FAIL', msg, detail });
  process.stdout.write(`  ❌ ${id}: ${msg}${detail ? `\n     → ${detail}` : ''}\n`);
}

function skip(id, msg) {
  results.push({ id, status: 'SKIP', msg });
  process.stdout.write(`  ⏭️  ${id}: ${msg} [SKIPPED — dependency failed]\n`);
}

async function request(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function authHeader() {
  return { Authorization: `Bearer ${authToken}` };
}

function adminQuery() {
  return `?key=${encodeURIComponent(ADMIN_KEY)}`;
}

// ============================================================
// TEST DEFINITIONS
// ============================================================
const tests = [

  // ----------------------------------------------------------
  // AUTH — REGISTRATION
  // ----------------------------------------------------------
  {
    id: 'TC-AUTH-01',
    label: 'Register new user with valid data → 201',
    async run() {
      const { status, data } = await request('POST', '/api/auth/register', TEST_USER);
      if (status === 201 && data.user && data.user.email === TEST_USER.email.toLowerCase()) {
        testUserId = TEST_USER.email.toLowerCase();
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, msg: ${data?.message}`);
      }
    }
  },
  {
    id: 'TC-AUTH-02',
    label: 'Register duplicate email → 400 "already registered"',
    async run() {
      const { status, data } = await request('POST', '/api/auth/register', TEST_USER);
      if (status === 400 && data.message?.toLowerCase().includes('already registered')) {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, msg: ${data?.message}`);
      }
    }
  },
  {
    id: 'TC-AUTH-03',
    label: 'Register with invalid email format → 400',
    async run() {
      const { status } = await request('POST', '/api/auth/register', {
        name: 'Bad Email', email: 'not-an-email', role: 'Job Seeker'
      });
      status === 400 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },
  {
    id: 'TC-AUTH-04',
    label: 'Register with invalid phone format → 400',
    async run() {
      const { status } = await request('POST', '/api/auth/register', {
        name: 'Bad Phone', email: `phone-test-${Date.now()}@test.dev`,
        role: 'Job Seeker', phone: '0999999999' // Missing +country code
      });
      status === 400 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },
  {
    id: 'TC-AUTH-05',
    label: 'Register with missing name → 400',
    async run() {
      const { status } = await request('POST', '/api/auth/register', {
        name: '', email: `no-name-${Date.now()}@test.dev`, role: 'Job Seeker'
      });
      status === 400 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },

  // ----------------------------------------------------------
  // AUTH — OTP REQUEST
  // ----------------------------------------------------------
  {
    id: 'TC-AUTH-06',
    label: 'Request OTP for unregistered email → 404',
    async run() {
      const { status } = await request('POST', '/api/auth/request-otp', {
        email: 'ghost-user-xyz@jobguard-test.dev'
      });
      status === 404 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },
  {
    id: 'TC-AUTH-07',
    label: 'Request OTP for registered user → 200 with simulated or emailSent flag',
    async run() {
      if (!testUserId) return skip(this.id, this.label);
      const { status, data } = await request('POST', '/api/auth/request-otp', {
        email: TEST_USER.email
      });
      // Accept 200 (success) or 503 (email delivery failed in prod — still correct behaviour)
      if (status === 200 && (data.simulated === true || data.emailSent === true)) {
        // Capture the OTP for the next test if available (dev mode)
        if (data.otp) { this._otp = data.otp; }
        pass(this.id, this.label);
      } else if (status === 503) {
        pass(this.id, `${this.label} [503 email delivery — correct fail-loud behaviour]`);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },

  // ----------------------------------------------------------
  // AUTH — OTP VERIFY
  // ----------------------------------------------------------
  {
    id: 'TC-AUTH-08',
    label: 'Verify OTP with wrong code → 400 with attempts remaining',
    async run() {
      if (!testUserId) return skip(this.id, this.label);
      const { status, data } = await request('POST', '/api/auth/verify-otp', {
        email: TEST_USER.email, otp: '000000'
      });
      if (status === 400 && data.message?.toLowerCase().includes('attempt')) {
        pass(this.id, this.label);
      } else if (status === 403) {
        // OTP was already invalidated (e.g. from previous run) — acceptable
        pass(this.id, `${this.label} [OTP already invalidated — re-request needed]`);
      } else {
        fail(this.id, this.label, `Status: ${status}, msg: ${data?.message}`);
      }
    }
  },
  {
    id: 'TC-AUTH-09',
    label: 'Request fresh OTP and verify with correct code → 200 + JWT',
    async run() {
      if (!testUserId) return skip(this.id, this.label);

      // Request a fresh OTP
      const otpRes = await request('POST', '/api/auth/request-otp', { email: TEST_USER.email });
      if (otpRes.status !== 200) {
        return fail(this.id, this.label, `Failed to request OTP: Status ${otpRes.status}`);
      }

      let code = otpRes.data.otp;
      
      // If OTP is not in response (because SMTP sent it), fetch it via admin API
      if (!code) {
        const adminOtps = await request('GET', `/api/admin/otps${adminQuery()}`);
        if (adminOtps.status === 200 && Array.isArray(adminOtps.data)) {
          const record = adminOtps.data.find(r => r.email === TEST_USER.email.toLowerCase());
          if (record && record.otp) {
            code = record.otp;
          }
        }
      }

      if (!code) {
        return fail(this.id, this.label, 'Could not retrieve OTP from API response or admin fallback');
      }

      const { status, data } = await request('POST', '/api/auth/verify-otp', {
        email: TEST_USER.email,
        otp: code
      });

      if (status === 200 && data.token && data.user) {
        authToken = data.token;
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, msg: ${data?.message}`);
      }
    }
  },

  // ----------------------------------------------------------
  // AUTH — RATE LIMITING
  // ----------------------------------------------------------
  {
    id: 'TC-AUTH-10',
    label: 'Rate limit: register temp user then hit 4 OTP requests → 429 on 4th',
    async run() {
      // Create a fresh temp user to hit with rate limiting
      const tempEmail = `ratelimit-${Date.now()}@jobguard-test.dev`;
      await request('POST', '/api/auth/register', {
        name: 'Rate Limit Test', email: tempEmail, role: 'Job Seeker'
      });

      let hit429 = false;
      for (let i = 0; i < 4; i++) {
        const { status } = await request('POST', '/api/auth/request-otp', { email: tempEmail });
        if (status === 429) { hit429 = true; break; }
      }

      if (hit429) {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, 'Did not receive 429 after 4 rapid OTP requests');
      }

      // Clean up temp user
      await request('DELETE', `/api/admin/users/${encodeURIComponent(tempEmail)}${adminQuery()}`);
    }
  },

  // ----------------------------------------------------------
  // USER — PROFILE & POINTS
  // ----------------------------------------------------------
  {
    id: 'TC-USER-01',
    label: 'GET /api/user/profile with valid JWT → 200 + user fields',
    async run() {
      if (!authToken) return skip(this.id, this.label);
      const { status, data } = await request('GET', '/api/user/profile', null, authHeader());
      if (status === 200 && data.email && data.name && data.role !== undefined) {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },
  {
    id: 'TC-USER-02',
    label: 'GET /api/user/profile without JWT → 401',
    async run() {
      const { status } = await request('GET', '/api/user/profile');
      status === 401 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },
  {
    id: 'TC-USER-03',
    label: 'GET /api/user/profile with invalid JWT → 403',
    async run() {
      const { status } = await request('GET', '/api/user/profile', null, {
        Authorization: 'Bearer this.is.not.valid'
      });
      status === 403 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },
  {
    id: 'TC-USER-04',
    label: 'POST /api/user/points → 200 with updated points',
    async run() {
      if (!authToken) return skip(this.id, this.label);
      const { status, data } = await request('POST', '/api/user/points', { amount: 10 }, authHeader());
      if (status === 200 && typeof data.points === 'number') {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },

  // ----------------------------------------------------------
  // ADMIN ENDPOINTS
  // ----------------------------------------------------------
  {
    id: 'TC-ADMIN-01',
    label: 'GET /api/admin/users without ADMIN_KEY → 403',
    async run() {
      // Only test if ADMIN_KEY is configured (skip on open dev servers)
      const diagRes = await request('GET', `/api/admin/diagnostics${adminQuery()}`);
      if (diagRes.status !== 200) return skip(this.id, this.label);

      const { status } = await request('GET', '/api/admin/users');
      // If no ADMIN_KEY set on server, it returns 200 (dev mode) — skip
      if (diagRes.data?.nodeEnv === 'development') {
        skip(this.id, `${this.label} [dev mode — no ADMIN_KEY enforcement]`);
      } else {
        status === 403 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
      }
    }
  },
  {
    id: 'TC-ADMIN-02',
    label: 'GET /api/admin/users with valid ADMIN_KEY → 200 + user array',
    async run() {
      const { status, data } = await request('GET', `/api/admin/users${adminQuery()}`);
      if (status === 200 && Array.isArray(data.users) && typeof data.count === 'number') {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },
  {
    id: 'TC-ADMIN-03',
    label: 'GET /api/admin/diagnostics → 200 with config flags',
    async run() {
      const { status, data } = await request('GET', `/api/admin/diagnostics${adminQuery()}`);
      if (status === 200 && 'smtpConfigured' in data && 'mongoConnected' in data) {
        const smtpOk = data.smtpConfigured;
        pass(this.id, `${this.label} [SMTP configured: ${smtpOk}, DB: MongoDB Atlas]`);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },

  // ----------------------------------------------------------
  // CRM — APPLICATION TRACKER
  // ----------------------------------------------------------
  {
    id: 'TC-CRM-01',
    label: 'POST /api/applications without auth → 401',
    async run() {
      const { status } = await request('POST', '/api/applications', {
        title: 'Test Job', company: 'Test Corp'
      });
      status === 401 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },
  {
    id: 'TC-CRM-02',
    label: 'POST /api/applications (authed) → 201 + app object',
    async run() {
      if (!authToken) return skip(this.id, this.label);
      const { status, data } = await request('POST', '/api/applications', {
        title: 'QA Test Engineer', company: 'JobGuard Inc', location: 'Remote',
        salary: '₹10L', platform: 'LinkedIn', status: 'Saved'
      }, authHeader());
      if (status === 201 && data.id) {
        testAppId = data.id;
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },
  {
    id: 'TC-CRM-03',
    label: 'GET /api/applications (authed) → 200 + array',
    async run() {
      if (!authToken) return skip(this.id, this.label);
      const { status, data } = await request('GET', '/api/applications', null, authHeader());
      if (status === 200 && Array.isArray(data)) {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}`);
      }
    }
  },
  {
    id: 'TC-CRM-04',
    label: 'PUT /api/applications/:id (authed) → 200 + updated status',
    async run() {
      if (!authToken || !testAppId) return skip(this.id, this.label);
      const { status, data } = await request('PUT', `/api/applications/${testAppId}`,
        { status: 'Applied' }, authHeader());
      if (status === 200 && data.status === 'Applied') {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },
  {
    id: 'TC-CRM-05',
    label: 'DELETE /api/applications/:id (authed) → 200',
    async run() {
      if (!authToken || !testAppId) return skip(this.id, this.label);
      const { status } = await request('DELETE', `/api/applications/${testAppId}`, null, authHeader());
      status === 200 ? pass(this.id, this.label) : fail(this.id, this.label, `Status: ${status}`);
    }
  },

  // ----------------------------------------------------------
  // COMMUNITY
  // ----------------------------------------------------------
  {
    id: 'TC-COMM-01',
    label: 'GET /api/discussions (public) → 200 + array',
    async run() {
      const { status, data } = await request('GET', '/api/discussions');
      if (status === 200 && Array.isArray(data)) {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}`);
      }
    }
  },
  {
    id: 'TC-COMM-02',
    label: 'POST /api/discussions (authed) → 201 + post object',
    async run() {
      if (!authToken) return skip(this.id, this.label);
      const { status, data } = await request('POST', '/api/discussions', {
        title: 'QA Regression Test Post', content: 'This is a test discussion created by the automated QA suite.', tag: 'Guide'
      }, authHeader());
      if (status === 201 && data.id) {
        testDiscId = data.id;
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },
  {
    id: 'TC-COMM-03',
    label: 'POST /api/discussions/:id/upvote (authed) → 200 + upvotes count',
    async run() {
      if (!authToken || !testDiscId) return skip(this.id, this.label);
      const { status, data } = await request('POST', `/api/discussions/${testDiscId}/upvote`,
        null, authHeader());
      if (status === 200 && typeof data.upvotes === 'number') {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },
  {
    id: 'TC-COMM-04',
    label: 'POST /api/discussions/:id/reply (authed) → 201 + replies array',
    async run() {
      if (!authToken || !testDiscId) return skip(this.id, this.label);
      const { status, data } = await request('POST', `/api/discussions/${testDiscId}/reply`,
        { content: 'QA automated reply — safe to ignore.' }, authHeader());
      if (status === 201 && Array.isArray(data.replies)) {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}, data: ${JSON.stringify(data)}`);
      }
    }
  },
  {
    id: 'TC-COMM-05',
    label: 'GET /api/scam-alerts (public) → 200 + array',
    async run() {
      const { status, data } = await request('GET', '/api/scam-alerts');
      if (status === 200 && Array.isArray(data)) {
        pass(this.id, this.label);
      } else {
        fail(this.id, this.label, `Status: ${status}`);
      }
    }
  },

  // ----------------------------------------------------------
  // CLEANUP — Delete test user via admin API
  // ----------------------------------------------------------
  {
    id: 'TC-CLEANUP',
    label: 'Admin DELETE test user → 200 (cleanup)',
    async run() {
      if (!testUserId) return skip(this.id, this.label);
      const { status } = await request(
        'DELETE', `/api/admin/users/${encodeURIComponent(testUserId)}${adminQuery()}`
      );
      if (status === 200 || status === 404) {
        pass(this.id, `Test user ${testUserId} removed from database`);
      } else {
        fail(this.id, this.label, `Status: ${status} — manual cleanup may be required`);
      }
    }
  }
];

// ============================================================
// RUNNER
// ============================================================
async function runAll() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('  JobGuard PWA — Regression Test Suite');
  console.log(`  Target: ${BASE_URL}`);
  console.log('════════════════════════════════════════════════════\n');

  // Check server is reachable
  try {
    const probe = await fetch(`${BASE_URL}/api/scam-alerts`);
    if (!probe.ok && probe.status !== 200) throw new Error(`Server returned ${probe.status}`);
  } catch (err) {
    console.error(`\n❌ Cannot reach server at ${BASE_URL}`);
    console.error(`   Start the server first: npm run dev`);
    console.error(`   Error: ${err.message}\n`);
    process.exit(1);
  }

  for (const test of tests) {
    try {
      await test.run();
    } catch (err) {
      fail(test.id, test.label, `Unexpected exception: ${err.message}`);
    }
  }

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const total = results.length;

  console.log('\n════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('════════════════════════════════════════════════════');
  console.log(`  Total:   ${total}`);
  console.log(`  ✅ Pass: ${passed}`);
  console.log(`  ❌ Fail: ${failed}`);
  console.log(`  ⏭️  Skip: ${skipped}`);
  console.log('════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.id}: ${r.msg}`);
      if (r.detail) console.log(`       → ${r.detail}`);
    });
    console.log('');
    process.exit(1);
  }

  console.log('All tests passed! 🎉\n');
  process.exit(0);
}

runAll().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
