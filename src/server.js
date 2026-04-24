import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import companies from 'companies-list';
import Fuse from 'fuse.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 5007);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Trivon@123';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'trivon_hiring';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,https://trivonssn.com,https://www.trivonssn.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const MAIL_TO = Array.from(
  new Set(
    (process.env.MAIL_TO || 'admin@trivonssn.com,praneethvadada24@gmail.com,hr@trivonss.com')
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean),
  ),
);
const MAIL_FROM = process.env.SMTP_USER || process.env.MAIL_FROM || 'no-reply@example.com';

const app = express();
const CATALOG_DIR = path.join(__dirname, '..', 'data', 'catalog');
const db = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/$/, '').toLowerCase();
}

const allowedCorsOrigins = new Set(CORS_ORIGINS.map(normalizeOrigin));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients and same-origin server-to-server calls.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedCorsOrigins.has(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

// const transporter = nodemailer.createTransport({
//   host: process.env.SMTP_HOST,
//   port: Number(process.env.SMTP_PORT || 465),
//   secure: String(process.env.SMTP_SECURE || 'true') === 'true',
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASS,
//   },
// });

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 🔍 Log config (without password)
console.log("[SMTP] Initializing transporter...");
console.log("[SMTP] Host:", process.env.SMTP_HOST);
console.log("[SMTP] Port:", process.env.SMTP_PORT);
console.log("[SMTP] Secure:", process.env.SMTP_SECURE);
console.log("[SMTP] User:", process.env.SMTP_USER);

// 🧪 Verify connection
transporter.verify((error, success) => {
  if (error) {
    console.error("[SMTP] Connection failed:", error);
  } else {
    console.log("[SMTP] Server is ready to send emails");
  }
});


async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id VARCHAR(120) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      type VARCHAR(40) NOT NULL,
      category VARCHAR(40) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'open',
      location VARCHAR(255) NOT NULL,
      duration VARCHAR(120) NOT NULL,
      start_date VARCHAR(120) NOT NULL,
      end_date VARCHAR(120) NOT NULL,
      salary VARCHAR(120) NULL,
      description TEXT NOT NULL,
      eligibility TEXT NOT NULL,
      responsibilities_json JSON NOT NULL,
      required_skills_json JSON NOT NULL,
      requirements_json JSON NOT NULL,
      other_requirements_json JSON NOT NULL,
      perks_json JSON NOT NULL,
      custom_fields_json JSON NULL,
      picker_options_json JSON NULL,
      posted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      job_id VARCHAR(120) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      alternate_phone VARCHAR(40) NULL,
      city VARCHAR(120) NULL,
      resume_link TEXT NULL,
      resume_name VARCHAR(255) NULL,
      application_summary LONGTEXT NULL,
      additional_info LONGTEXT NULL,
      education_json JSON NULL,
      experience_json JSON NULL,
      custom_answers_json JSON NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'submitted',
      status_note TEXT NULL,
      last_status_email_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_applications_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);

  try {
    await db.query('ALTER TABLE applications ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(40) NULL AFTER phone');
  } catch (error) {
    const [columns] = await db.query("SHOW COLUMNS FROM applications LIKE 'alternate_phone'");
    if (!columns.length) {
      await db.query('ALTER TABLE applications ADD COLUMN alternate_phone VARCHAR(40) NULL AFTER phone');
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS catalog_entities (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(40) NOT NULL,
      country VARCHAR(120) NOT NULL,
      state VARCHAR(120) NOT NULL DEFAULT '',
      district VARCHAR(120) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY catalog_entity_unique (type, name, country, state, district)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS application_status_events (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      application_id BIGINT NOT NULL,
      previous_status VARCHAR(40) NOT NULL,
      next_status VARCHAR(40) NOT NULL,
      status_note TEXT NULL,
      changed_by VARCHAR(120) NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_status_events_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
    )
  `);
}

function parseJsonValue(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toMySqlDatetime(value) {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const mysqlDatetimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (mysqlDatetimePattern.test(raw)) {
    return raw;
  }

  const isoLikeMatch = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (isoLikeMatch) {
    return `${isoLikeMatch[1]} ${isoLikeMatch[2]}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeJobInput(input) {
  return {
    id: String(input.id || '').trim(),
    title: String(input.title || '').trim(),
    type: String(input.type || 'internship').trim(),
    category: String(input.category || 'other').trim(),
    status: String(input.status || 'open').trim(),
    location: String(input.location || '').trim(),
    duration: String(input.duration || '').trim(),
    startDate: String(input.startDate || '').trim(),
    endDate: String(input.endDate || '').trim(),
    salary: input.salary ? String(input.salary).trim() : '',
    description: String(input.description || '').trim(),
    eligibility: String(input.eligibility || '').trim(),
    responsibilities: Array.isArray(input.responsibilities) ? input.responsibilities : parseJsonValue(input.responsibilities, []),
    requiredSkills: Array.isArray(input.requiredSkills) ? input.requiredSkills : parseJsonValue(input.requiredSkills, []),
    requirements: Array.isArray(input.requirements) ? input.requirements : parseJsonValue(input.requirements, []),
    otherRequirements: Array.isArray(input.otherRequirements) ? input.otherRequirements : parseJsonValue(input.otherRequirements, []),
    perks: Array.isArray(input.perks) ? input.perks : parseJsonValue(input.perks, []),
    customFields: Array.isArray(input.customFields) ? input.customFields : parseJsonValue(input.customFields, []),
    pickerOptions: typeof input.pickerOptions === 'object' && input.pickerOptions !== null
      ? input.pickerOptions
      : parseJsonValue(input.pickerOptions, {}),
    postedAt: toMySqlDatetime(input.postedAt),
  };
}

function mapJobRow(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    category: row.category,
    status: row.status,
    location: row.location,
    duration: row.duration,
    startDate: row.start_date,
    endDate: row.end_date,
    salary: row.salary || '',
    description: row.description,
    eligibility: row.eligibility,
    responsibilities: parseJsonValue(row.responsibilities_json, []),
    requiredSkills: parseJsonValue(row.required_skills_json, []),
    requirements: parseJsonValue(row.requirements_json, []),
    otherRequirements: parseJsonValue(row.other_requirements_json, []),
    perks: parseJsonValue(row.perks_json, []),
    customFields: parseJsonValue(row.custom_fields_json, []),
    pickerOptions: parseJsonValue(row.picker_options_json, {}),
    postedAt: row.posted_at,
  };
}

async function getAllJobs() {
  const [rows] = await db.query('SELECT * FROM jobs ORDER BY COALESCE(posted_at, created_at) DESC, created_at DESC');
  return rows.map(mapJobRow);
}

async function getJobById(id) {
  const [rows] = await db.query('SELECT * FROM jobs WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return null;
  return mapJobRow(rows[0]);
}

async function readJsonFile(filePath, fallback = []) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function loadCatalog() {
  const [rows] = await db.query('SELECT id, name, type, country, state, district FROM catalog_entities ORDER BY type, name');
  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    type: row.type,
    country: row.country,
    state: row.state || '',
    district: row.district || '',
  }));
}

function normalizeCatalogItem(body, typeFromRoute) {
  const type = String(typeFromRoute || body.type || '').trim();
  const name = String(body.name || '').trim();
  if (!['school', 'college', 'company', 'branch'].includes(type)) {
    throw new Error('Invalid catalog type');
  }
  if (!name) {
    throw new Error('Catalog name is required');
  }

  return {
    name,
    type,
    country: String(body.country || (type === 'company' ? 'Worldwide' : 'India')).trim(),
    state: String(body.state || '').trim(),
    district: String(body.district || '').trim(),
  };
}

async function searchCatalog(type, query = '') {
  const catalog = await loadCatalog();
  const filtered = type ? catalog.filter((item) => item.type === type) : catalog;
  if (!query.trim()) return filtered.slice(0, 100);

  const fuse = new Fuse(filtered, {
    keys: ['name', 'state', 'district', 'country'],
    threshold: 0.35,
    ignoreLocation: true,
  });

  return fuse.search(query.trim()).slice(0, 25).map((item) => item.item);
}

async function seedCatalogIfNeeded() {
  const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM catalog_entities');
  if (Number(count) > 0) {
    return;
  }

  const schoolSeed = await readJsonFile(path.join(CATALOG_DIR, 'india-schools.json'));
  const collegeSeed = await readJsonFile(path.join(CATALOG_DIR, 'india-colleges.json'));
  const companyList = Array.isArray(companies) ? companies : Object.values(companies || {});
  const companySeed = companyList
    .map((item) => (typeof item === 'string' ? item : item?.name || item?.company || item?.title || ''))
    .filter(Boolean)
    .slice(0, 1000)
    .map((name) => ({
      name,
      type: 'company',
      country: 'Worldwide',
      state: '',
      district: '',
    }));

  const branchSeed = [
    { name: 'Computer Science', type: 'branch', country: 'India', state: '', district: '' },
    { name: 'Information Technology', type: 'branch', country: 'India', state: '', district: '' },
    { name: 'Electronics and Communication', type: 'branch', country: 'India', state: '', district: '' },
    { name: 'Mechanical Engineering', type: 'branch', country: 'India', state: '', district: '' },
    { name: 'Business Administration', type: 'branch', country: 'India', state: '', district: '' },
  ];

  const seedItems = [...schoolSeed, ...collegeSeed, ...companySeed, ...branchSeed];

  for (const item of seedItems) {
    await db.query(
      `
        INSERT IGNORE INTO catalog_entities (name, type, country, state, district)
        VALUES (?, ?, ?, ?, ?)
      `,
      [item.name, item.type, item.country || 'India', item.state || '', item.district || ''],
    );
  }
}

async function sendCandidateStatusEmail({ to, name, jobTitle, status, note }) {
  const readableStatus = status.replace(/_/g, ' ');
  const text = [
    `Hi ${name},`,
    '',
    `Your application status for ${jobTitle} has been updated to: ${readableStatus}.`,
    note ? `Update note from HR: ${note}` : 'No extra note was provided by HR for this update.',
    '',
    'If you need help, please contact hr@trivonss.com.',
    '',
    'Regards,',
    'Trivon Hiring Team',
  ].join('\n');

  await transporter.sendMail({
    from: `Trivon Careers <${MAIL_FROM}>`,
    to,
    subject: `Application Status Update | ${jobTitle}`,
    text,
  });
}

function ensureAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: 'Missing authorization token' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function toMultiline(namePrefix, body) {
  const keys = Object.keys(body).filter((key) => key.startsWith(namePrefix));
  if (!keys.length) return 'Not provided';
  return keys
    .sort()
    .map((key) => `${key}: ${String(body[key]).trim() || 'N/A'}`)
    .join('\n');
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const namePattern = /^[a-zA-Z .'-]+$/;
const yearPattern = /^\d{4}$/;
const phonePattern = /^\d{10}$/;

function safeString(value) {
  return String(value || '').trim();
}

function isValidHttpUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateApplicationPayload(payload) {
  const errors = [];
  const fullName = safeString(payload.full_name);
  const email = safeString(payload.applicant_email).toLowerCase();
  const phone = safeString(payload.applicant_phone).replace(/\D/g, '');
  const alternatePhone = safeString(payload.applicant_alt_phone).replace(/\D/g, '');
  const city = safeString(payload.city || payload.display_city);
  const resumeLink = safeString(payload.resume_link);
  const additionalInfo = safeString(payload.additional_info);
  const applicationSummary = safeString(payload.application_summary);
  const education = parseJsonValue(payload.education_json, []);
  const experience = parseJsonValue(payload.experience_json, []);

  if (!safeString(payload.job_id) || !safeString(payload.job_title)) {
    errors.push('Job details are required.');
  }

  if (fullName.length < 3 || fullName.length > 80 || !namePattern.test(fullName)) {
    errors.push('Full name must be 3-80 characters and contain only letters/spaces.');
  }

  if (!emailPattern.test(email) || email.length > 254) {
    errors.push('Valid email is required.');
  }

  if (!phonePattern.test(phone)) {
    errors.push('Phone number must be exactly 10 digits.');
  }

  if (alternatePhone && !phonePattern.test(alternatePhone)) {
    errors.push('Alternate phone number must be exactly 10 digits when provided.');
  }

  if (city.length > 80) {
    errors.push('City must be at most 80 characters.');
  }

  if (resumeLink.length > 300 || !isValidHttpUrl(resumeLink)) {
    errors.push('Resume link must be a valid URL with max length 300.');
  }

  if (additionalInfo.length > 1000) {
    errors.push('Additional info must be at most 1000 characters.');
  }

  if (applicationSummary.length > 20000) {
    errors.push('Application summary is too long.');
  }

  if (!Array.isArray(education) || education.length > 10) {
    errors.push('Education payload is invalid.');
  } else {
    const allowedEducationLevels = new Set(['Schooling', 'Intermediate', 'Diploma', 'Degree', 'Postgraduate']);
    education.forEach((entry) => {
      const educationLevel = safeString(entry?.educationLevel);
      const degree = safeString(entry?.degree);
      const field = safeString(entry?.field);
      const institution = safeString(entry?.institution);
      const graduationYear = safeString(entry?.graduationYear);
      const gpa = safeString(entry?.gpa);
      const hasValue = [educationLevel, degree, field, institution, graduationYear, gpa].some(Boolean);
      if (!hasValue) return;

      if (!allowedEducationLevels.has(educationLevel)) errors.push('Education level must be one of Schooling/Intermediate/Diploma/Degree/Postgraduate.');
      if (degree.length < 2 || degree.length > 80) errors.push('Education degree must be 2-80 characters.');
      if (field.length < 2 || field.length > 80) errors.push('Education field must be 2-80 characters.');
      if (institution.length < 2 || institution.length > 120) errors.push('Institution must be 2-120 characters.');
      if (!yearPattern.test(graduationYear)) errors.push('Graduation year must be exactly 4 digits.');
      if (gpa.length > 20) errors.push('GPA/score must be at most 20 characters.');
    });
  }

  if (!Array.isArray(experience) || experience.length > 10) {
    errors.push('Experience payload is invalid.');
  } else {
    experience.forEach((entry) => {
      const jobTitle = safeString(entry?.jobTitle);
      const company = safeString(entry?.company);
      const duration = safeString(entry?.duration);
      const description = safeString(entry?.description);
      const hasValue = [jobTitle, company, duration, description].some(Boolean);
      if (!hasValue) return;

      if (jobTitle.length < 2 || jobTitle.length > 80) errors.push('Experience title must be 2-80 characters.');
      if (company.length < 2 || company.length > 100) errors.push('Experience company must be 2-100 characters.');
      if (duration.length < 2 || duration.length > 60) errors.push('Experience duration must be 2-60 characters.');
      if (description.length < 20 || description.length > 1000) errors.push('Experience summary must be 20-1000 characters.');
    });
  }

  const customAnswers = Object.entries(payload || {})
    .filter(([key]) => key.startsWith('custom_field_'))
    .map(([, value]) => safeString(value));
  if (customAnswers.some((value) => value.length > 500)) {
    errors.push('Custom field answers must be at most 500 characters each.');
  }

  const marketingAnswers = Object.entries(payload || {})
    .filter(([key]) => key.startsWith('marketing_question_'))
    .map(([, value]) => safeString(value));
  if (marketingAnswers.some((value) => value.length > 1000)) {
    errors.push('Marketing answers must be at most 1000 characters each.');
  }

  return {
    errors,
    cleaned: {
      jobId: safeString(payload.job_id),
      jobTitle: safeString(payload.job_title),
      fullName,
      email,
      phone,
      alternatePhone,
      city,
      applicationSummary,
      resumeName: safeString(payload.resume_name),
      resumeLink,
      additionalInfo,
      education,
      experience,
    },
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'trivon-careers-backend' });
});

app.get('/api/admin/catalog', ensureAdminAuth, async (req, res) => {
  try {
    const type = String(req.query.type || '').trim();
    const query = String(req.query.query || '').trim();
    const items = await searchCatalog(type, query);
    res.json(items);
  } catch (error) {
    console.error('Catalog search failed:', error);
    res.status(500).json({ message: 'Failed to load catalog' });
  }
});

app.get('/api/catalog', async (req, res) => {
  try {
    const type = String(req.query.type || '').trim();
    const search = String(req.query.search || '').trim();
    const items = await searchCatalog(type, search);
    res.json(items);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to load catalog' });
  }
});

app.post('/api/admin/catalog', ensureAdminAuth, async (req, res) => {
  try {
    const item = normalizeCatalogItem(req.body || {});
    const [result] = await db.query(
      `
        INSERT INTO catalog_entities (name, type, country, state, district)
        VALUES (?, ?, ?, ?, ?)
      `,
      [item.name, item.type, item.country, item.state, item.district],
    );

    res.status(201).json({
      id: String(result.insertId),
      ...item,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Duplicate')) {
      return res.status(409).json({ message: 'Catalog item already exists' });
    }
    res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to add catalog item' });
  }
});

app.delete('/api/admin/catalog/:type/:id', ensureAdminAuth, async (req, res) => {
  try {
    const type = String(req.params.type || '').trim();
    const [result] = await db.query(
      'DELETE FROM catalog_entities WHERE id = ? AND type = ?',
      [req.params.id, type],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Catalog item not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to delete catalog item' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: 'Invalid admin credentials' });
  }

  const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

app.get('/api/public/jobs', async (_req, res) => {
  try {
    const jobs = await getAllJobs();
    res.json(jobs);
  } catch (error) {
    console.error('Failed to fetch public jobs:', error);
    res.status(500).json({ message: 'Failed to fetch roles' });
  }
});

app.get('/api/public/jobs/:id', async (req, res) => {
  const job = await getJobById(req.params.id);

  if (!job) {
    return res.status(404).json({ message: 'Role not found' });
  }

  res.json(job);
});

app.post('/api/public/apply', upload.single('resume_file'), async (req, res) => {
  try {
    const { errors, cleaned } = validateApplicationPayload(req.body || {});
    // if (errors.length) {
    //   return res.status(400).json({
    //     message: 'Invalid application input',
    //     errors,
    //   });
    if (errors.length) {
  console.warn("[APPLY] Validation failed:", errors);
  return res.status(400).json({
    message: 'Invalid application input',
    errors,
  });

    }

    const marketingScenarioAnswers = toMultiline('marketing_question_', req.body);
    const customAnswers = Object.entries(req.body)
      .filter(([key]) => key.startsWith('custom_field_'))
      .reduce((acc, [key, value]) => ({ ...acc, [key.replace('custom_field_', '')]: String(value || '') }), {});

    const text = [
      'New Job Application Received',
      '',
      `Job ID: ${cleaned.jobId}`,
      `Job Title: ${cleaned.jobTitle}`,
      `Applicant Name: ${cleaned.fullName}`,
      `Applicant Email: ${cleaned.email}`,
      `Applicant Phone: ${cleaned.phone}`,
      `Alternate Phone: ${cleaned.alternatePhone || 'Not provided'}`,
      `City: ${cleaned.city || 'Not provided'}`,
      '',
      `Resume Name: ${cleaned.resumeName || req.file?.originalname || 'Not provided'}`,
      `Resume Link: ${cleaned.resumeLink || 'Not provided'}`,
      '',
      'Scenario and role-specific answers:',
      marketingScenarioAnswers,
      '',
      'Additional Information:',
      cleaned.additionalInfo || 'Not provided',
      '',
      'Custom Fields Answers:',
      Object.keys(customAnswers).length ? JSON.stringify(customAnswers, null, 2) : 'Not provided',
      '',
      'Application Summary:',
      cleaned.applicationSummary || 'Not provided',
    ].join('\n');

    const attachments = [];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        content: req.file.buffer,
        contentType: req.file.mimetype,
      });
    }

    await transporter.sendMail({
      from: `Trivon Careers <${MAIL_FROM}>`,
      to: MAIL_TO,
      subject: `Job Application | ${cleaned.jobTitle} | ${cleaned.fullName}`,
      replyTo: cleaned.email,
      text,
      attachments,
    });

    await db.query(
      `
      INSERT INTO applications (
        job_id,
        full_name,
        email,
        phone,
        alternate_phone,
        city,
        resume_link,
        resume_name,
        application_summary,
        additional_info,
        education_json,
        experience_json,
        custom_answers_json,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleaned.jobId,
        cleaned.fullName,
        cleaned.email,
        cleaned.phone,
        cleaned.alternatePhone || '',
        cleaned.city || '',
        cleaned.resumeLink || '',
        cleaned.resumeName || req.file?.originalname || '',
        cleaned.applicationSummary || '',
        cleaned.additionalInfo || '',
        JSON.stringify(cleaned.education || []),
        JSON.stringify(cleaned.experience || []),
        JSON.stringify(customAnswers),
        'submitted',
      ],
    );

    res.json({ ok: true, message: 'Application submitted successfully' });
  } catch (error) {
    console.error('SMTP send failed:', error);
    res.status(500).json({ message: 'Failed to submit application' });
  }
});

app.get('/api/admin/jobs', ensureAdminAuth, async (_req, res) => {
  try {
    const jobs = await getAllJobs();
    res.json(jobs);
  } catch (error) {
    console.error('Failed to fetch admin jobs:', error);
    res.status(500).json({ message: 'Failed to fetch roles' });
  }
});

app.post('/api/admin/jobs', ensureAdminAuth, async (req, res) => {
  const newJob = normalizeJobInput(req.body || {});

  if (!newJob?.id || !newJob?.title) {
    return res.status(400).json({ message: 'Job id and title are required' });
  }

  const existing = await getJobById(newJob.id);
  if (existing) {
    return res.status(409).json({ message: 'Job id already exists' });
  }

  await db.query(
    `
      INSERT INTO jobs (
        id, title, type, category, status, location, duration,
        start_date, end_date, salary, description, eligibility,
        responsibilities_json, required_skills_json, requirements_json,
        other_requirements_json, perks_json, custom_fields_json, picker_options_json, posted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      newJob.id,
      newJob.title,
      newJob.type,
      newJob.category,
      newJob.status,
      newJob.location,
      newJob.duration,
      newJob.startDate,
      newJob.endDate,
      newJob.salary || null,
      newJob.description,
      newJob.eligibility,
      JSON.stringify(newJob.responsibilities || []),
      JSON.stringify(newJob.requiredSkills || []),
      JSON.stringify(newJob.requirements || []),
      JSON.stringify(newJob.otherRequirements || []),
      JSON.stringify(newJob.perks || []),
      JSON.stringify(newJob.customFields || []),
      JSON.stringify(newJob.pickerOptions || {}),
      newJob.postedAt || null,
    ],
  );

  const created = await getJobById(newJob.id);
  res.status(201).json(created);
});

app.put('/api/admin/jobs/:id', ensureAdminAuth, async (req, res) => {
  const existing = await getJobById(req.params.id);
  if (!existing) {
    return res.status(404).json({ message: 'Role not found' });
  }

  const updates = normalizeJobInput({ ...existing, ...req.body, id: existing.id });

  await db.query(
    `
      UPDATE jobs
      SET
        title = ?,
        type = ?,
        category = ?,
        status = ?,
        location = ?,
        duration = ?,
        start_date = ?,
        end_date = ?,
        salary = ?,
        description = ?,
        eligibility = ?,
        responsibilities_json = ?,
        required_skills_json = ?,
        requirements_json = ?,
        other_requirements_json = ?,
        perks_json = ?,
        custom_fields_json = ?,
        picker_options_json = ?,
        posted_at = ?
      WHERE id = ?
    `,
    [
      updates.title,
      updates.type,
      updates.category,
      updates.status,
      updates.location,
      updates.duration,
      updates.startDate,
      updates.endDate,
      updates.salary || null,
      updates.description,
      updates.eligibility,
      JSON.stringify(updates.responsibilities || []),
      JSON.stringify(updates.requiredSkills || []),
      JSON.stringify(updates.requirements || []),
      JSON.stringify(updates.otherRequirements || []),
      JSON.stringify(updates.perks || []),
      JSON.stringify(updates.customFields || []),
      JSON.stringify(updates.pickerOptions || {}),
      updates.postedAt || null,
      req.params.id,
    ],
  );

  const updated = await getJobById(req.params.id);
  res.json(updated);
});

app.get('/api/admin/jobs/:id/applications', ensureAdminAuth, async (req, res) => {
  const [rows] = await db.query(
    `
      SELECT
        id,
        job_id,
        full_name,
        email,
        phone,
        alternate_phone,
        city,
        resume_link,
        resume_name,
        application_summary,
        additional_info,
        education_json,
        experience_json,
        custom_answers_json,
        status,
        status_note,
        created_at,
        updated_at
      FROM applications
      WHERE job_id = ?
      ORDER BY created_at DESC
    `,
    [req.params.id],
  );

  res.json(rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    alternatePhone: row.alternate_phone || '',
    city: row.city || '',
    resumeLink: row.resume_link || '',
    resumeName: row.resume_name || '',
    applicationSummary: row.application_summary || '',
    additionalInfo: row.additional_info || '',
    education: parseJsonValue(row.education_json, []),
    experience: parseJsonValue(row.experience_json, []),
    customAnswers: parseJsonValue(row.custom_answers_json, {}),
    status: row.status,
    statusNote: row.status_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })));
});

app.get('/api/admin/applications/:id', ensureAdminAuth, async (req, res) => {
  const [rows] = await db.query(
    `
      SELECT
        a.id,
        a.job_id,
        a.full_name,
        a.email,
        a.phone,
        a.alternate_phone,
        a.city,
        a.resume_link,
        a.resume_name,
        a.application_summary,
        a.additional_info,
        a.education_json,
        a.experience_json,
        a.custom_answers_json,
        a.status,
        a.status_note,
        a.created_at,
        a.updated_at,
        j.title AS job_title
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.id = ?
      LIMIT 1
    `,
    [req.params.id],
  );

  if (!rows.length) {
    return res.status(404).json({ message: 'Application not found' });
  }

  const row = rows[0];
  res.json({
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    alternatePhone: row.alternate_phone || '',
    city: row.city || '',
    resumeLink: row.resume_link || '',
    resumeName: row.resume_name || '',
    applicationSummary: row.application_summary || '',
    additionalInfo: row.additional_info || '',
    education: parseJsonValue(row.education_json, []),
    experience: parseJsonValue(row.experience_json, []),
    customAnswers: parseJsonValue(row.custom_answers_json, {}),
    status: row.status,
    statusNote: row.status_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

app.patch('/api/admin/applications/:id/status', ensureAdminAuth, async (req, res) => {
  const applicationId = Number(req.params.id);
  const { status, statusNote } = req.body || {};

  if (!applicationId || !status) {
    return res.status(400).json({ message: 'Application id and status are required' });
  }

  const [rows] = await db.query(
    `
      SELECT a.*, j.title AS job_title
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.id = ?
      LIMIT 1
    `,
    [applicationId],
  );

  if (!rows.length) {
    return res.status(404).json({ message: 'Application not found' });
  }

  const application = rows[0];
  const previousStatus = application.status;

  await db.query(
    `
      UPDATE applications
      SET status = ?, status_note = ?, last_status_email_at = NOW()
      WHERE id = ?
    `,
    [String(status), String(statusNote || ''), applicationId],
  );

  await db.query(
    `
      INSERT INTO application_status_events (application_id, previous_status, next_status, status_note, changed_by)
      VALUES (?, ?, ?, ?, ?)
    `,
    [applicationId, previousStatus, String(status), String(statusNote || ''), req.admin?.username || 'admin'],
  );

  try {
    await sendCandidateStatusEmail({
      to: application.email,
      name: application.full_name,
      jobTitle: application.job_title,
      status: String(status),
      note: String(statusNote || ''),
    });
  } catch (error) {
    console.error('Status email send failed:', error);
  }

  res.json({ ok: true });
});

app.get('/api/admin/picker-options', ensureAdminAuth, (_req, res) => {
  const colleges = (process.env.COLLEGE_OPTIONS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const schools = (process.env.SCHOOL_OPTIONS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const companies = (process.env.COMPANY_OPTIONS || '').split(',').map((item) => item.trim()).filter(Boolean);
  res.json({ colleges, schools, companies });
});

app.delete('/api/admin/jobs/:id', ensureAdminAuth, async (req, res) => {
  const existing = await getJobById(req.params.id);
  if (!existing) {
    return res.status(404).json({ message: 'Role not found' });
  }

  await db.query('DELETE FROM jobs WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  if (error?.message && String(error.message).startsWith('CORS blocked for origin:')) {
    return res.status(403).json({ message: error.message });
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Resume file too large. Max allowed is 8MB.' });
  }
  return res.status(500).json({ message: 'Internal server error' });
});

async function bootstrap() {
  try {
    await ensureSchema();
    await seedCatalogIfNeeded();
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
      console.log(`MySQL connected: ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);
      console.log(`CORS origins: ${Array.from(allowedCorsOrigins).join(', ') || 'none configured'}`);
    });
  } catch (error) {
    console.error('Failed to start backend:', error);
    process.exit(1);
  }
}

bootstrap();
