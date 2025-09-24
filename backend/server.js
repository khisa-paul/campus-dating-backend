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

const User = require('./models/User'); // model file (see below)

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');

const PORT = process.env.PORT || 10000;
const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim();

// ensure uploads folder exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- CORS ---
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://khisa-paul.github.io',
  'https://khisa-paul.github.io/campus-dating'
];
if (FRONTEND_URL) allowedOrigins.push(FRONTEND_URL);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow curl/postman/no-origin
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// --- MongoDB connection ---
if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI is not defined in env');
  process.exit(1);
}
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

// --- Multer ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g, ''))
});
const upload = multer({ storage });

// --- Other models defined inline: Message, Status, Group ---
const { Schema } = mongoose;

const messageSchema = new Schema({
  sender: String,
  receiver: String,
  text: String,
  isGroup: { type: Boolean, default: false },
  fileUrl: String,
  senderAvatar: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const statusSchema = new Schema({
  user: String,
  text: String,
  fileUrl: String,
  createdAt: { type: Date, default: Date.now }
});
const Status = mongoose.model('Status', statusSchema);

const groupSchema = new Schema({
  name: String,
  members: [String],
  createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', groupSchema);

// --- JWT auth middleware ---
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Unauthorized' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload.phone || payload.id || payload.username || null;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ------------------ ROUTES ------------------

// sanity check
app.get('/ping', (req, res) => res.json({ message: 'ok' }));

// ---------- Auth: register & login ----------
app.post('/auth/register', upload.single('avatar'), async (req, res) => {
  try {
    // support phone + countryCode or full phone
    // Accepts either: { phone } OR { countryCode, phone } OR { username, phone }
    const body = req.body || {};
    let { phone, countryCode, username, password } = body;

    if (countryCode && phone && !phone.startsWith('+')) phone = countryCode + phone;

    if (!phone || !password) return res.status(400).json({ error: 'phone and password required' });

    // check duplicates
    const existing = await User.findOne({ $or: [{ phone }, { username }] });
    if (existing) {
      // give helpful message whether phone or username exists
      if (existing.phone === phone) return res.status(400).json({ error: 'Phone already registered' });
      if (username && existing.username === username) return res.status(400).json({ error: 'Username already taken' });
      return res.status(400).json({ error: 'Already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const avatarPath = req.file ? '/uploads/' + path.basename(req.file.path) : null;

    const user = new User({ phone, username: username || '', password: hashed, avatar: avatarPath });
    await user.save();

    return res.status(201).json({ message: 'Registered', phone: user.phone, username: user.username, avatar: user.avatar });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === 11000) return res.status(400).json({ error: 'Duplicate key' });
    return res.status(500).json({ error: 'Register failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { phone, username, password } = req.body;
    if ((!phone && !username) || !password) return res.status(400).json({ error: 'Missing fields' });

    const user = await User.findOne(phone ? { phone } : { username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // token payload contains phone and id
    const token = jwt.sign({ phone: user.phone, id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, phone: user.phone, username: user.username, avatar: user.avatar });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ---------- Contacts sync ----------
app.post('/api/contacts/sync', authMiddleware, async (req, res) => {
  try {
    const { contacts } = req.body; // expect array of phone strings
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'contacts must be array' });
    const registered = await User.find({ phone: { $in: contacts } }, 'phone username avatar');
    return res.json({ registered }); // array of user docs
  } catch (err) {
    console.error('Sync error', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
});

// ---------- Messages ----------
app.get('/api/messages/:user/:other', authMiddleware, async (req, res) => {
  try {
    const user = req.params.user;
    const other = decodeURIComponent(req.params.other);
    const messages = await Message.find({
      $or: [
        { sender: user, receiver: other },
        { sender: other, receiver: user }
      ]
    }).sort({ createdAt: 1 }).limit(1000);
    return res.json(messages);
  } catch (err) {
    console.error('Get messages error', err);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
});

// send message endpoint (supports optional file)
app.post('/api/messages', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { sender, receiver, text, isGroup } = req.body;
    if (!sender || !receiver) return res.status(400).json({ error: 'sender and receiver required' });

    const fileUrl = req.file ? '/uploads/' + path.basename(req.file.path) : null;
    const senderUser = await User.findOne({ phone: sender });
    const senderAvatar = senderUser ? senderUser.avatar : null;

    const msg = new Message({
      sender, receiver, text, isGroup: isGroup === 'true' || isGroup === true, fileUrl, senderAvatar
    });
    await msg.save();

    // emit via socket.io
    if (io) {
      if (msg.isGroup) {
        const g = await Group.findById(receiver);
        if (g && g.members && g.members.length) {
          g.members.forEach(m => io.to(m).emit('message', msg));
        }
      } else {
        io.to(receiver).emit('message', msg);
      }
      io.to(sender).emit('message', msg);
    }

    return res.json(msg);
  } catch (err) {
    console.error('Send message error', err);
    return res.status(500).json({ error: 'Send failed' });
  }
});

app.delete('/api/message/:id/:phone', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const phone = req.params.phone;
    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== phone) return res.status(403).json({ error: 'Forbidden' });
    await msg.deleteOne();
    if (io) io.to(msg.receiver).emit('message-deleted', { id });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete message error', err);
    return res.status(500).json({ error: 'Delete failed' });
  }
});

// ---------- Status ----------
app.post('/status', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const text = req.body.text || '';
    const fileUrl = req.file ? '/uploads/' + path.basename(req.file.path) : null;
    const st = new Status({ user: req.user, text, fileUrl });
    await st.save();
    return res.json(st);
  } catch (err) {
    console.error('Status error', err);
    return res.status(500).json({ error: 'Status failed' });
  }
});

app.get('/status/feed', authMiddleware, async (req, res) => {
  try {
    const feed = await Status.find().sort({ createdAt: -1 }).limit(50);
    return res.json(feed);
  } catch (err) {
    console.error('Status feed error', err);
    return res.status(500).json({ error: 'Feed failed' });
  }
});

// ---------- Groups ----------
app.post('/api/groups/create', authMiddleware, async (req, res) => {
  try {
    const { name, members } = req.body;
    const group = new Group({ name, members });
    await group.save();
    return res.json({ message: 'Group created', id: group._id });
  } catch (err) {
    console.error('Create group error', err);
    return res.status(500).json({ error: 'Group failed' });
  }
});

app.get('/api/groups/:phone', authMiddleware, async (req, res) => {
  try {
    const phone = req.params.phone;
    const groups = await Group.find({ members: phone });
    return res.json(groups);
  } catch (err) {
    console.error('Get groups error', err);
    return res.status(500).json({ error: 'Groups failed' });
  }
});

// ---------- Profile update ----------
app.put('/user/:phone/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    const phone = req.params.phone;
    const updates = {};
    if (req.body.username) updates.username = req.body.username;
    if (req.body.password) updates.password = await bcrypt.hash(req.body.password, 10);
    if (req.file) updates.avatar = '/uploads/' + path.basename(req.file.path);
    await User.updateOne({ phone }, { $set: updates });
    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update profile error', err);
    return res.status(500).json({ error: 'Update failed' });
  }
});

// -------------------- Socket.IO --------------------
const io = new Server(server, {
  cors: {
    origin: function(origin, callback){
      if(!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth error'));
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.phone = payload.phone;
    socket.join(socket.phone);
    next();
  } catch (err) {
    next(new Error('Auth error'));
  }
});

io.on('connection', socket => {
  console.log('socket connected', socket.phone);
  socket.on('disconnect', () => console.log('socket disconnected', socket.phone));
  // optional send via socket
  socket.on('send-message', async (data) => {
    try {
      const { sender, receiver, text, isGroup } = data;
      const msg = new Message({ sender, receiver, text, isGroup: !!isGroup });
      await msg.save();
      if (msg.isGroup) {
        const g = await Group.findById(receiver);
        if (g && g.members) g.members.forEach(m => io.to(m).emit('message', msg));
      } else {
        io.to(receiver).emit('message', msg);
      }
      io.to(sender).emit('message', msg);
    } catch (e) { console.error('socket send error', e); }
  });
});

// -------------------- Start --------------------
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
