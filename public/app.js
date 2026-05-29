import { initialJobs, initialDiscussions } from './mockData.js';

// ==========================================================================
// APPLICATION STATE MANAGEMENT & API SYNC
// ==========================================================================
let jobs = [];
let discussions = [];
let currentUser = null;
let trackedJobs = []; // Array of application objects loaded from database
let authToken = localStorage.getItem('jg_auth_token') || null;

// API fetch helper with authorization
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const response = await fetch(endpoint, {
    ...options,
    headers
  });
  
  if (response.status === 401 || response.status === 403) {
    handleLogout();
    throw new Error("Session expired. Please log in again.");
  }
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

// Initial storage load and auth status verification
async function initStorage() {
  // Load local static job feeds data cache
  if (!localStorage.getItem('jg_jobs')) {
    localStorage.setItem('jg_jobs', JSON.stringify(initialJobs));
  }
  jobs = JSON.parse(localStorage.getItem('jg_jobs'));

  // Parse cached user details if they exist
  if (authToken && localStorage.getItem('jg_user')) {
    try {
      currentUser = JSON.parse(localStorage.getItem('jg_user'));
      // Verify token is still valid with backend
      const profile = await apiFetch('/api/user/profile');
      currentUser = profile;
      localStorage.setItem('jg_user', JSON.stringify(currentUser));
      
      // Hide welcome screen
      document.getElementById('welcome-screen').classList.add('hidden');
      updateHeaderUser();
      
      // Load user applications and community data
      await syncTrackerAndCommunity();
    } catch (err) {
      console.warn("Auth token validation failed:", err);
      handleLogout();
    }
  } else {
    handleLogout();
  }
}

async function syncTrackerAndCommunity() {
  try {
    // Fetch user applications from database
    const apps = await apiFetch('/api/applications');
    trackedJobs = apps;
    
    // Fetch discussions from database
    const disc = await apiFetch('/api/discussions');
    discussions = disc;
  } catch (err) {
    console.error("Failed to sync database data:", err);
  }
}

function updateHeaderUser() {
  const headerAvatar = document.getElementById('header-avatar');
  const headerPoints = document.getElementById('header-points');
  
  if (currentUser) {
    if (headerAvatar) {
      headerAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
    }
    if (headerPoints) {
      headerPoints.textContent = `${currentUser.points} pts`;
    }
  } else {
    if (headerAvatar) headerAvatar.textContent = "?";
    if (headerPoints) headerPoints.textContent = "0 pts";
  }
}

async function awardPoints(pts) {
  if (!currentUser) return;
  try {
    const data = await apiFetch('/api/user/points', {
      method: 'POST',
      body: JSON.stringify({ amount: pts })
    });
    currentUser.points = data.points;
    localStorage.setItem('jg_user', JSON.stringify(currentUser));
    updateHeaderUser();
  } catch (err) {
    console.error("Failed to sync points:", err);
  }
}

function handleLogout() {
  authToken = null;
  currentUser = null;
  trackedJobs = [];
  localStorage.removeItem('jg_auth_token');
  localStorage.removeItem('jg_user');
  document.getElementById('welcome-screen').classList.remove('hidden');
  const authOverlay = document.getElementById('auth-modal-overlay');
  if (authOverlay) authOverlay.classList.add('hidden');
  updateHeaderUser();
  
  // Show registration view by default
  const regView = document.getElementById('auth-register-view');
  const loginView = document.getElementById('auth-login-view');
  const verifyView = document.getElementById('auth-verify-view');
  const errorBanner = document.getElementById('auth-error-banner');
  if (errorBanner) errorBanner.style.display = 'none';
  if (regView) regView.classList.remove('hidden');
  if (loginView) loginView.classList.add('hidden');
  if (verifyView) verifyView.classList.add('hidden');
}

// ==========================================================================
// PWA INITIALIZATION & INSTALL BANNER
// ==========================================================================
let deferredPrompt;

function setupPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('Service Worker registered successfully!', reg.scope))
        .catch((err) => console.error('Service Worker registration failed:', err));
    });
  }

  // Handle Installation Prompt
  const pwaBanner = document.getElementById('pwa-banner');
  const installBtn = document.getElementById('pwa-btn-install');
  const closeBtn = document.getElementById('pwa-btn-close');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show PWA banner
    pwaBanner.classList.add('visible');
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      pwaBanner.classList.remove('visible');
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`PWA Installation outcome: ${outcome}`);
      deferredPrompt = null;
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      pwaBanner.classList.remove('visible');
    });
  }
}

// ==========================================================================
// APP ROUTING & VIEWS NAVIGATION
// ==========================================================================
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const viewPanels = document.querySelectorAll('.view-panel');

  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      // Prevent navigation if not logged in
      if (!authToken) return;
      
      const targetPanel = item.getAttribute('data-tab');
      
      // Toggle Active Tab state
      navItems.forEach(btn => btn.classList.remove('active'));
      item.classList.add('active');

      // Toggle View panel state
      viewPanels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === targetPanel) {
          panel.classList.add('active');
        }
      });

      // Special Tab-Specific renders
      if (targetPanel === 'feed-panel') {
        renderJobsFeed();
      } else if (targetPanel === 'tracker-panel') {
        await syncTrackerAndCommunity();
        renderTrackerDashboard();
      } else if (targetPanel === 'ecosystem-panel') {
        await syncTrackerAndCommunity();
        renderEcosystemFeed();
      } else if (targetPanel === 'verifier-panel') {
        renderVerifierQueue();
      }
    });
  });
}

// ==========================================================================
// WELCOME SCREEN & LOGINS / SIGNUPS (OTP FLOWS)
// ==========================================================================
let currentRegRole = 'seeker'; // 'seeker' or 'verifier'
window.setRole = function(role) {
  currentRegRole = role;
  document.getElementById('role-seeker-btn').classList.toggle('active', role === 'seeker');
  document.getElementById('role-verifier-btn').classList.toggle('active', role === 'verifier');
};

function setupAuth() {
  const regView = document.getElementById('auth-register-view');
  const loginView = document.getElementById('auth-login-view');
  const verifyView = document.getElementById('auth-verify-view');
  
  const toLoginLink = document.getElementById('auth-link-to-login');
  const toRegisterLink = document.getElementById('auth-link-to-register');
  const verifyBackLink = document.getElementById('auth-link-verify-back');
  
  const errorBanner = document.getElementById('auth-error-banner');
  
  // Modal overlay logic for Landing Page
  const authOverlay = document.getElementById('auth-modal-overlay');
  const landingLoginBtn = document.getElementById('landing-login-btn');
  const heroGetStartedBtn = document.getElementById('hero-get-started-btn');
  const authModalClose = document.getElementById('auth-modal-close');

  const showAuthModal = (view) => {
    if (authOverlay) authOverlay.classList.remove('hidden');
    if (view === 'login') {
      toLoginLink.click();
    } else {
      toRegisterLink.click();
    }
  };

  if (landingLoginBtn) {
    landingLoginBtn.addEventListener('click', () => showAuthModal('login'));
  }
  if (heroGetStartedBtn) {
    heroGetStartedBtn.addEventListener('click', () => showAuthModal('register'));
  }
  if (authModalClose) {
    authModalClose.addEventListener('click', () => {
      if (authOverlay) authOverlay.classList.add('hidden');
    });
  }
  
  // Inputs
  const regName = document.getElementById('register-name');
  const regEmail = document.getElementById('register-email');
  const regPhone = document.getElementById('register-phone');
  const loginEmail = document.getElementById('login-email');
  
  // Submit buttons
  const regSubmit = document.getElementById('register-submit-btn');
  const loginSubmit = document.getElementById('login-submit-btn');
  const verifySubmit = document.getElementById('verify-submit-btn');
  const resendBtn = document.getElementById('otp-resend-btn');
  
  // Dev Toast Copy/Close Elements
  const devToast = document.getElementById('dev-otp-toast');
  const devCodeBox = document.getElementById('dev-otp-code');
  const devToastClose = document.getElementById('dev-otp-close');
  
  if (devToastClose) {
    devToastClose.addEventListener('click', () => {
      devToast.classList.remove('visible');
    });
  }

  if (devCodeBox) {
    devCodeBox.addEventListener('click', () => {
      const code = devCodeBox.textContent;
      if (code && code !== '------') {
        navigator.clipboard.writeText(code);
        alert(`OTP code "${code}" copied to clipboard!`);
      }
    });
  }

  // Toggle views helpers
  const showSection = (sectionToShow) => {
    errorBanner.style.display = 'none';
    regView.classList.add('hidden');
    loginView.classList.add('hidden');
    verifyView.classList.add('hidden');
    sectionToShow.classList.remove('hidden');
  };

  const showError = (msg) => {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
  };

  // Nav Links
  toLoginLink.addEventListener('click', () => showSection(loginView));
  toRegisterLink.addEventListener('click', () => showSection(regView));
  verifyBackLink.addEventListener('click', () => showSection(loginView));

  // 1. Submit Registration
  regSubmit.addEventListener('click', async () => {
    const name = regName.value.trim();
    const email = regEmail.value.trim();
    const phone = regPhone ? regPhone.value.trim() : '';
    const roleLabel = currentRegRole === 'seeker' ? 'Job Seeker' : 'Community Verifier';

    if (!name || !email) {
      showError("Please fill out your name and email.");
      return;
    }

    try {
      regSubmit.disabled = true;
      regSubmit.textContent = "Registering...";
      errorBanner.style.display = 'none';
      
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role: roleLabel, phone })
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message);
      
      // Registration succeeded — switch to login view and auto-request OTP
      loginEmail.value = email;
      showSection(loginView);
      await requestOtpFlow(email, loginSubmit);
    } catch (err) {
      // If user is already registered, switch to login view automatically
      if (err.message && err.message.toLowerCase().includes('already registered')) {
        loginEmail.value = email;
        showSection(loginView);
        showError("Email already registered. You can request an OTP to log in.");
      } else {
        showError(err.message || "Registration failed. Please try again.");
      }
    } finally {
      regSubmit.disabled = false;
      regSubmit.textContent = "Register Account";
    }
  });

  // 2. Submit Request OTP (Login)
  loginSubmit.addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    if (!email) {
      showError("Please enter your email address.");
      return;
    }
    await requestOtpFlow(email, loginSubmit);
  });

  // sourceBtn: the button that triggered the OTP request (regSubmit or loginSubmit)
  async function requestOtpFlow(email, sourceBtn) {
    const btn = sourceBtn || loginSubmit;
    const originalText = btn.textContent;
    try {
      errorBanner.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Sending...';
      
      const response = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      
      if (response.status === 503) {
        // Production email delivery failure — give clear guidance
        throw new Error('Verification email could not be delivered. Please try again in a moment.');
      }
      if (!response.ok) throw new Error(data.message);
      
      // Transition to verification state
      document.getElementById('otp-sent-target').textContent = email;
      showSection(verifyView);
      startOtpTimer(email);
      setupOtpInputs();
      
      // Show dev OTP toast if running in development mode (simulated)
      if (data.otp) {
        devCodeBox.textContent = data.otp;
        devToast.classList.add('visible');
        setTimeout(() => {
          devToast.classList.remove('visible');
        }, 15000);
      }
    } catch (err) {
      showError(err.message || 'Failed to generate verification code.');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // Countdown timer helper
  let otpTimerInterval = null;
  function startOtpTimer(email) {
    clearInterval(otpTimerInterval);
    const timerLabel = document.getElementById('otp-timer-label');
    resendBtn.disabled = true;
    
    let duration = 3 * 60; // 3 minutes
    const tick = () => {
      const mins = String(Math.floor(duration / 60)).padStart(2, '0');
      const secs = String(duration % 60).padStart(2, '0');
      timerLabel.textContent = `${mins}:${secs}`;
      if (duration <= 0) {
        clearInterval(otpTimerInterval);
        timerLabel.textContent = "00:00";
        resendBtn.disabled = false;
      }
      duration--;
    };
    tick();
    otpTimerInterval = setInterval(tick, 1000);
  }

  // Resend Button handler
  resendBtn.addEventListener('click', () => {
    const email = document.getElementById('otp-sent-target').textContent;
    requestOtpFlow(email);
  });

  // 3. Submit Verify OTP
  verifySubmit.addEventListener('click', async () => {
    const email = document.getElementById('otp-sent-target').textContent;
    const otp = getOtpCode();
    
    if (otp.length !== 6) {
      showError("Please enter the full 6-digit code.");
      return;
    }

    try {
      verifySubmit.disabled = true;
      verifySubmit.textContent = "Verifying...";
      errorBanner.style.display = 'none';
      
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message);
      
      // Save session details
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('jg_auth_token', authToken);
      localStorage.setItem('jg_user', JSON.stringify(currentUser));
      
      // Clear inputs
      document.querySelectorAll('.otp-digit-input').forEach(inp => inp.value = '');
      devToast.classList.remove('visible');
      
      // Render dashboard and sync data
      updateHeaderUser();
      await syncTrackerAndCommunity();
      
      document.getElementById('welcome-screen').classList.add('hidden');
      document.querySelector('[data-tab="feed-panel"]').click();
    } catch (err) {
      showError(err.message || "Invalid or expired verification code.");
    } finally {
      verifySubmit.disabled = false;
      verifySubmit.textContent = "Verify & Log In";
    }
  });
}

function getOtpCode() {
  const inputs = document.querySelectorAll('.otp-digit-input');
  let code = '';
  inputs.forEach(inp => {
    code += inp.value;
  });
  return code;
}

function setupOtpInputs() {
  const inputs = document.querySelectorAll('.otp-digit-input');
  
  inputs.forEach((input, index) => {
    input.value = ''; // clear initial
    
    input.addEventListener('input', (e) => {
      const val = e.target.value;
      if (!/^\d*$/.test(val)) {
        e.target.value = '';
        return;
      }
      if (val.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        inputs[index - 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{6}$/.test(text)) {
        inputs.forEach((inp, idx) => {
          inp.value = text[idx];
        });
        inputs[5].focus();
      }
    });
  });
  
  // Focus the first input box
  setTimeout(() => inputs[0].focus(), 100);
}


// ==========================================================================
// RENDER: JOB FEED (FEED TABS)
// ==========================================================================
let activeFilters = {
  platform: 'all',
  status: 'all',
  type: 'all'
};

function setupFilters() {
  const searchInput = document.getElementById('job-search-input');
  const filterBtn = document.getElementById('filter-drawer-btn');
  const filtersDrawer = document.getElementById('filters-drawer');
  const chips = document.querySelectorAll('.filters-drawer .chip');

  // Search input change
  searchInput.addEventListener('input', () => {
    renderJobsFeed();
  });

  // Toggle filter drawer
  filterBtn.addEventListener('click', () => {
    filterBtn.classList.toggle('active');
    filtersDrawer.classList.toggle('open');
  });

  // Filter chips click
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const filterGroup = chip.getAttribute('data-filter');
      const filterValue = chip.getAttribute('data-value');

      // Unselect siblings
      chip.parentNode.querySelectorAll('.chip').forEach(sibling => {
        sibling.classList.remove('selected');
      });
      chip.classList.add('selected');

      // Update filter configuration
      activeFilters[filterGroup] = filterValue;
      renderJobsFeed();
    });
  });
}

function renderJobsFeed() {
  const feedContainer = document.getElementById('jobs-list');
  const searchInput = document.getElementById('job-search-input');
  const searchQuery = searchInput.value.toLowerCase().trim();

  // Filter local database
  const filteredJobs = jobs.filter(job => {
    // 1. Text Search matching title, company, or description
    const textMatch = !searchQuery || 
                      job.title.toLowerCase().includes(searchQuery) ||
                      job.company.toLowerCase().includes(searchQuery) ||
                      job.description.toLowerCase().includes(searchQuery);

    // 2. Platform match
    const platformVal = activeFilters.platform.toLowerCase();
    const platformMatch = platformVal === 'all' || 
                         job.platform.toLowerCase().includes(platformVal);

    // 3. Status match
    const statusMatch = activeFilters.status === 'all' || 
                        job.status === activeFilters.status;

    // 4. Job type match
    const typeVal = activeFilters.type.toLowerCase();
    const typeMatch = typeVal === 'all' || 
                      job.jobType.toLowerCase() === typeVal;

    return textMatch && platformMatch && statusMatch && typeMatch;
  });

  // Update statistic counts in banner
  document.getElementById('stat-active').textContent = jobs.filter(j => j.status === 'Verified Active').length;
  document.getElementById('stat-suspicious').textContent = jobs.filter(j => j.status === 'Suspicious').length;
  document.getElementById('stat-scam').textContent = jobs.filter(j => j.status === 'Flagged Fake').length;

  feedContainer.innerHTML = '';

  if (filteredJobs.length === 0) {
    feedContainer.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-dark);">search_off</span>
        <span class="empty-state-text">No job postings found matching the filters.</span>
      </div>
    `;
    return;
  }

  filteredJobs.forEach(job => {
    const card = document.createElement('div');
    card.className = `job-card ${getStatusClass(job.status)}`;
    card.innerHTML = `
      <div class="job-card-header">
        <div class="job-meta-main">
          <h4 class="job-card-title">${escapeHTML(job.title)}</h4>
          <div class="job-card-company">
            <span>${escapeHTML(job.company)}</span>
            <span class="platform-badge ${getPlatformClass(job.platform)}">${job.platform}</span>
          </div>
        </div>
        <div class="score-badge-wrap">
          <div class="score-badge ${getScoreBadgeClass(job.trustScore)}">${job.trustScore}%</div>
          <span class="score-label">Trust</span>
        </div>
      </div>
      
      <div class="job-card-details">
        <div class="detail-item">
          <span class="material-symbols-outlined" style="font-size: 16px;">location_on</span>
          <span>${escapeHTML(job.location)}</span>
        </div>
        <div class="detail-item">
          <span class="material-symbols-outlined" style="font-size: 16px;">payments</span>
          <span>${escapeHTML(job.salary)}</span>
        </div>
      </div>

      <div class="job-card-footer">
        <span class="time-stamp">Posted ${job.postedDate}</span>
        <div class="indicator-badges">
          <span class="badge-pill ${getResponseClass(job.responseTime)}">
            <span class="material-symbols-outlined" style="font-size: 12px;">bolt</span>
            ${job.responseTime} Loop
          </span>
          <span class="badge-pill ${getTrustClass(job.status)}">
            ${job.status}
          </span>
        </div>
      </div>
    `;

    // Click handler to open detailed view
    card.addEventListener('click', () => {
      openJobDetails(job.id);
    });

    feedContainer.appendChild(card);
  });
}

function getStatusClass(status) {
  if (status === 'Verified Active') return 'status-verified';
  if (status === 'Suspicious') return 'status-suspicious';
  if (status === 'Flagged Fake') return 'status-fake';
  return '';
}

function getPlatformClass(platform) {
  const p = platform.toLowerCase();
  if (p.includes('linkedin')) return 'platform-linkedin';
  if (p.includes('naukri')) return 'platform-naukri';
  if (p.includes('monster') || p.includes('foundit')) return 'platform-monster';
  return '';
}

function getScoreBadgeClass(score) {
  if (score >= 80) return 'score-verified';
  if (score >= 40) return 'score-suspicious';
  return 'score-fake';
}

function getResponseClass(time) {
  if (time === 'Fast') return 'badge-response-fast';
  if (time === 'Average') return 'badge-response-average';
  return 'badge-response-slow';
}

function getTrustClass(status) {
  if (status === 'Verified Active') return 'badge-trust-verified';
  if (status === 'Suspicious') return 'badge-trust-suspicious';
  return 'badge-trust-fake';
}

// ==========================================================================
// DETAILED JOB AUDIT PAGE
// ==========================================================================
let currentDetailedJobId = null;

function setupDetailsView() {
  const backBtn = document.getElementById('details-back-btn');
  const detailsView = document.getElementById('job-details-view');
  
  const saveBtn = document.getElementById('detail-save-btn');
  const flagBtn = document.getElementById('detail-flag-btn');
  const applyBtn = document.getElementById('detail-apply-btn');

  backBtn.addEventListener('click', () => {
    detailsView.classList.remove('open');
  });

  // Helper to save/update application on database
  async function saveOrUpdateApplicationOnServer(job, status) {
    const existing = trackedJobs.find(t => t.id === job.id || t.jobId === job.id);
    if (existing) {
      try {
        const updated = await apiFetch(`/api/applications/${existing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ status })
        });
        const idx = trackedJobs.findIndex(t => t.id === existing.id);
        if (idx > -1) trackedJobs[idx] = updated;
      } catch (err) {
        console.error("Failed to update status on database:", err);
      }
    } else {
      try {
        const newApp = await apiFetch('/api/applications', {
          method: 'POST',
          body: JSON.stringify({
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            salary: job.salary,
            originalLink: job.url || '',
            platform: job.platform,
            status: status,
            trustScore: job.trustScore,
            responseTime: job.responseTime
          })
        });
        trackedJobs.push(newApp);
      } catch (err) {
        console.error("Failed to save application to database:", err);
      }
    }
  }

  // Track / Save job
  saveBtn.addEventListener('click', async () => {
    if (!currentDetailedJobId) return;
    const job = jobs.find(j => j.id === currentDetailedJobId);
    if (!job) return;
    
    const existing = trackedJobs.find(t => t.id === currentDetailedJobId || t.jobId === currentDetailedJobId);
    if (existing) {
      alert("This job is already in your application tracker.");
    } else {
      await saveOrUpdateApplicationOnServer(job, 'Saved');
      alert("Job saved successfully! Check the CRM Tracker tab.");
    }
  });

  // Flag Job as Scam
  flagBtn.addEventListener('click', async () => {
    if (!currentDetailedJobId) return;
    
    const job = jobs.find(j => j.id === currentDetailedJobId);
    if (!job) return;

    if (job.status === 'Flagged Fake') {
      alert("This job is already flagged as a scam.");
      return;
    }

    const scamReason = prompt("Please describe why you are flagging this job as a fake/scam (e.g. asking for money, unverified email):");
    if (scamReason === null) return; // user cancelled
    if (scamReason.trim() === '') {
      alert("Reason description is required to flag.");
      return;
    }

    // Flag job
    job.status = 'Flagged Fake';
    job.trustScore = Math.max(5, Math.round(job.trustScore * 0.2));
    job.trustAnalysis.flagsCount += 1;
    job.trustAnalysis.communityFlags.unshift({
      user: currentUser.name,
      type: "User Report",
      comment: scamReason,
      date: new Date().toISOString().split('T')[0]
    });

    // Sync to Tracker & Public Scam list
    await saveOrUpdateApplicationOnServer(job, 'Scam Blocked');
    try {
      await apiFetch('/api/scam-alerts', {
        method: 'POST',
        body: JSON.stringify({
          title: job.title,
          company: job.company,
          platform: job.platform
        })
      });
    } catch (err) {
      console.error(err);
    }

    await awardPoints(15); // Reward points for safety reports
    alert("Scam report filed! Thank you for protecting the community. You earned 15 verification points.");
    
    openJobDetails(currentDetailedJobId); // Re-render details view
    renderJobsFeed(); // Sync main list
  });

  // Apply instantly simulator
  applyBtn.addEventListener('click', async () => {
    if (!currentDetailedJobId) return;
    const job = jobs.find(j => j.id === currentDetailedJobId);
    if (!job) return;

    if (job.status === 'Flagged Fake') {
      alert("CAUTION: This job has been flagged as a scam. Applying is blocked for security.");
      return;
    }

    // Move to Applied status in CRM
    await saveOrUpdateApplicationOnServer(job, 'Applied');

    alert(`Simulating redirect to ${job.platform} listing page...\n\nYour application has been logged and moved to 'Applied' in your Tracker CRM.`);
  });
}

function openJobDetails(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;

  currentDetailedJobId = jobId;

  // Header platform tag
  const platformTag = document.getElementById('detail-platform-tag');
  platformTag.textContent = job.platform;
  platformTag.className = `platform-badge ${getPlatformClass(job.platform)}`;

  // Populate textual info
  document.getElementById('detail-title').textContent = job.title;
  document.getElementById('detail-company').textContent = job.company;
  document.getElementById('detail-location').textContent = job.location;
  document.getElementById('detail-salary').textContent = job.salary;
  document.getElementById('detail-type-exp').textContent = `${job.jobType} • ${job.experience}`;
  document.getElementById('detail-desc').textContent = job.description;

  // Trust meter numbers
  const trustBadge = document.getElementById('detail-trust-badge');
  const trustNumber = document.getElementById('detail-trust-number');
  trustNumber.textContent = `${job.trustScore}%`;
  trustBadge.className = `detail-trust-circular ${getScoreBadgeClass(job.trustScore)}`;

  // Trust breakdown bar calculations
  // Domain matches
  const domScore = job.trustAnalysis.domainStatus === 'Match' ? 100 : job.trustAnalysis.domainStatus === 'Unverified' ? 45 : 10;
  document.getElementById('val-domain').textContent = `${domScore}%`;
  document.getElementById('val-domain-bar').style.width = `${domScore}%`;
  document.getElementById('val-domain-bar').style.backgroundColor = getFillColor(domScore);

  // Recruiter Authority
  const recScore = job.trustAnalysis.recruiterScore === 'Verified Employer' ? 100 : job.trustAnalysis.recruiterScore === 'Third-party agency' ? 60 : 15;
  document.getElementById('val-recruiter').textContent = `${recScore}%`;
  document.getElementById('val-recruiter-bar').style.width = `${recScore}%`;
  document.getElementById('val-recruiter-bar').style.backgroundColor = getFillColor(recScore);

  // Community consensus
  const commScore = Math.max(0, 100 - (job.trustAnalysis.flagsCount * 15) + (job.trustAnalysis.vouchCount * 5));
  document.getElementById('val-community').textContent = `${commScore}%`;
  document.getElementById('val-community-bar').style.width = `${commScore}%`;
  document.getElementById('val-community-bar').style.backgroundColor = getFillColor(commScore);

  // Verification Reason items
  const trustList = document.getElementById('detail-trust-list');
  trustList.innerHTML = '';
  job.trustAnalysis.reasons.forEach(reason => {
    const isPositive = !reason.toLowerCase().includes('suspicious') && 
                       !reason.toLowerCase().includes('money') && 
                       !reason.toLowerCase().includes('mismatch') && 
                       !reason.toLowerCase().includes('unverified') &&
                       !reason.toLowerCase().includes('deposit');

    const item = document.createElement('div');
    item.className = `checklist-item ${isPositive ? 'pass' : 'fail'}`;
    item.innerHTML = `
      <span class="material-symbols-outlined" style="font-size: 16px; color: ${isPositive ? '#10b981' : '#f43f5e'}; margin-top: 1px;">
        ${isPositive ? 'check_circle' : 'cancel'}
      </span>
      <span>${escapeHTML(reason)}</span>
    `;
    trustList.appendChild(item);
  });

  // Community warnings/reports lists
  const reviewsContainer = document.getElementById('detail-reviews-list');
  reviewsContainer.innerHTML = '';
  
  if (job.trustAnalysis.communityFlags.length === 0) {
    reviewsContainer.innerHTML = '<span style="font-size: 0.75rem; color: var(--text-dark);">No active complaints or warnings filed by community members.</span>';
  } else {
    job.trustAnalysis.communityFlags.forEach(review => {
      const revCard = document.createElement('div');
      revCard.className = 'review-card';
      revCard.innerHTML = `
        <div class="review-header">
          <span class="review-user">${escapeHTML(review.user)}</span>
          <span class="review-tag">${escapeHTML(review.type)}</span>
          <span class="review-date">${review.date}</span>
        </div>
        <p class="review-comment">"${escapeHTML(review.comment)}"</p>
      `;
      reviewsContainer.appendChild(revCard);
    });
  }

  // Open the view
  document.getElementById('job-details-view').classList.add('open');
}

function getFillColor(score) {
  if (score >= 80) return 'var(--color-verified)';
  if (score >= 40) return 'var(--color-suspicious)';
  return 'var(--color-fake)';
}

// ==========================================================================
// CRAWLER SIMULATOR / LINK AGGREGATOR
// ==========================================================================
function setupScraper() {
  const submitBtn = document.getElementById('scrape-submit-btn');
  const urlInput = document.getElementById('scrape-url-input');
  const progressWrapper = document.getElementById('scrape-progress');
  const sampleBtns = document.querySelectorAll('.example-link-btn');

  // Handle URL analyze click
  submitBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
      alert("Please paste or click a sample URL to scan.");
      return;
    }
    triggerScraperAnimation(url);
  });

  // Handle sample url button clicks
  sampleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      urlInput.value = url;
      triggerScraperAnimation(url);
    });
  });
}

function triggerScraperAnimation(url) {
  const progressWrapper = document.getElementById('scrape-progress');
  progressWrapper.classList.add('active');

  const steps = [
    document.getElementById('step-connect'),
    document.getElementById('step-extract'),
    document.getElementById('step-domain'),
    document.getElementById('step-heuristics')
  ];

  // Reset steps classes
  steps.forEach(s => {
    s.classList.remove('done', 'active');
  });

  // Step 1: Connect
  steps[0].classList.add('active');
  
  setTimeout(() => {
    steps[0].classList.remove('active');
    steps[0].classList.add('done');
    // Step 2: Extract
    steps[1].classList.add('active');

    setTimeout(() => {
      steps[1].classList.remove('active');
      steps[1].classList.add('done');
      // Step 3: Domain Registry Check
      steps[2].classList.add('active');

      setTimeout(() => {
        steps[2].classList.remove('active');
        steps[2].classList.add('done');
        // Step 4: Run Heuristics
        steps[3].classList.add('active');

        setTimeout(() => {
          steps[3].classList.remove('active');
          steps[3].classList.add('done');
          
          // Complete Simulation, insert job, and open details
          const newJob = generateScrapedJob(url);
          jobs.unshift(newJob);
          saveState();
          
          progressWrapper.classList.remove('active');
          renderJobsFeed();
          
          // Redirect to Feed Tab automatically
          document.querySelector('[data-tab="feed-panel"]').click();
          openJobDetails(newJob.id);
        }, 800);
      }, 600);
    }, 700);
  }, 500);
}

function generateScrapedJob(url) {
  const urlLower = url.toLowerCase();
  const randId = `scraped-${Math.floor(1000 + Math.random() * 9000)}`;
  
  if (urlLower.includes('google') || urlLower.includes('safe')) {
    // Return Safe verified job
    return {
      id: randId,
      title: "Cloud Infrastructure Architect",
      company: "Google Cloud India",
      location: "Mumbai, MH (Onsite)",
      platform: "LinkedIn",
      salary: "₹28,00,000 - ₹38,00,000 / year",
      postedDate: "Just imported",
      jobType: "Onsite",
      experience: "5+ years",
      trustScore: 99,
      status: "Verified Active",
      responseTime: "Fast",
      description: "We are hiring for Google Cloud Solutions Architect roles to help enterprise clients deploy, configure, and maintain containerized microservices and virtual networks on GCP. Experience with GKE and Terraform is mandatory.",
      url: url,
      trustAnalysis: {
        domainStatus: "Match",
        recruiterScore: "Verified Employer",
        inviteRate: "High (90%)",
        flagsCount: 0,
        vouchCount: 1,
        companyProfile: "Registered Business",
        reasons: [
          "Scraped URL connects to verified LinkedIn API company profile.",
          "Corporate domain registry matches the target employer exactly.",
          "Recruiter is a verified employee of Google Inc."
        ],
        communityFlags: []
      }
    };
  } else if (urlLower.includes('deposit') || urlLower.includes('scam') || urlLower.includes('typing')) {
    // Return scam job
    return {
      id: randId,
      title: "Online Form Filling / Typing Assistant",
      company: "E-Z Data Entry Ltd",
      location: "Remote",
      platform: "Naukri",
      salary: "₹4,80,000 / year",
      postedDate: "Just imported",
      jobType: "Remote",
      experience: "0-2 years",
      trustScore: 8,
      status: "Flagged Fake",
      responseTime: "Fast",
      description: "Immediate hiring. Simple form filling job from home. Candidates need to type data inside an Excel sheet. Earn weekly. High payout guaranteed. A refundable software activation fee of ₹1,800 is charged before project allocation.",
      url: url,
      trustAnalysis: {
        domainStatus: "Mismatch",
        recruiterScore: "Suspicious Account",
        inviteRate: "Very Low (0%)",
        flagsCount: 5,
        vouchCount: 0,
        companyProfile: "No registry found",
        reasons: [
          "Heuristic flagged: Contains keyword 'Refundable activation fee' or 'deposit'.",
          "Company profile domain was registered under a temporary dynamic DNS provider.",
          "Recruiter email domain mismatch with corporate domain."
        ],
        communityFlags: [
          {
            user: "JobGuard AI Bot",
            type: "Heuristic Check",
            comment: "Flagged automatically: Employment registration fees are illegal and represent 95% of recruitment fraud.",
            date: new Date().toISOString().split('T')[0]
          }
        ]
      }
    };
  } else {
    // Return Suspicious job
    return {
      id: randId,
      title: "Management Trainee (Graduate)",
      company: "Career Builder Consultants",
      location: "Bangalore, KA (Hybrid)",
      platform: "Monster/Foundit",
      salary: "₹4,00,000 - ₹5,50,000 / year",
      postedDate: "Just imported",
      jobType: "Hybrid",
      experience: "0-2 years",
      trustScore: 48,
      status: "Suspicious",
      responseTime: "Average",
      description: "Looking for energetic graduates to join our business management training track. Handles operations, sales development, and recruiter client outreach. Candidate must possess excellent communication skills.",
      url: url,
      trustAnalysis: {
        domainStatus: "Unverified",
        recruiterScore: "Third-party agency",
        inviteRate: "Moderate (30%)",
        flagsCount: 1,
        vouchCount: 0,
        companyProfile: "Unverified Entity",
        reasons: [
          "Posting is hosted by a recruitment consultancy aggregator, not the direct employer.",
          "Consultancy registry has multiple conflicting business addresses."
        ],
        communityFlags: [
          {
            user: "Amit P.",
            type: "Consultancy Redirect",
            comment: "Applied to this and they told me I need to pay for their 3-week grooming certification to get hired.",
            date: new Date().toISOString().split('T')[0]
          }
        ]
      }
    };
  }
}

// ==========================================================================
// JOB TRACKER CRM CONTROLLER
// ==========================================================================
let activeTrackerTab = 'Saved';

function setupTracker() {
  const tabs = document.querySelectorAll('.tracker-status-selector .tracker-tab');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTrackerTab = tab.getAttribute('data-tracker');
      renderTrackerDashboard();
    });
  });
}

function renderTrackerDashboard() {
  const trackerList = document.getElementById('tracker-list');
  
  // Filter jobs by tracking state
  const trackedItems = trackedJobs.filter(t => t.status === activeTrackerTab);
  
  // Update header tab badge counts
  document.querySelectorAll('.tracker-tab').forEach(tab => {
    const tabState = tab.getAttribute('data-tracker');
    const count = trackedJobs.filter(t => t.status === tabState).length;
    
    if (tabState === 'Saved') tab.textContent = `Saved (${count})`;
    if (tabState === 'Applied') tab.textContent = `Applied (${count})`;
    if (tabState === 'Interviewing') tab.textContent = `Interviewing (${count})`;
    if (tabState === 'Offer') tab.textContent = `Offer (${count})`;
    if (tabState === 'Flagged') tab.textContent = `Scams (${count})`;
  });

  trackerList.innerHTML = '';

  if (trackedItems.length === 0) {
    trackerList.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-dark);">assignment_late</span>
        <span class="empty-state-text">No jobs currently in the '${activeTrackerTab}' list. Move jobs here using the Job Details panel.</span>
      </div>
    `;
    return;
  }

  trackedItems.forEach(item => {
    // Try to find matching job in local cache, otherwise use the saved item attributes
    const job = jobs.find(j => j.id === (item.jobId || item.id)) || item;
    if (!job) return;

    const card = document.createElement('div');
    card.className = 'tracker-card';
    card.innerHTML = `
      <div class="tracker-card-info">
        <span class="tracker-job-title">${escapeHTML(job.title)}</span>
        <span class="tracker-job-company">${escapeHTML(job.company)} (${job.platform})</span>
      </div>
      <div class="tracker-controls" onclick="event.stopPropagation();">
        ${activeTrackerTab !== 'Offer' && activeTrackerTab !== 'Flagged' ? `
          <button class="control-btn" title="Advance Stage" onclick="advanceTrackerStage('${job.id}')">
            <span class="material-symbols-outlined" style="font-size: 16px;">double_arrow</span>
          </button>
        ` : ''}
        <button class="control-btn" title="Delete" onclick="removeTracker('${job.id}')">
          <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
        </button>
      </div>
    `;

    card.addEventListener('click', () => {
      openJobDetails(job.id);
    });

    trackerList.appendChild(card);
  });
}

// Window globally scoped helper functions for CRM actions
window.advanceTrackerStage = async function(jobId) {
  const existing = trackedJobs.find(t => t.id === jobId || t.jobId === jobId);
  if (!existing) return;

  const currentStatus = existing.status;
  let newStatus = currentStatus;
  
  if (currentStatus === 'Saved') newStatus = 'Applied';
  else if (currentStatus === 'Applied') newStatus = 'Interviewing';
  else if (currentStatus === 'Interviewing') newStatus = 'Offer';

  try {
    const updated = await apiFetch(`/api/applications/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    const idx = trackedJobs.findIndex(t => t.id === existing.id);
    if (idx > -1) trackedJobs[idx] = updated;
    renderTrackerDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.removeTracker = async function(jobId) {
  const existing = trackedJobs.find(t => t.id === jobId || t.jobId === jobId);
  if (!existing) return;

  if (confirm("Remove this job from your tracking dashboard?")) {
    try {
      await apiFetch(`/api/applications/${existing.id}`, {
        method: 'DELETE'
      });
      trackedJobs = trackedJobs.filter(t => t.id !== existing.id);
      renderTrackerDashboard();
    } catch (err) {
      alert(err.message);
    }
  }
};

// ==========================================================================
// COMMUNITY ECOSYSTEM BOARD CONTROLLER
// ==========================================================================
let activeEcoTab = 'discussions';

function setupEcosystem() {
  const tabs = document.querySelectorAll('.ecosystem-tab-btn');
  const postBtn = document.getElementById('post-submit-btn');

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeEcoTab = tab.getAttribute('data-eco-tab');
      renderEcosystemFeed();
    });
  });

  // Post Submission
  postBtn.addEventListener('click', async () => {
    const titleInput = document.getElementById('post-title-input');
    const contentInput = document.getElementById('post-content-input');
    const categorySelect = document.getElementById('post-category-select');

    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const category = categorySelect.value;

    if (!title || !content) {
      alert("Please fill in both a title and post body description.");
      return;
    }

    try {
      postBtn.disabled = true;
      postBtn.textContent = "Posting...";
      
      const newPost = await apiFetch('/api/discussions', {
        method: 'POST',
        body: JSON.stringify({ title, content, tag: category })
      });

      // Insert locally and reward points
      discussions.unshift(newPost);
      await awardPoints(10); // Syncs points on database too

      // Clear form inputs
      titleInput.value = '';
      contentInput.value = '';

      alert("Ecosystem post submitted successfully! You earned 10 points.");
      renderEcosystemFeed();
    } catch (err) {
      alert(err.message);
    } finally {
      postBtn.disabled = false;
      postBtn.textContent = "Post";
    }
  });
}

function renderEcosystemFeed() {
  const container = document.getElementById('discussions-list');
  const postForm = document.getElementById('new-post-form');
  const alertBar = document.querySelector('.scam-alert-bar');

  container.innerHTML = '';

  if (activeEcoTab === 'scam-feed') {
    // Hide new post form, show only alerts
    postForm.style.display = 'none';
    alertBar.style.display = 'flex';

    // Gather all flagged jobs and scam alerts posts
    const scamJobs = jobs.filter(j => j.status === 'Flagged Fake');
    const scamThreads = discussions.filter(d => d.category === 'Scam Alerts');

    if (scamJobs.length === 0 && scamThreads.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="empty-state-text">No active scam warnings reported today.</span></div>';
      return;
    }

    // Render flagged job summaries
    scamJobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'discussion-card';
      card.style.borderColor = 'rgba(244, 63, 94, 0.3)';
      card.innerHTML = `
        <div class="discussion-header">
          <div class="author-info">
            <div class="author-avatar" style="background: var(--color-fake-glow); color: var(--color-fake);">SC</div>
            <div class="author-name-wrap">
              <span class="author-name">${escapeHTML(job.company)}</span>
              <span class="author-role">${job.platform} import</span>
            </div>
          </div>
          <span class="post-category" style="background: var(--color-fake-glow); color: var(--color-fake);">FLAGGED SCAM</span>
        </div>
        <h4 class="post-title">${escapeHTML(job.title)}</h4>
        <p class="post-content"><strong>Flagged Reasons:</strong> ${escapeHTML(job.trustAnalysis.reasons.join(' '))}</p>
        <div class="post-footer">
          <span class="time-stamp">Reported recently</span>
          <button class="post-action-btn" onclick="openJobDetails('${job.id}')">View Full Audit Detail</button>
        </div>
      `;
      container.appendChild(card);
    });

    // Render scam discussions
    scamThreads.forEach(thread => {
      renderThreadCard(thread, container);
    });

  } else {
    // Discussions tab
    postForm.style.display = 'flex';
    alertBar.style.display = 'flex';

    discussions.forEach(thread => {
      renderThreadCard(thread, container);
    });
  }
}

function renderThreadCard(thread, targetContainer) {
  const card = document.createElement('div');
  card.className = 'discussion-card';
  card.innerHTML = `
    <div class="discussion-header">
      <div class="author-info">
        <div class="author-avatar">${escapeHTML(thread.avatar)}</div>
        <div class="author-name-wrap">
          <span class="author-name">${escapeHTML(thread.author)}</span>
          <span class="author-role">${thread.role}</span>
        </div>
      </div>
      <span class="post-category">${escapeHTML(thread.category)}</span>
    </div>
    <h4 class="post-title">${escapeHTML(thread.title)}</h4>
    <p class="post-content">${escapeHTML(thread.content)}</p>
    
    <div class="post-footer">
      <span class="time-stamp">${thread.date}</span>
      <div class="post-actions">
        <button class="post-action-btn" onclick="upvotePost('${thread.id}')">
          <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">thumb_up</span>
          <span>${thread.upvotes}</span>
        </button>
        <button class="post-action-btn" onclick="toggleReplies('${thread.id}')">
          <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">comment</span>
          <span>Replies (${thread.replies.length})</span>
        </button>
      </div>
    </div>

    <!-- Expansion replies drawer -->
    <div id="reply-box-${thread.id}" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.05); flex-direction: column; gap: 8px;">
      <div id="replies-list-${thread.id}" style="display: flex; flex-direction: column; gap: 6px;">
        ${thread.replies.map(rep => `
          <div class="review-card" style="margin-left: 12px; background: rgba(0,0,0,0.1);">
            <div class="review-header">
              <span class="review-user">${escapeHTML(rep.author)}</span>
              <span class="review-date">${rep.date}</span>
            </div>
            <p class="review-comment">"${escapeHTML(rep.content)}"</p>
          </div>
        `).join('')}
      </div>
      <div style="display: flex; gap: 6px; margin-top: 4px;">
        <input type="text" id="reply-input-${thread.id}" class="login-input" placeholder="Write a reply..." style="margin-bottom:0; padding: 6px 12px; font-size: 0.75rem;">
        <button class="btn-primary" onclick="submitReply('${thread.id}')" style="width: auto; padding: 6px 12px; font-size: 0.75rem; border-radius: 8px;">Reply</button>
      </div>
    </div>
  `;
  targetContainer.appendChild(card);
}

// Window globally scoped community triggers
window.upvotePost = async function(postId) {
  try {
    const updated = await apiFetch(`/api/discussions/${postId}/upvote`, {
      method: 'POST'
    });
    const idx = discussions.findIndex(d => d.id === postId);
    if (idx > -1) discussions[idx] = updated;
    renderEcosystemFeed();
  } catch (err) {
    console.error(err);
  }
};

window.toggleReplies = function(postId) {
  const box = document.getElementById(`reply-box-${postId}`);
  if (box) {
    box.style.display = box.style.display === 'none' ? 'flex' : 'none';
  }
};

window.submitReply = async function(postId) {
  const input = document.getElementById(`reply-input-${postId}`);
  const text = input.value.trim();
  
  if (!text) return;

  try {
    const updated = await apiFetch(`/api/discussions/${postId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ content: text })
    });
    
    const idx = discussions.findIndex(d => d.id === postId);
    if (idx > -1) discussions[idx] = updated;
    await awardPoints(5); // Reward points
    
    input.value = '';
    renderEcosystemFeed();
    // Re-open replies drawer after render
    const box = document.getElementById(`reply-box-${postId}`);
    if (box) box.style.display = 'flex';
  } catch (err) {
    alert(err.message);
  }
};


// ==========================================================================
// GAMIFIED CROWDSOURCED VERIFIER QUEUE
// ==========================================================================
function renderVerifierQueue() {
  const queueContainer = document.getElementById('verifier-queue');
  
  // Find all suspicious jobs that need auditing
  const auditJobs = jobs.filter(j => j.status === 'Suspicious');

  queueContainer.innerHTML = '';

  if (auditJobs.length === 0) {
    queueContainer.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined" style="font-size: 48px; color: var(--color-verified);">check_circle</span>
        <span class="empty-state-text">No jobs currently pending verification. Outstanding!</span>
      </div>
    `;
    return;
  }

  auditJobs.forEach(job => {
    // Generate mock consensus tally based on voucher and flag count
    const totalVotes = job.trustAnalysis.vouchCount + job.trustAnalysis.flagsCount + 1;
    const activePct = Math.round((job.trustAnalysis.vouchCount / totalVotes) * 100);
    const fakePct = 100 - activePct;

    const card = document.createElement('div');
    card.className = 'verify-queue-card';
    card.innerHTML = `
      <div class="verify-queue-jobinfo">
        <div>
          <span class="verify-queue-title">${escapeHTML(job.title)}</span>
          <div class="verify-queue-company">${escapeHTML(job.company)} • ${job.platform}</div>
        </div>
        <button class="post-category" style="background: none; border: 1px solid var(--border-glow); cursor: pointer;" onclick="openJobDetails('${job.id}')">Audit Info</button>
      </div>

      <div class="verify-vote-actions">
        <button class="btn-vote-active" onclick="castVote('${job.id}', 'active')">
          <span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">check</span>
          Looks Active
        </button>
        <button class="btn-vote-fake" onclick="castVote('${job.id}', 'fake')">
          <span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">warning</span>
          Flag as Fake
        </button>
      </div>

      <div style="margin-top: 4px;">
        <div class="vote-tally-bar">
          <div class="vote-active-fill" style="width: ${activePct}%;"></div>
          <div class="vote-fake-fill" style="width: ${fakePct}%;"></div>
        </div>
        <div class="vote-legend">
          <span>Active: ${activePct}% (${job.trustAnalysis.vouchCount} votes)</span>
          <span>Fake: ${fakePct}% (${job.trustAnalysis.flagsCount} votes)</span>
        </div>
      </div>
    `;

    queueContainer.appendChild(card);
  });
}

// Window globally scoped verifier action helper
window.castVote = function(jobId, voteType) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;

  if (voteType === 'active') {
    job.trustAnalysis.vouchCount += 1;
    job.trustScore = Math.min(100, job.trustScore + 4);
    
    // If voucher threshold reached, mark as verified active
    if (job.trustAnalysis.vouchCount >= 5) {
      job.status = 'Verified Active';
      job.trustAnalysis.reasons.push("Vouched as legitimate by multiple community verifiers.");
    }
  } else {
    job.trustAnalysis.flagsCount += 1;
    job.trustScore = Math.max(0, job.trustScore - 8);
    
    // If flagged threshold reached, mark as scam
    if (job.trustAnalysis.flagsCount >= 4) {
      job.status = 'Flagged Fake';
      job.trustAnalysis.reasons.push("Blacklisted based on cumulative community flag consensus.");
    }
  }

  saveState();
  awardPoints(15); // Reward verifiers with points
  alert(`Vote logged successfully! You earned 15 verification points. Consensus updated.`);
  renderVerifierQueue();
  renderJobsFeed();
};

// ==========================================================================
// UTILITY HELPERS
// ==========================================================================
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ==========================================================================
// INITIAL SETUP ON PAGE LOAD
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  setupPWA();
  setupNavigation();
  setupAuth();
  setupFilters();
  setupDetailsView();
  setupScraper();
  setupTracker();
  
  // Initialize storage & session
  initStorage().then(() => {
    // Render initial landing listings
    renderJobsFeed();
  });

  // Set real date/time on notch bar
  const clock = document.getElementById('phone-clock');
  if (clock) {
    const tickTime = () => {
      const now = new Date();
      clock.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    };
    tickTime();
    setInterval(tickTime, 60000);
  }

  // Setup click to logout on user avatar badge
  const userBadge = document.querySelector('.user-badge');
  if (userBadge) {
    userBadge.addEventListener('click', () => {
      if (authToken) {
        if (confirm("Are you sure you want to log out of your JobGuard session?")) {
          handleLogout();
        }
      }
    });
  }
});
