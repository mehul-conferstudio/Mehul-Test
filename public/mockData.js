// Mock database representing aggregated jobs from LinkedIn, Naukri, and Monster.com
// Used to power the JobGuard search feed, analysis dashboard, and tracker.

export const initialJobs = [
  {
    id: "job-001",
    title: "Senior Frontend Engineer (React)",
    company: "Razorpay Financial",
    location: "Bangalore, KA (Hybrid)",
    platform: "LinkedIn",
    salary: "₹18,00,000 - ₹26,00,000 / year",
    postedDate: "4 hours ago",
    jobType: "Hybrid",
    experience: "3-5 years",
    trustScore: 98,
    status: "Verified Active",
    responseTime: "Fast",
    description: "We are looking for a Senior Frontend Engineer with 4+ years of experience in React, TypeScript, and modern web application development. You will build and scale user interfaces for our payment checkout platform.",
    url: "https://www.linkedin.com/jobs/view/razorpay-senior-frontend-engineer-38491823",
    trustAnalysis: {
      domainStatus: "Match",
      recruiterScore: "Verified Employer",
      inviteRate: "High (82%)",
      flagsCount: 0,
      vouchCount: 14,
      companyProfile: "Registered Business",
      reasons: [
        "Recruiter email uses official domain (@razorpay.com).",
        "Company registry matches official Razorpay business records.",
        "High recruiter response and active interview loops within the last 48 hours.",
        "No suspicious redirects or requests for upfront fees."
      ],
      communityFlags: []
    }
  },
  {
    id: "job-002",
    title: "Data Entry Specialist (Part-Time)",
    company: "Global Career Services",
    location: "Remote",
    platform: "Naukri",
    salary: "₹30,00,000 / year (Suspiciously High)",
    postedDate: "1 day ago",
    jobType: "Remote",
    experience: "0-2 years",
    trustScore: 12,
    status: "Flagged Fake",
    responseTime: "Fast",
    description: "Urgent hiring for Data Entry operators. Work from home part-time. Earn ₹15,000 to ₹25,000 daily by typing simple documents. No experience needed. Access to laptop and internet required. Note: A security deposit of ₹2,500 is required for training materials and software activation.",
    url: "https://www.naukri.com/job-listings-data-entry-specialist-global-career-services-1205260029",
    trustAnalysis: {
      domainStatus: "Mismatch",
      recruiterScore: "Suspicious Account",
      inviteRate: "Very Low (0%)",
      flagsCount: 38,
      vouchCount: 0,
      companyProfile: "No registry found",
      reasons: [
        "Demands money upfront for software activation and training (Classic employment scam).",
        "Salary is highly unrealistic for a data entry role (₹30LPA for basic typing).",
        "Contact email is a free Gmail address (globalcareerservices99@gmail.com) instead of a business domain.",
        "Multiple reports from users stating that the agency went silent after receiving the deposit."
      ],
      communityFlags: [
        {
          user: "Rahul S.",
          type: "Upfront Fee",
          comment: "They asked me to pay ₹2500 for a server activation fee. When I refused, they blocked me on WhatsApp.",
          date: "2026-05-27"
        },
        {
          user: "Ananya M.",
          type: "Scam / Phishing",
          comment: "Completely fake company. The address listed is a residential building.",
          date: "2026-05-26"
        }
      ]
    }
  },
  {
    id: "job-003",
    title: "Software Engineer Intern",
    company: "HexaWare Consultancy",
    location: "Noida, UP (Onsite)",
    platform: "Monster/Foundit",
    salary: "₹3,00,000 - ₹4,50,000 / year",
    postedDate: "2 days ago",
    jobType: "Onsite",
    experience: "0-2 years",
    trustScore: 55,
    status: "Suspicious",
    responseTime: "Average",
    description: "Seeking graduate trainees for a 6-month software development internship. Candidates will work on Java/Spring Boot projects. Opportunity for full-time conversion based on performance.",
    url: "https://www.foundit.in/job/hexaware-consultancy-software-intern-7829103",
    trustAnalysis: {
      domainStatus: "Unverified",
      recruiterScore: "Third-party agency",
      inviteRate: "Moderate (25%)",
      flagsCount: 3,
      vouchCount: 1,
      companyProfile: "Unverified Entity",
      reasons: [
        "Third-party recruiter listing, not direct company hiring.",
        "Company domain was registered less than 3 months ago.",
        "Recruiter responded to applicants via generic WhatsApp message templates rather than email.",
        "No complaints about charging fees yet, but profile lacks official business verification."
      ],
      communityFlags: [
        {
          user: "Vikram K.",
          type: "Consultancy Bait",
          comment: "This is a consultancy. They redirect you to a training program where they charge for placement. Be careful.",
          date: "2026-05-27"
        }
      ]
    }
  },
  {
    id: "job-004",
    title: "Associate Product Manager",
    company: "Flipkart Internet",
    location: "Bangalore, KA (Onsite)",
    platform: "LinkedIn",
    salary: "₹12,00,000 - ₹16,00,000 / year",
    postedDate: "5 days ago",
    jobType: "Onsite",
    experience: "0-2 years",
    trustScore: 95,
    status: "Verified Active",
    responseTime: "Average",
    description: "As an Associate Product Manager, you will work closely with engineering, design, and analytics teams to design, build, and optimize products that solve complex user problems in our supply chain flow.",
    url: "https://www.linkedin.com/jobs/view/flipkart-apm-supply-chain-38499201",
    trustAnalysis: {
      domainStatus: "Match",
      recruiterScore: "Verified Employer",
      inviteRate: "Moderate (45%)",
      flagsCount: 0,
      vouchCount: 8,
      companyProfile: "Registered Business",
      reasons: [
        "Officially listed by Flipkart's HR department.",
        "Redirects directly to official career portal (careers.flipkart.com).",
        "Clear and structured application and interviewing process reported by current job applicants."
      ],
      communityFlags: []
    }
  },
  {
    id: "job-005",
    title: "Work From Home Typing Operator",
    company: "Excel Data Solutions",
    location: "Remote",
    platform: "Naukri",
    salary: "₹2,40,000 - ₹3,60,000 / year",
    postedDate: "1 week ago",
    jobType: "Remote",
    experience: "0-2 years",
    trustScore: 22,
    status: "Flagged Fake",
    responseTime: "Fast",
    description: "Required candidates for typing assignments. Get PDF pages, type them into MS Word. Payment per page will be ₹100. Earn extra bonuses for completing before deadlines. Mobile and internet must be available. Registration fees required.",
    url: "https://www.naukri.com/job-listings-typing-excel-data-solutions-1205260045",
    trustAnalysis: {
      domainStatus: "Unverified",
      recruiterScore: "Suspicious Account",
      inviteRate: "Very Low (0%)",
      flagsCount: 19,
      vouchCount: 0,
      companyProfile: "No registry found",
      reasons: [
        "Specifically asks for registration fees under the guise of 'documentation courier fees'.",
        "Sends a fake legal contract via WhatsApp to pressure users into finishing work or paying penalty fees.",
        "Listed company name 'Excel Data Solutions' is generic and has no active tax or company registration details."
      ],
      communityFlags: [
        {
          user: "Deepak G.",
          type: "Scam / Phishing",
          comment: "They sent a fake agreement and are now threatening me with legal action because I didn't submit on time. It's a complete scam!",
          date: "2026-05-24"
        },
        {
          user: "Priya R.",
          type: "Upfront Fee",
          comment: "Do not apply. They will demand ₹1800 first, and after paying, they will block your number.",
          date: "2026-05-23"
        }
      ]
    }
  },
  {
    id: "job-006",
    title: "Java Developer (Spring Boot)",
    company: "Infosys Ltd",
    location: "Pune, MH (Hybrid)",
    platform: "LinkedIn",
    salary: "₹6,00,000 - ₹10,00,000 / year",
    postedDate: "3 weeks ago",
    jobType: "Hybrid",
    experience: "3-5 years",
    trustScore: 78,
    status: "Verified Active",
    responseTime: "Slow",
    description: "Infosys is hiring Java developers with expertise in Spring Boot, REST APIs, Microservices, and basic cloud platforms (AWS/Azure). Expected to write clean, maintainable code and write unit test cases.",
    url: "https://www.linkedin.com/jobs/view/infosys-java-spring-boot-38291039",
    trustAnalysis: {
      domainStatus: "Match",
      recruiterScore: "Verified Employer",
      inviteRate: "Low (12%)",
      flagsCount: 0,
      vouchCount: 4,
      companyProfile: "Registered Business",
      reasons: [
        "Company domain matches Infosys official site.",
        "Genuine posting, however the job has been open for 20+ days with no recent interviewer updates.",
        "Candidate reports indicate slow screening loops and rare feedback updates."
      ],
      communityFlags: [
        {
          user: "Sunita P.",
          type: "Ghosted / Inactive",
          comment: "Applied 3 weeks ago, got a status update that application is viewed, but no contact. HR seems unresponsive on this listing.",
          date: "2026-05-25"
        }
      ]
    }
  }
];

export const initialDiscussions = [
  {
    id: "disc-001",
    author: "Kunal Sharma",
    avatar: "KS",
    role: "Job Seeker",
    title: "New WhatsApp job scams asking for YouTube video likes",
    content: "Has anyone else received WhatsApp messages from people claiming to be recruiters for global digital marketing agencies, offering ₹150 for liking a couple of YouTube videos? They pay the first ₹150 to gain trust, then add you to a Telegram channel where they ask for investment/task deposits. This is a classic pig butchering/task scam. Be alert and do not send them any money!",
    category: "Scam Alerts",
    upvotes: 42,
    replies: [
      {
        author: "Meera Nair",
        content: "Yes, I got this exact message yesterday. The recruiter number had a country code from Indonesia (+62) but claimed to represent a marketing firm in Mumbai. Report and block immediately.",
        date: "2 hours ago"
      },
      {
        author: "Rohan D.",
        content: "I fell for the first task and got ₹150, but when they asked for ₹3000 to get tasks with 50% returns, I backed out and blocked them. Best decision ever.",
        date: "1 hour ago"
      }
    ],
    date: "1 day ago"
  },
  {
    id: "disc-002",
    author: "Neha Patil",
    avatar: "NP",
    role: "Verifier Pro",
    title: "How to check if an Indian company is registered on MCA",
    content: "If you are suspicious about a small company or consultancy, you can quickly check if they are registered with the Ministry of Corporate Affairs (MCA). Go to the MCA website, search company name, and see if they have an active Corporate Identity Number (CIN). Fake agencies and scammers never have a real MCA registration. If they claim to be a private limited company but have no CIN, report them immediately!",
    category: "Guides",
    upvotes: 29,
    replies: [
      {
        author: "Siddharth V.",
        content: "Super helpful guide. We should integrate an automated MCA registry crawler into the JobGuard platform verification check in the future!",
        date: "18 hours ago"
      }
    ],
    date: "2 days ago"
  }
];
