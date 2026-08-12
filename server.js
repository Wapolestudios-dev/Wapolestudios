const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PRIVATE = path.join(ROOT, 'private');
const UPLOADS = path.join(PRIVATE, 'uploads');
const COMPLETED = path.join(PRIVATE, 'completed');
for (const dir of [PRIVATE, UPLOADS, COMPLETED]) fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(PRIVATE, 'wapole.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  services_json TEXT NOT NULL,
  package_name TEXT,
  package_price INTEGER DEFAULT 0,
  total INTEGER NOT NULL,
  audio_path TEXT,
  audio_original_name TEXT,
  description TEXT,
  lyrics TEXT,
  transaction_ref TEXT NOT NULL,
  payment_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  completed_path TEXT,
  completed_original_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
`);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const publicDir = path.join(ROOT, 'public');
app.use(express.static(publicDir, {
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

const SERVICES = {
  "Logo Design": 50000,
  "Music Cover": 20000,
  "Lyrics Video": 30000,
  "Poster Design": 30000,
  "Album Cover Design": 50000,
  "Ticket (Promo Kit)": 15000,
  "Music Distribution": 50000
};
const PACKAGES = {
  "STARTER PLAN": { price: 100000, includes: ["Music Cover","Lyrics Video","Music Distribution"] },
  "ARTIST PLAN": { price: 200000, includes: ["Music Cover","Music Release Cover","Lyrics Video","Music Distribution"] },
  "PREMIUM PLAN": { price: 350000, includes: ["Music Cover","Music Release Cover","YouTube Thumbnail","Lyrics Video","Music Distribution","Music Promotion"] }
};

const uploadStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = new Set([
      'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave',
      'audio/mp4','audio/aac','audio/ogg','audio/webm','audio/flac'
    ]);
    cb(null, allowed.has(file.mimetype));
  }
});

const adminSessions = new Map();
function requireAdmin(req, res, next) {
  const sid = req.cookies?.wapole_admin;
  if (!sid || !adminSessions.has(sid)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').filter(Boolean).map(x => {
    const i = x.indexOf('=');
    return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1).trim())];
  }));
}
app.use((req,res,next)=>{ req.cookies = parseCookies(req); next(); });

const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 80, standardHeaders: true, legacyHeaders: false });
const trackLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });

function cleanText(v, max=5000) {
  return String(v ?? '').trim().slice(0,max);
}
function normalizeEmail(v) { return cleanText(v,200).toLowerCase(); }
function normalizePhone(v) { return cleanText(v,40).replace(/[^\d+]/g,''); }
function safeEqual(a,b) {
  const A=Buffer.from(String(a)); const B=Buffer.from(String(b));
  return A.length===B.length && crypto.timingSafeEqual(A,B);
}
function orderPublic(o) {
  return {
    orderId:o.order_id, customerName:o.full_name, phone:o.phone, email:o.email,
    services:JSON.parse(o.services_json), packageName:o.package_name || null,
    total:o.total, paymentStatus:o.transaction_ref ? 'Payment reference submitted' : 'Pending',
    orderStatus:o.status, description:o.description || '', lyrics:o.lyrics || '',
    createdAt:o.created_at, updatedAt:o.updated_at,
    completed: !!o.completed_path,
    completedFileName:o.completed_original_name || null
  };
}

app.post('/api/orders', publicLimiter, upload.single('audio'), (req,res)=>{
  try {
    const fullName=cleanText(req.body.fullName,150);
    const phone=normalizePhone(req.body.phone);
    const email=normalizeEmail(req.body.email);
    const transactionRef=cleanText(req.body.transactionRef,150);
    const paymentName=cleanText(req.body.paymentName,150);
    const description=cleanText(req.body.description,5000);
    const lyrics=cleanText(req.body.lyrics,15000);
    let services=[];
    try { services=JSON.parse(req.body.services || '[]'); } catch {}
    services=[...new Set(services)].filter(s=>Object.prototype.hasOwnProperty.call(SERVICES,s));
    const packageName=cleanText(req.body.packageName,80);
    const pkg=PACKAGES[packageName];
    if (!fullName || !phone || !email || !transactionRef || !paymentName) return res.status(400).json({error:'Please complete all required customer and payment fields.'});
    if (!services.length && !pkg) return res.status(400).json({error:'Select at least one service or package.'});
    const total=pkg ? pkg.price : services.reduce((sum,s)=>sum+SERVICES[s],0);
    const now=new Date().toISOString();
    const next = db.prepare('SELECT COALESCE(MAX(id),1000)+1 AS n FROM orders').get().n;
    const orderId='WP-'+next;
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const multer = require
