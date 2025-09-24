require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;

// ===== CORS =====
app.use(cors({
  origin: process.env.FRONTEND_URL,  // ✅ your frontend (GitHub Pages or localhost)
  credentials: true,
}));

// ===== Middleware =====
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===== MongoDB =====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => {
  console.error("❌ MongoDB connection error:", err.message);
  process.exit(1);
});

// ===== Multer (file uploads) =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ===== Models =====
const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true }, // ✅ phone number login
  username: { type: String }, // optional display name
  password: String,
  avatar: String,
  privacy: { type: String, default: "everyone" }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  sender: String,      // phone number of sender
  receiver: String,    // phone number of receiver
  text: String,
  isGroup: Boolean,
  senderAvatar: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const groupSchema = new mongoose.Schema({
  name: String,
  members: [String],   // store phone numbers
});
const Group = mongoose.model('Group', groupSchema);

// ===== JWT Middleware =====
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.phone; // ✅ phone instead of username
    next();
  } catch (e) { res.status(401).json({ error: "Invalid token" }); }
}

// ===== Auth Routes =====
app.post('/auth/register', upload.single('avatar'), async (req, res) => {
  try {
    const { phone, countryCode, password, username } = req.body;
    if (!phone || !countryCode || !password) return res.status(400).json({ error: "Missing fields" });

    const fullPhone = countryCode + phone; // ✅ e.g. +254712345678
    const hashed = await bcrypt.hash(password, 10);
    const avatarPath = req.file ? '/uploads/' + req.file.filename : null;

    const user = new User({ phone: fullPhone, username, password: hashed, avatar: avatarPath });
    await user.save();

    res.status(201).json({ message: "Registered successfully", phone: fullPhone });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ phone }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, phone, username: user.username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Contacts =====
app.get('/api/contacts/:phone', authMiddleware, async (req, res) => {
  const users = await User.find({ phone: { $ne: req.params.phone } });
  res.json(users);
});

// ===== Messages =====
app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const msg = req.body;
    const sender = await User.findOne({ phone: msg.sender });
    if (sender) msg.senderAvatar = sender.avatar;

    const newMsg = new Message(msg);
    await newMsg.save();

    res.json(newMsg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/message/:id/:phone', authMiddleware, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.sender !== req.params.phone) return res.status(403).json({ error: "Forbidden" });

    await msg.deleteOne();
    res.json({ message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Groups =====
app.post('/api/groups/create', authMiddleware, async (req, res) => {
  const { name, members } = req.body;
  const group = new Group({ name, members });
  await group.save();
  res.json({ message: "Group created" });
});

app.get('/api/groups/:phone', authMiddleware, async (req, res) => {
  const groups = await Group.find({ members: req.params.phone });
  res.json(groups);
});

// ===== Start Server =====
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
