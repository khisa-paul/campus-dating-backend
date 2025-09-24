// server.js (CommonJS)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim();

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// CORS setup: allow common dev origins + FRONTEND_URL
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://khisa-paul.github.io',
  'https://khisa-paul.github.io/campus-dating',
];
if (FRONTEND_URL) {
  // allow FRONTEND_URL too if provided
  allowedOrigins.push(FRONTEND_URL);
}

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (curl, mobile)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===== Multer for uploads =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g,'')),
});
const upload = multer({ storage });

// ===== Mongoose models =====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(()=> console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('MongoDB error', err); process.exit(1); });

const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  username: String,
  password: String,
  avatar: String,
  privacy: { type: String, default: 'everyone' },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  isGroup: Boolean,
  fileUrl: String,
  senderAvatar: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const statusSchema = new mongoose.Schema({
  user: String,
  text: String,
  fileUrl: String,
  createdAt: { type: Date, default: Date.now }
});
const Status = mongoose.model('Status', statusSchema);

const groupSchema = new mongoose.Schema({
  name: String,
  members: [String],
  createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', groupSchema);

// ===== JWT middleware =====
function authMiddleware(req, res, next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.split(' ')[1];
  if(!token) return res.status(401).json({ error:'Unauthorized' });
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload.phone;
    next();
  }catch(e){
    return res.status(401).json({ error:'Invalid token' });
  }
}

// ===== Auth routes =====
app.post('/auth/register', upload.single('avatar'), async (req, res) => {
  try{
    const { phone, password, username } = req.body;
    if(!phone || !password) return res.status(400).json({ error:'phone and password required' });
    const exists = await User.findOne({ phone });
    if(exists) return res.status(400).json({ error:'Phone already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const avatar = req.file ? '/uploads/' + req.file.filename : null;
    const user = new User({ phone, password: hashed, username: username || '', avatar });
    await user.save();
    return res.json({ message:'Registered', phone:user.phone, username:user.username, avatar:user.avatar });
  }catch(e){ console.error(e); return res.status(500).json({ error:'Register error' }); }
});

app.post('/auth/login', async (req, res) => {
  try{
    const { phone, password } = req.body;
    if(!phone || !password) return res.status(400).json({ error:'phone & password required' });
    const user = await User.findOne({ phone });
    if(!user) return res.status(401).json({ error:'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.status(401).json({ error:'Invalid credentials' });
    const token = jwt.sign({ phone: user.phone }, process.env.JWT_SECRET, { expiresIn:'7d' });
    return res.json({ token, phone:user.phone, username:user.username, avatar:user.avatar });
  }catch(e){ console.error(e); return res.status(500).json({ error:'Login error' }); }
});

// ===== Contacts sync endpoint =====
app.post('/api/contacts/sync', authMiddleware, async (req, res) => {
  try{
    const { contacts } = req.body; // expected array of phone strings
    if(!Array.isArray(contacts)) return res.status(400).json({ error:'contacts array required' });
    const registered = await User.find({ phone: { $in: contacts } }, 'phone username avatar');
    return res.json({ registered });
  }catch(e){ console.error(e); return res.status(500).json({ error:'Sync failed' }); }
});

// ===== Messages endpoints =====
// get conversation between user and other
app.get('/api/messages/:user/:other', authMiddleware, async (req, res) => {
  try{
    const user = req.params.user;
    const other = req.params.other;
    const messages = await Message.find({
      $or: [
        { sender: user, receiver: other },
        { sender: other, receiver: user }
      ]
    }).sort({ createdAt: 1 });
    res.json(messages);
  }catch(e){ console.error(e); res.status(500).json({ error:'Failed to load messages' }); }
});

// send message (also emits via socket)
app.post('/api/messages', authMiddleware, upload.single('file'), async (req, res) => {
  try{
    const { sender, receiver, text, isGroup } = req.body;
    const fileUrl = req.file ? '/uploads/' + req.file.filename : null;
    const senderUser = await User.findOne({ phone: sender });
    const senderAvatar = senderUser ? senderUser.avatar : null;
    const msg = new Message({ sender, receiver, text, isGroup: isGroup==='true' || isGroup===true, fileUrl, senderAvatar });
    await msg.save();
    // emit with socket.io to receiver room (or to group members)
    if(io){
      if(msg.isGroup){
        // send to group members
        const g = await Group.findById(receiver);
        if(g && g.members && g.members.length){
          g.members.forEach(m => io.to(m).emit('message', msg));
        }
      } else {
        io.to(receiver).emit('message', msg);
      }
      // also emit to sender for confirmation
      io.to(sender).emit('message', msg);
    }
    res.json(msg);
  }catch(e){ console.error(e); res.status(500).json({ error:'Send failed' }); }
});

// delete message
app.delete('/api/message/:id/:phone', authMiddleware, async (req, res) => {
  try{
    const id = req.params.id;
    const phone = req.params.phone;
    const msg = await Message.findById(id);
    if(!msg) return res.status(404).json({ error:'Not found' });
    if(msg.sender !== phone) return res.status(403).json({ error:'Forbidden' });
    await msg.deleteOne();
    // notify via socket
    if(io) io.to(msg.receiver).emit('message-deleted', { id });
    return res.json({ message:'Deleted' });
  }catch(e){ console.error(e); res.status(500).json({ error:'Delete failed' }); }
});

// ===== Status endpoints =====
app.post('/status', authMiddleware, upload.single('file'), async (req, res) => {
  try{
    const text = req.body.text || '';
    const fileUrl = req.file ? '/uploads/' + req.file.filename : null;
    const st = new Status({ user: req.user, text, fileUrl });
    await st.save();
    return res.json(st);
  }catch(e){ console.error(e); res.status(500).json({ error:'Status failed' }); }
});

app.get('/status/feed', authMiddleware, async (req, res) => {
  try{
    const feed = await Status.find().sort({ createdAt: -1 }).limit(50);
    return res.json(feed);
  }catch(e){ console.error(e); res.status(500).json({ error:'Feed failed' }); }
});

// ===== Groups =====
app.post('/api/groups/create', authMiddleware, async (req, res) => {
  try{
    const { name, members } = req.body; // members array of phone numbers
    const group = new Group({ name, members });
    await group.save();
    return res.json({ message:'Group created', id: group._id });
  }catch(e){ console.error(e); res.status(500).json({ error:'Group failed' }); }
});

app.get('/api/groups/:phone', authMiddleware, async (req, res) => {
  try{
    const phone = req.params.phone;
    const groups = await Group.find({ members: phone });
    return res.json(groups);
  }catch(e){ console.error(e); res.status(500).json({ error:'Groups failed' }); }
});

// ===== Profile update =====
app.put('/user/:phone/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
  try{
    const phone = req.params.phone;
    const updates = {};
    if(req.body.username) updates.username = req.body.username;
    if(req.body.password) updates.password = await bcrypt.hash(req.body.password, 10);
    if(req.file) updates.avatar = '/uploads/' + req.file.filename;
    await User.updateOne({ phone }, { $set: updates });
    return res.json({ message:'Updated' });
  }catch(e){ console.error(e); res.status(500).json({ error:'Update failed' }); }
});

// ===== simple ping =====
app.get('/ping', (req, res) => res.json({ message:'ok' }));

/* ===========================
   Socket.IO setup
   =========================== */
const io = new Server(server, {
  cors: {
    origin: function(origin, callback){
      if(!origin) return callback(null, true);
      if(allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }
});

io.use(async (socket, next) => {
  // token in socket.auth.token
  try{
    const token = socket.handshake.auth?.token;
    if(!token) return next(new Error('Auth error'));
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.phone = payload.phone;
    // join room named by phone so we can emit to that user
    socket.join(socket.phone);
    return next();
  }catch(e){ return next(new Error('Auth error')); }
});

io.on('connection', socket => {
  console.log('socket connected', socket.phone);
  socket.on('disconnect', ()=> console.log('socket disconnect', socket.phone));
  // optional: allow socket to send message event directly (but REST path saves too)
  socket.on('send-message', async (data) => {
    // data: { sender, receiver, text, isGroup }
    const { sender, receiver, text, isGroup } = data;
    const msg = new Message({ sender, receiver, text, isGroup: !!isGroup });
    await msg.save();
    if(isGroup){
      const g = await Group.findById(receiver);
      if(g && g.members) g.members.forEach(m => io.to(m).emit('message', msg));
    } else {
      io.to(receiver).emit('message', msg);
    }
    io.to(sender).emit('message', msg);
  });
});

/* ===========================
   Start server
   =========================== */
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
