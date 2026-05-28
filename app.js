import { initialJobs, initialDiscussions } from './mockData.js';

// ==========================================================================
// APPLICATION STATE MANAGEMENT
// ==========================================================================
let jobs = [];
let discussions = [];
let currentUser = {
  name: "Anukrati",
  role: "seeker",
  points: 120
};
let trackedJobs = []; // Array of { jobId, status: 'Saved'|'Applied'|'Interviewing'|'Offer'|'Flagged' }

// Initialize State from localStorage or fallback to defaults
function initStorage() {
  if (!localStorage.getItem('jg_jobs')) {
    localStorage.setItem('jg_jobs', JSON.stringify(initialJobs));
  }
  if (!localStorage.getItem('jg_discussions')) {
    localStorage.setItem('jg_discussions', JSON.stringify(initialDiscussions));
  }
  if (!localStorage.getItem('jg_user')) {
    localStorage.setItem('jg_user', JSON.stringify(currentUser));
  }
  if (!localStorage.getItem('jg_tracked')) {
    localStorage.setItem('jg_tracked', JSON.stringify([
      { jobId: "job-001", status: "Saved" },
      { jobId: "job-003", status: "Applied" }
    ]));
  }

  jobs = JSON.parse(localStorage.getItem('jg_jobs'));
  discussions = JSON.parse(localStorage.getItem('jg_discussions'));
  currentUser = JSON.parse(localStorage.getItem('jg_user'));
  trackedJobs = JSON.parse(localStorage.getItem('jg_tracked'));
}

function saveState() {
  localStorage.setItem('jg_jobs', JSON.stringify(jobs));
  localStorage.setItem('jg_discussions', JSON.stringify(discussions));
  localStorage.setItem('jg_user', JSON.stringify(currentUser));
  localStorage.setItem('jg_tracked', JSON.stringify(trackedJobs));
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
    item.addEventListener('click', () => {
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
        renderTrackerDashboard();
      } else if (targetPanel === 'ecosystem-panel') {
        renderEcosystemFeed();
      } else if (targetPanel === 'verifier-panel') {
        renderVerifierQueue();
      }
    });
  });
}

// ==========================================================================
// WELCOME SCREEN & LOGIN
// ==========================================================================
function setupAuth() {
  const welcomeScreen = document.getElementById('welcome-screen');
  const getStartedBtn = document.getElementById('get-started-btn');
  const usernameInput = document.getElementById('username-input');

  // Skip welcome screen if already signed in earlier
  if (sessionStorage.getItem('jg_session_active')) {
    welcomeScreen.classList.add('hidden');
    updateHeaderUser();
  }

  getStartedBtn.addEventListener('click', () => {
    const enteredName = usernameInput.value.trim();
    if (!enteredName) {
      alert("Please enter a username to proceed.");
      return;
    }
    
    // Choose selected role
    const activeRoleBtn = document.querySelector('.role-btn.active');
    currentUser.role = activeRoleBtn ? activeRoleBtn.id.includes('seeker') ? 'seeker' : 'verifier' : 'seeker';
    currentUser.name = enteredName;
    
    saveState();
    updateHeaderUser();
    
    // Set Session active
    sessionStorage.setItem('jg_session_active', 'true');
    welcomeScreen.classList.add('hidden');
  });
}

function updateHeaderUser() {
  const headerAvatar = document.getElementById('header-avatar');
  const headerPoints = document.getElementById('header-points');
  
  if (headerAvatar) {
    headerAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
  }
  if (headerPoints) {
    headerPoints.textContent = `${currentUser.points} pts`;
  }
}

function awardPoints(pts) {
  currentUser.points += pts;
  saveState();
  updateHeaderUser();
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
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
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
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
          <span>${escapeHTML(job.location)}</span>
        </div>
        <div class="detail-item">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2" /></svg>
          <span>${escapeHTML(job.salary)}</span>
        </div>
      </div>

      <div class="job-card-footer">
        <span class="time-stamp">Posted ${job.postedDate}</span>
        <div class="indicator-badges">
          <span class="badge-pill ${getResponseClass(job.responseTime)}">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
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

  // Track / Save job
  saveBtn.addEventListener('click', () => {
    if (!currentDetailedJobId) return;
    
    const existing = trackedJobs.find(t => t.jobId === currentDetailedJobId);
    if (existing) {
      alert("This job is already in your application tracker.");
    } else {
      trackedJobs.push({ jobId: currentDetailedJobId, status: 'Saved' });
      saveState();
      alert("Job saved successfully! Check the CRM Tracker tab.");
    }
  });

  // Flag Job as Scam
  flagBtn.addEventListener('click', () => {
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

    // Sync to Tracker
    const trackedIndex = trackedJobs.findIndex(t => t.jobId === currentDetailedJobId);
    if (trackedIndex > -1) {
      trackedJobs[trackedIndex].status = 'Flagged';
    } else {
      trackedJobs.push({ jobId: currentDetailedJobId, status: 'Flagged' });
    }

    saveState();
    awardPoints(15); // Reward points for safety reports
    alert("Scam report filed! Thank you for protecting the community. You earned 15 verification points.");
    
    openJobDetails(currentDetailedJobId); // Re-render details view
    renderJobsFeed(); // Sync main list
  });

  // Apply instantly simulator
  applyBtn.addEventListener('click', () => {
    if (!currentDetailedJobId) return;
    const job = jobs.find(j => j.id === currentDetailedJobId);
    if (!job) return;

    if (job.status === 'Flagged Fake') {
      alert("CAUTION: This job has been flagged as a scam. Applying is blocked for security.");
      return;
    }

    // Move to Applied status in CRM
    const tracker = trackedJobs.find(t => t.jobId === currentDetailedJobId);
    if (tracker) {
      tracker.status = 'Applied';
    } else {
      trackedJobs.push({ jobId: currentDetailedJobId, status: 'Applied' });
    }
    saveState();

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
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        ${isPositive 
          ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />' 
          : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />'}
      </svg>
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
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span class="empty-state-text">No jobs currently in the '${activeTrackerTab}' list. Move jobs here using the Job Details panel.</span>
      </div>
    `;
    return;
  }

  trackedItems.forEach(item => {
    const job = jobs.find(j => j.id === item.jobId);
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
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
          </button>
        ` : ''}
        <button class="control-btn" title="Delete" onclick="removeTracker('${job.id}')">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
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
window.advanceTrackerStage = function(jobId) {
  const index = trackedJobs.findIndex(t => t.jobId === jobId);
  if (index === -1) return;

  const currentStatus = trackedJobs[index].status;
  let newStatus = currentStatus;
  
  if (currentStatus === 'Saved') newStatus = 'Applied';
  else if (currentStatus === 'Applied') newStatus = 'Interviewing';
  else if (currentStatus === 'Interviewing') newStatus = 'Offer';

  trackedJobs[index].status = newStatus;
  saveState();
  renderTrackerDashboard();
};

window.removeTracker = function(jobId) {
  if (confirm("Remove this job from your tracking dashboard?")) {
    trackedJobs = trackedJobs.filter(t => t.jobId !== jobId);
    saveState();
    renderTrackerDashboard();
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
  postBtn.addEventListener('click', () => {
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

    const newPost = {
      id: `post-${Math.floor(1000 + Math.random() * 9000)}`,
      author: currentUser.name,
      avatar: currentUser.name.slice(0,2).toUpperCase(),
      role: "Job Seeker",
      title: title,
      content: content,
      category: category,
      upvotes: 1,
      replies: [],
      date: "Just now"
    };

    discussions.unshift(newPost);
    saveState();
    awardPoints(10); // Reward active community content

    // Clear form inputs
    titleInput.value = '';
    contentInput.value = '';

    alert("Ecosystem post submitted successfully! You earned 10 points.");
    renderEcosystemFeed();
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
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7" /></svg>
          <span>${thread.upvotes}</span>
        </button>
        <button class="post-action-btn" onclick="toggleReplies('${thread.id}')">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
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
window.upvotePost = function(postId) {
  const post = discussions.find(d => d.id === postId);
  if (post) {
    post.upvotes += 1;
    saveState();
    renderEcosystemFeed();
  }
};

window.toggleReplies = function(postId) {
  const box = document.getElementById(`reply-box-${postId}`);
  if (box) {
    box.style.display = box.style.display === 'none' ? 'flex' : 'none';
  }
};

window.submitReply = function(postId) {
  const input = document.getElementById(`reply-input-${postId}`);
  const text = input.value.trim();
  
  if (!text) return;

  const post = discussions.find(d => d.id === postId);
  if (post) {
    post.replies.push({
      author: currentUser.name,
      content: text,
      date: "Just now"
    });
    saveState();
    awardPoints(5); // points for contributing replies
    
    input.value = '';
    renderEcosystemFeed();
    // Re-open replies drawer after render
    document.getElementById(`reply-box-${postId}`).style.display = 'flex';
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
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:14px; height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4" /></svg>
          Looks Active
        </button>
        <button class="btn-vote-fake" onclick="castVote('${job.id}', 'fake')">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:14px; height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4" /></svg>
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
  initStorage();
  setupPWA();
  setupNavigation();
  setupAuth();
  setupFilters();
  setupDetailsView();
  setupScraper();
  setupTracker();
  
  // Render initial landing listings
  renderJobsFeed();

  // Set real date/time on notch bar
  const clock = document.getElementById('phone-clock');
  if (clock) {
    const now = new Date();
    clock.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
});
