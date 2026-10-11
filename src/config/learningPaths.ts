import type { Chapter } from './manual';

/** Career pathways reuse the workstation lessons and their existing progress. */
export const LEARNING_PATHS: readonly Chapter[] = [
  {
    "id": "career-roadmap",
    "title": "5-Step Career Roadmap",
    "summary": "Build, document, practise and apply. Recommended pacing: 12 weeks.",
    "lessons": [
      {
        "id": "roadmap-step-1",
        "title": "1 · Build an IT foundation",
        "objective": "Build an IT foundation using evidence from IAM Range.",
        "why": "Turn hands-on practice into demonstrable career skills through consistent work and clear evidence.",
        "steps": [
          {
            "do": "Complete bootcamp projects 1–3. Build the infrastructure in AD Enterprise Lab, then create staff separately in the main directory for Ticket Queue practice."
          },
          {
            "do": "Save a Writer document titled \"1 · Build an IT foundation\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Save OU/group structure, provisioning results, share/policy checks and resolved ticket evidence.",
        "interview": "\"Walk me through build an it foundation?\" Explain what you completed, how you verified it and what you would improve in a real organization.",
        "reading": "career-roadmap-guide",
        "app": "ad-lab",
        "lessonLinks": [
          "bootcamp-project-1",
          "bootcamp-project-2",
          "bootcamp-project-3"
        ],
        "appLinks": [
          {
            "label": "Open practice application",
            "app": "ad-lab"
          }
        ]
      },
      {
        "id": "roadmap-step-2",
        "title": "2 · Build IAM specialization",
        "objective": "Build IAM specialization using evidence from IAM Range.",
        "why": "Turn hands-on practice into demonstrable career skills through consistent work and clear evidence.",
        "steps": [
          {
            "do": "Complete bootcamp projects 4–8. Use Portfolio for lifecycle, governance and incident evidence; use your own cloud tenant for the authentication extensions."
          },
          {
            "do": "Save a Writer document titled \"2 · Build IAM specialization\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Save reviewed lifecycle, RBAC, governance, authentication and incident deliverables with their environment clearly labelled.",
        "interview": "\"Walk me through build iam specialization?\" Explain what you completed, how you verified it and what you would improve in a real organization.",
        "reading": "career-roadmap-guide",
        "app": "iam-portfolio",
        "lessonLinks": [
          "bootcamp-project-4",
          "bootcamp-project-5",
          "bootcamp-project-6",
          "bootcamp-project-7",
          "bootcamp-project-8"
        ],
        "appLinks": [
          {
            "label": "Open practice application",
            "app": "iam-portfolio"
          }
        ]
      },
      {
        "id": "roadmap-step-3",
        "title": "3 · Publish your portfolio",
        "objective": "Publish your portfolio using evidence from IAM Range.",
        "why": "Turn hands-on practice into demonstrable career skills through consistent work and clear evidence.",
        "steps": [
          {
            "do": "Draft a problem-focused post: the problem, business impact, what you did, and the proof. Use measured outcomes from your own work and label simulations. Keep secrets and personal data out of public artifacts."
          },
          {
            "do": "Save a Writer document titled \"3 · Publish your portfolio\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Prepare a portfolio write-up and demonstration backed by actual saved lab evidence.",
        "interview": "\"Walk me through publish your portfolio?\" Explain what you completed, how you verified it and what you would improve in a real organization.",
        "reading": "career-roadmap-guide",
        "app": "writer",
        "lessonLinks": [
          "analyst-docs",
          "evidence"
        ],
        "appLinks": [
          {
            "label": "Open practice application",
            "app": "writer"
          }
        ]
      },
      {
        "id": "roadmap-step-4",
        "title": "4 · Prepare for interviews",
        "objective": "Prepare for interviews using evidence from IAM Range.",
        "why": "Turn hands-on practice into demonstrable career skills through consistent work and clear evidence.",
        "steps": [
          {
            "do": "Rehearse each project aloud: problem, investigation, solution and verified result. Practise account status, groups, logs, MFA and policy checks for sign-in failures."
          },
          {
            "do": "Save a Writer document titled \"4 · Prepare for interviews\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Record a technical walkthrough and STAR answer that name the evidence and explain your decisions.",
        "interview": "\"Walk me through prepare for interviews?\" Explain what you completed, how you verified it and what you would improve in a real organization.",
        "reading": "career-roadmap-guide",
        "app": "interview",
        "lessonLinks": [
          "y1-capstone",
          "y2-capstone",
          "y3-incidents"
        ],
        "appLinks": [
          {
            "label": "Open practice application",
            "app": "interview"
          }
        ]
      },
      {
        "id": "roadmap-step-5",
        "title": "5 · Apply and keep building",
        "objective": "Apply and keep building using evidence from IAM Range.",
        "why": "Turn hands-on practice into demonstrable career skills through consistent work and clear evidence.",
        "steps": [
          {
            "do": "Track company, role, application date, method, status and next action in Sheets. Tailor your resume to your completed projects and keep practising while applying."
          },
          {
            "do": "Save a Writer document titled \"5 · Apply and keep building\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Save an application tracker with next actions and a resume that references completed portfolio evidence.",
        "interview": "\"Walk me through apply and keep building?\" Explain what you completed, how you verified it and what you would improve in a real organization.",
        "reading": "career-roadmap-guide",
        "app": "sheets",
        "lessonLinks": [
          "analyst-docs",
          "y2-capstone"
        ],
        "appLinks": [
          {
            "label": "Open practice application",
            "app": "sheets"
          }
        ]
      }
    ]
  },
  {
    "id": "bootcamp",
    "title": "12-Week Bootcamp",
    "summary": "Eight projects from IT foundations to identity incident response. Program exams and credentials are administered separately.",
    "lessons": [
      {
        "id": "bootcamp-project-1",
        "title": "1 · User lifecycle",
        "objective": "Weeks 1–2: build and document user lifecycle.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Create the OU and group structure before provisioning staff. Run the CSV-style onboarding template in PowerShell ISE, verify placement and memberships, then practise a move and a leaver."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"1 · User lifecycle\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "OU tree, provisioning script, before-and-after membership, and an audit record.",
        "interview": "\"Walk me through user lifecycle?\" Walk through your user lifecycle project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "active-directory",
        "lessonLinks": [
          "analyst-env",
          "analyst-provision",
          "joiner",
          "mover",
          "leaver"
        ],
        "appLinks": [
          {
            "label": "Open Active Directory",
            "app": "active-directory"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      },
      {
        "id": "bootcamp-project-2",
        "title": "2 · Device lifecycle",
        "objective": "Weeks 2–3: build and document device lifecycle.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Complete AD Enterprise networking, AD DS/DNS, routing, DHCP, domain join and GPO labs (01–05 and 08). Use endpoint tickets to practise diagnosis and repairs. Intune enrollment, encryption, compliance and disposal need a separate tenant and managed endpoint."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"2 · Device lifecycle\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Domain-join verification, policy checks, and endpoint diagnosis and repair notes.",
        "interview": "\"Walk me through device lifecycle?\" Walk through your device lifecycle project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "ad-lab",
        "lessonLinks": [
          "y1-network",
          "y1-windows",
          "y1-gpo",
          "analyst-policy"
        ],
        "appLinks": [
          {
            "label": "Open AD Enterprise Lab",
            "app": "ad-lab"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      },
      {
        "id": "bootcamp-project-3",
        "title": "3 · Ticket lifecycle",
        "objective": "Weeks 3–4: build and document ticket lifecycle.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Create staff in the main directory, then generate work in Ticket Queue. Read a ticket, connect using Remote Desktop, diagnose and repair, add a work note and resolve after verification. Practise AD Enterprise help-desk labs 10–11 too."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"3 · Ticket lifecycle\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Ticket symptom, cause, repair, verification and escalation notes.",
        "interview": "\"Walk me through ticket lifecycle?\" Walk through your ticket lifecycle project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "ticket-console",
        "lessonLinks": [
          "y1-helpdesk",
          "analyst-helpdesk",
          "y1-capstone"
        ],
        "appLinks": [
          {
            "label": "Open Ticket Queue",
            "app": "ticket-console"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      },
      {
        "id": "bootcamp-project-4",
        "title": "4 · Onboarding and access provisioning",
        "objective": "Weeks 5–6: build and document onboarding and access provisioning.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Open IAM Portfolio and select project 1: Automated Joiner-Mover-Leaver (JML) Pipeline, then project 2: Role-Based Access Control (RBAC) Matrix Design. Document approvals, role assignments and the provisioning audit. Challenge Lab 9 provides additional JML practice."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"4 · Onboarding and access provisioning\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Role matrix, approved access, provisioning results and audit evidence.",
        "interview": "\"Walk me through onboarding and access provisioning?\" Walk through your onboarding and access provisioning project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "iam-portfolio",
        "lessonLinks": [
          "joiner",
          "analyst-provision",
          "analyst-rbac",
          "analyst-docs"
        ],
        "appLinks": [
          {
            "label": "Open IAM Portfolio",
            "app": "iam-portfolio"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      },
      {
        "id": "bootcamp-project-5",
        "title": "5 · Offboarding and access revocation",
        "objective": "Weeks 6–7: build and document offboarding and access revocation.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Return to Portfolio project 1 and capture the leaver outcome separately. Disable access, check application provisioning and the sync/session gap, and write an offboarding SOP. M365 mailbox conversion and litigation hold require a separate tenant."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"5 · Offboarding and access revocation\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Account disablement, access revocation, application checks and offboarding SOP.",
        "interview": "\"Walk me through offboarding and access revocation?\" Walk through your offboarding and access revocation project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "iam-portfolio",
        "lessonLinks": [
          "leaver",
          "latency",
          "scim",
          "analyst-docs"
        ],
        "appLinks": [
          {
            "label": "Open IAM Portfolio",
            "app": "iam-portfolio"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      },
      {
        "id": "bootcamp-project-6",
        "title": "6 · Access governance and reviews",
        "objective": "Weeks 8–9: build and document access governance and reviews.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Build Portfolio projects 3 (access review), 4 (stale accounts) and 8 (JIT privilege). Record review decisions and remediation. Use Challenge Lab 10 for supporting access-review and JIT practice."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"6 · Access governance and reviews\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Review decisions, stale-account remediation, exception rationale and time-bounded privilege evidence.",
        "interview": "\"Walk me through access governance and reviews?\" Walk through your access governance and reviews project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "iam-portfolio",
        "lessonLinks": [
          "analyst-audit",
          "analyst-dormant",
          "certification",
          "y3-iga",
          "y3-pam"
        ],
        "appLinks": [
          {
            "label": "Open IAM Portfolio",
            "app": "iam-portfolio"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      },
      {
        "id": "bootcamp-project-7",
        "title": "7 · SSO and authentication",
        "objective": "Weeks 9–11: build and document sso and authentication.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Use Portfolio projects 5 (SSO) and 6 (Conditional Access), with optional project 7 (OIDC/OAuth). Complete Challenge Labs 4–8 in your own Entra tenant using Browser and PowerShell (this PC). Prepare permissions and feature licenses before starting; the simulated Cloud Identity console does not deploy these policies."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"7 · SSO and authentication\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Authentication flow, MFA and policy tests, and sign-in troubleshooting evidence.",
        "interview": "\"Walk me through sso and authentication?\" Walk through your sso and authentication project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "challenge-90",
        "lessonLinks": [
          "y2-sso",
          "y2-mfa",
          "y2-hybrid",
          "analyst-cloud"
        ],
        "appLinks": [
          {
            "label": "Open 90-Day Challenge",
            "app": "challenge-90"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      },
      {
        "id": "bootcamp-project-8",
        "title": "8 · Incident response capstone",
        "objective": "Weeks 11–12: build and document incident response capstone.",
        "why": "Practise the project as a business problem, prove the outcome, and save evidence another analyst can review.",
        "steps": [
          {
            "do": "Complete the supporting lessons below in order."
          },
          {
            "do": "Use Portfolio project 10 (SIEM) and Challenge Lab 13 to assemble an investigation. Record a timeline, containment, validation and executive report. Real Entra sign-in/audit logs and KQL need a separate cloud environment."
          },
          {
            "do": "Save the evidence in Writer and your portfolio. Include a problem statement, scripts/configuration, a 3–7 minute demonstration and a reflection."
          },
          {
            "do": "Save a Writer document titled \"8 · Incident response capstone\" with your project evidence and verification. Lab Plan checks this document and the supporting lesson evidence; the personal checklist is separate."
          }
        ],
        "verify": "Incident timeline, containment evidence, validation and executive report.",
        "interview": "\"Walk me through incident response capstone?\" Walk through your incident response capstone project: explain the problem, your decisions, the evidence and how you verified the result.",
        "reading": "bootcamp-guide",
        "app": "iam-portfolio",
        "lessonLinks": [
          "y3-incidents",
          "analyst-audit",
          "evidence",
          "emergency-access"
        ],
        "appLinks": [
          {
            "label": "Open IAM Portfolio",
            "app": "iam-portfolio"
          },
          {
            "label": "Write project evidence",
            "app": "writer"
          }
        ]
      }
    ]
  }
];
