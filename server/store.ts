import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildSimplePdfBuffer, chunkDocumentPages, extractPdfPages } from './rag.ts';
import type {
  ChatSession,
  DocumentChunk,
  DocumentRecord,
  StoreData,
  UserRecord,
  WorkspaceSettings,
} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
const STORE_PATH = path.resolve(DATA_DIR, 'store.json');

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  llmModel: 'gemini-4-hydrogen',
  enableFallbackModel: true,
  thinkingLevel: 'MEDIUM',
  embeddingMode: 'gemini-embedding-2',
  topK: 5,
  chunkSizeChars: 750,
  chunkOverlapChars: 150,
};

const EMPTY_STORE: StoreData = {
  users: [],
  documents: [],
  chunks: [],
  chatSessions: [],
  seeded: false,
  settings: { ...DEFAULT_WORKSPACE_SETTINGS },
};

let storeCache: StoreData | null = null;

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

export function resolveSafeUploadPath(filename: string): string {
  const safeName = path.basename(filename);
  const resolved = path.resolve(UPLOADS_DIR, safeName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid upload file path.');
  }
  return resolved;
}

export function loadStore(): StoreData {
  if (storeCache) return storeCache;
  ensureDirectories();
  if (!fs.existsSync(STORE_PATH)) {
    storeCache = structuredClone(EMPTY_STORE);
    saveStore(storeCache);
    return storeCache;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    storeCache = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      chatSessions: Array.isArray(parsed.chatSessions) ? parsed.chatSessions : [],
      seeded: Boolean(parsed.seeded),
      settings: {
        ...DEFAULT_WORKSPACE_SETTINGS,
        ...(parsed.settings ?? {}),
      },
    };
  } catch {
    storeCache = structuredClone(EMPTY_STORE);
  }
  return storeCache;
}

export function getWorkspaceSettings(): WorkspaceSettings {
  const store = loadStore();
  if (!store.settings) {
    store.settings = { ...DEFAULT_WORKSPACE_SETTINGS };
  }
  return store.settings;
}

export function saveStore(data: StoreData): void {
  ensureDirectories();
  storeCache = data;
  const tempPath = `${STORE_PATH}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, STORE_PATH);
}

interface StarterDocumentSpec {
  id: string;
  originalName: string;
  department: string;
  description: string;
  isStarterDefaultForUsers: boolean;
  pages: string[];
}

const STARTER_DOCS: StarterDocumentSpec[] = [
  {
    id: 'doc-hr-leave-policy',
    originalName: 'HR_Leave_Policy_2026.pdf',
    department: 'Human Resources',
    description:
      'Employee annual vacation allowance, sick leave, parental leave, and approval procedures.',
    isStarterDefaultForUsers: true,
    pages: [
      [
        'NORTHSTAR ENTERPRISE - HR LEAVE & TIME-OFF POLICY (2026)',
        'Section 1: Annual Paid Vacation Leave',
        'Full-time employees accrue 22 business days of paid annual leave per calendar year, accrued monthly at 1.83 days per month.',
        'Employees with 5 or more years of continuous service receive an additional 5 loyalty leave days, bringing their total to 27 paid vacation days per year.',
        'Up to 5 unused annual leave days may carry over into Q1 of the next calendar year and must be used before March 31.',
        'Leave requests of 3 days or fewer require manager approval at least 5 business days in advance. Leave requests of 4 or more consecutive days must be submitted at least 14 calendar days ahead.',
      ].join('\n'),
      [
        'Section 2: Sick Leave & Wellness Days',
        'All full-time employees receive 12 paid sick and medical leave days annually starting on their first day of employment.',
        'Absences exceeding 3 consecutive working days require a medical certificate uploaded confidentially to the HR portal upon return.',
        'In addition, every employee receives 2 paid Personal Wellness Days per year that may be taken without prior medical documentation.',
        'Section 3: Bereavement & Jury Duty',
        'Employees are entitled to 5 paid bereavement days following the loss of an immediate family member and full paid leave for mandatory jury service.',
      ].join('\n'),
      [
        'Section 4: Parental & Family Leave',
        'Primary caregivers are eligible for 16 weeks of 100% paid parental leave following birth, adoption, or foster placement.',
        'Secondary caregivers receive 8 weeks of 100% paid parental leave, which may be taken continuously or split into two blocks within 12 months of arrival.',
        'Returning parents may request a 4-week phased return-to-work schedule at 80% hours with full base salary compensation.',
      ].join('\n'),
    ],
  },
  {
    id: 'doc-finance-expense-policy',
    originalName: 'Finance_Expense_Policy_2026.pdf',
    department: 'Finance',
    description:
      'Corporate travel reimbursement caps, per-diem meal limits, software procurement, and approval thresholds.',
    isStarterDefaultForUsers: false,
    pages: [
      [
        'NORTHSTAR ENTERPRISE - FINANCE & EXPENSE REIMBURSEMENT POLICY (2026)',
        'Section 1: Business Travel & Lodging Caps',
        'Domestic economy airfare must be booked at least 14 days prior to departure through the corporate travel portal.',
        'Standard hotel reimbursement is capped at $240 per night before taxes in Tier-2 cities and $325 per night in Tier-1 metropolitan hubs (New York, London, Tokyo, San Francisco).',
        'Business-class flights are permitted only for international flights exceeding 8 hours of continuous flight time and require VP-level pre-approval.',
      ].join('\n'),
      [
        'Section 2: Meals, Ground Transport & Receipts',
        'Daily meal reimbursement (per diem) is capped at $75 per day for domestic travel and $95 per day for international travel. Alcohol is excluded from reimbursement unless part of an approved client dinner.',
        'Itemized receipts are mandatory for any single expense exceeding $25. Expenses must be submitted within 30 calendar days of the transaction date.',
        'Section 3: Software & Vendor Procurement Limits',
        'Team leads may approve SaaS purchases up to $500 per month. Purchases between $500 and $5,000 require Finance Controller sign-off and Security review.',
      ].join('\n'),
    ],
  },
  {
    id: 'doc-it-security-guidelines',
    originalName: 'IT_Security_Guidelines_2026.pdf',
    department: 'IT Security',
    description:
      'Mandatory MFA, WireGuard VPN rules, endpoint encryption, incident response SLAs, and AI data handling.',
    isStarterDefaultForUsers: false,
    pages: [
      [
        'NORTHSTAR ENTERPRISE - IT SECURITY & ACCESS GUIDELINES (2026)',
        'Section 1: Authentication & Endpoint Security',
        'Hardware-backed FIDO2 or authenticator-app Multi-Factor Authentication (MFA) is mandatory for all corporate SSO accounts, email, and cloud consoles. SMS-based OTP is prohibited.',
        'All company laptops must run full-disk encryption (FileVault on macOS or BitLocker on Windows) with automatic screen lock enforced after 5 minutes of inactivity.',
        'USB mass storage devices are disabled by default on engineering and finance workstations.',
      ].join('\n'),
      [
        'Section 2: Remote Access & Incident Reporting',
        'Remote access to internal staging, payroll, or database networks requires connecting through the corporate WireGuard VPN using a device-bound certificate.',
        'Suspected phishing emails, lost devices, or credential exposures must be reported to security@northstar.internal within 1 hour of discovery.',
        'Section 3: Confidential Data Handling',
        'Customer PII, financial projections, and unreleased source code must never be uploaded to unapproved external consumer AI tools.',
      ].join('\n'),
    ],
  },
];

export async function ensureStarterDocumentsSeeded(): Promise<void> {
  const store = loadStore();
  if (store.seeded) return;

  for (const spec of STARTER_DOCS) {
    if (store.documents.some((d) => d.id === spec.id)) continue;

    const pdfBuffer = buildSimplePdfBuffer(spec.originalName, spec.pages);
    const storedFilename = `${spec.id}.pdf`;
    const filePath = resolveSafeUploadPath(storedFilename);
    fs.writeFileSync(filePath, pdfBuffer);

    const extractedPages = await extractPdfPages(new Uint8Array(pdfBuffer));
    const chunks = chunkDocumentPages({
      documentId: spec.id,
      documentName: spec.originalName,
      department: spec.department,
      pages: extractedPages,
    });

    const docRecord: DocumentRecord = {
      id: spec.id,
      filename: storedFilename,
      originalName: spec.originalName,
      department: spec.department,
      description: spec.description,
      pageCount: extractedPages.length,
      chunkCount: chunks.length,
      fileSizeBytes: pdfBuffer.byteLength,
      uploadedBy: 'System Starter Corpus',
      uploadedAt: new Date().toISOString(),
      embeddingProvider: 'local-tfidf',
      isStarterDefaultForUsers: spec.isStarterDefaultForUsers,
    };

    store.documents.push(docRecord);
    store.chunks.push(...chunks);
  }

  store.seeded = true;
  saveStore(store);
}

export function getUserById(id: string): UserRecord | undefined {
  return loadStore().users.find((u) => u.id === id);
}

export function getUserByEmail(email: string): UserRecord | undefined {
  const normalized = email.trim().toLowerCase();
  return loadStore().users.find((u) => u.email.toLowerCase() === normalized);
}

export function getAuthorizedDocumentIdsForUser(user: UserRecord): string[] {
  const store = loadStore();
  if (user.role === 'admin') {
    return store.documents.map((d) => d.id);
  }
  const existingIds = new Set(store.documents.map((d) => d.id));
  return user.allowedDocumentIds.filter((id) => existingIds.has(id));
}

export function getChunksForDocumentIds(docIds: string[]): DocumentChunk[] {
  const allowed = new Set(docIds);
  return loadStore().chunks.filter((c) => allowed.has(c.documentId));
}

export function getSessionsForUser(userId: string): ChatSession[] {
  return loadStore()
    .chatSessions.filter((s) => s.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
