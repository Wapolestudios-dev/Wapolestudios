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
    const audioPath=req.file ? path.basename(req.file.path) : null;
    const stmt=db.prepare(`INSERT INTO orders
      (order_id,full_name,phone,email,services_json,package_name,package_price,total,audio_path,audio_original_name,description,lyrics,transaction_ref,payment_name,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    stmt.run(orderId,fullName,phone,email,JSON.stringify(services),pkg?packageName:null,pkg?pkg.price:0,total,audioPath,req.file?.originalname||null,description,lyrics,transactionRef,paymentName,'Pending',now,now);
    res.json({ok:true, orderId, total});
  } catch (e) {
    if (req.file?.path) try{fs.unlinkSync(req.file.path)}catch{}
    console.error(e);
    res.status(500).json({error:'Unable to create order.'});
  }
});

app.post('/api/track', trackLimiter, (req,res)=>{
  const orderId=cleanText(req.body.orderId,40).toUpperCase();
  const identifier=cleanText(req.body.identifier,200);
  if(!orderId || !identifier) return res.status(400).json({error:'Enter Order ID and phone number or email.'});
  const o=db.prepare('SELECT * FROM orders WHERE order_id=?').get(orderId);
  if(!o) return res.status(404).json({error:'Order not found or details do not match.'});
  const phoneMatch=safeEqual(normalizePhone(o.phone),normalizePhone(identifier));
  const emailMatch=safeEqual(normalizeEmail(o.email),normalizeEmail(identifier));
  if(!phoneMatch && !emailMatch) return res.status(404).json({error:'Order not found or details do not match.'});
  res.json({ok:true, order:orderPublic(o)});
});

function findVerifiedOrder(req) {
  const orderId=cleanText(req.body.orderId,40).toUpperCase();
  const identifier=cleanText(req.body.identifier,200);
  const o=db.prepare('SELECT * FROM orders WHERE order_id=?').get(orderId);
  if(!o) return null;
  if(safeEqual(normalizePhone(o.phone),normalizePhone(identifier)) || safeEqual(normalizeEmail(o.email),normalizeEmail(identifier))) return o;
  return null;
}
app.post('/api/download', trackLimiter, (req,res)=>{
  const o=findVerifiedOrder(req);
  if(!o || !o.completed_path) return res.status(404).send('File not available.');
  const file=path.join(COMPLETED,o.completed_path);
  if(!fs.existsSync(file)) return res.status(404).send('File not available.');
  res.download(file,o.completed_original_name || 'completed-work');
});

app.post('/api/admin/login', rateLimit({windowMs:15*60*1000,limit:10}), (req,res)=>{
  const username=cleanText(req.body.username,100);
  const password=String(req.body.password||'');
  const expectedUser=process.env.ADMIN_USERNAME||'admin';
  const expectedPass=process.env.ADMIN_PASSWORD||'';
  if(!expectedPass || !safeEqual(username,expectedUser) || !safeEqual(password,expectedPass)) return res.status(401).json({error:'Invalid admin credentials.'});
  const sid=crypto.randomBytes(32).toString('hex');
  adminSessions.set(sid,{created:Date.now()});
  res.setHeader('Set-Cookie',`wapole_admin=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`);
  res.json({ok:true});
});
app.post('/api/admin/logout',requireAdmin,(req,res)=>{
  adminSessions.delete(req.cookies.wapole_admin);
  res.setHeader('Set-Cookie','wapole_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ok:true});
});
app.get('/api/admin/me',requireAdmin,(_,res)=>res.json({ok:true}));
app.get('/api/admin/orders',requireAdmin,(_,res)=>{
  const rows=db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json({orders:rows.map(orderPublic)});
});
app.get('/api/admin/order/:id',requireAdmin,(req,res)=>{
  const o=db.prepare('SELECT * FROM orders WHERE order_id=?').get(req.params.id.toUpperCase());
  if(!o) return res.status(404).json({error:'Order not found.'});
  res.json({order:orderPublic(o), internal:{transactionRef:o.transaction_ref,paymentName:o.payment_name,audioOriginalName:o.audio_original_name,audioPath:o.audio_path}});
});
const completedStorage=multer.diskStorage({
  destination: (_,__,cb)=>cb(null,COMPLETED),
  filename: (_,file,cb)=>cb(null,crypto.randomBytes(16).toString('hex')+path.extname(file.originalname).toLowerCase())
});
const completedUpload=multer({storage:completedStorage,limits:{fileSize:100*1024*1024}});
app.post('/api/admin/order/:id',requireAdmin,completedUpload.single('completed'),(req,res)=>{
  const id=req.params.id.toUpperCase();
  const status=cleanText(req.body.status,30);
  if(!['Pending','In Progress','Completed'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  const o=db.prepare('SELECT * FROM orders WHERE order_id=?').get(id);
  if(!o) return res.status(404).json({error:'Order not found.'});
  const now=new Date().toISOString();
  let completedPath=o.completed_path, completedName=o.completed_original_name;
  if(req.file){ 
    if(o.completed_path) try{fs.unlinkSync(path.join(COMPLETED,o.completed_path))}catch{}
    completedPath=path.basename(req.file.path); completedName=req.file.originalname;
  }
  if(status==='Completed' && !completedPath) return res.status(400).json({error:'Upload the completed file before marking the order Completed.'});
  db.prepare('UPDATE orders SET status=?,completed_path=?,completed_original_name=?,updated_at=? WHERE order_id=?').run(status,completedPath,completedName,now,id);
  res.json({ok:true});
});
app.get('/api/admin/audio/:id',requireAdmin,(req,res)=>{
  const o=db.prepare('SELECT * FROM orders WHERE order_id=?').get(req.params.id.toUpperCase());
  if(!o || !o.audio_path) return res.status(404).send('File not found.');
  const file=path.join(UPLOADS,o.audio_path);
  if(!fs.existsSync(file)) return res.status(404).send('File not found.');
  res.download(file,o.audio_original_name||'audio');
});

app.get('/admin',(_,res)=>res.sendFile(path.join(publicDir,'admin.html')));
app.get(/.*/,(req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'Not found'});
  res.sendFile(path.join(publicDir,'index.html'));
});

app.listen(PORT,()=>console.log(`Wapole Studios running on http://localhost:${PORT}`));
