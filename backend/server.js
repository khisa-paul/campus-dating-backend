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
  origin: process.env.FRONTEND_URL || "*",
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
.then(()=>console.log("✅ Connected to MongoDB"))
.catch(err=>{ console.error("❌ MongoDB connection error:", err); process.exit(1); });

// ===== Multer =====
const storage = multer.diskStorage({
  destination: (req, file, cb)=> cb(null, 'uploads/'),
  filename: (req, file, cb)=> cb(null, Date.now()+'-'+file.originalname)
});
const upload = multer({ storage });

// ===== Models =====
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  avatar: String,
  privacy: { type: String, default: "everyone" }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  isGroup: Boolean,
  senderAvatar: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const groupSchema = new mongoose.Schema({
  name: String,
  members: [String],
});
const Group = mongoose.model('Group', groupSchema);

// ===== JWT Middleware =====
function authMiddleware(req,res,next){
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({ error:"Unauthorized" });
  try{
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.username;
    next();
  } catch(e){ res.status(401).json({ error:"Invalid token" }); }
}

// ===== Auth Routes =====
app.post('/auth/register', upload.single('avatar'), async (req,res)=>{
  try{
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const avatarPath = req.file ? '/uploads/' + req.file.filename : null;
    const user = new User({ username, password: hashed, avatar: avatarPath });
    await user.save();
    res.status(201).json({ message:"Registered successfully" });
  } catch(e){ res.status(400).json({ error: e.message }); }
});

app.post('/auth/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if(!user) return res.status(401).json({ error:"Invalid credentials" });
    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.status(401).json({ error:"Invalid credentials" });
    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn:'7d' });
    res.json({ token, username });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ===== User Profile =====
app.put('/user/:username/profile', authMiddleware, upload.single('avatar'), async (req,res)=>{
  try{
    const { username, password, privacy } = req.body;
    const update = {};
    if(username) update.username = username;
    if(password) update.password = await bcrypt.hash(password,10);
    if(privacy) update.privacy = privacy;
    if(req.file) update.avatar = '/uploads/' + req.file.filename;
    await User.updateOne({ username: req.params.username }, update);
    res.json({ message:"Profile updated" });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ===== Contacts =====
app.get('/api/contacts/:username', authMiddleware, async (req,res)=>{
  const users = await User.find({ username: { $ne: req.params.username } });
  res.json(users);
});

// ===== Messages =====
app.post('/api/messages', authMiddleware, async (req,res)=>{
  try{
    const msg = req.body;
    const sender = await User.findOne({ username: msg.sender });
    if(sender) msg.senderAvatar = sender.avatar;
    const newMsg = new Message(msg);
    await newMsg.save();
    res.json(newMsg);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.delete('/api/message/:id/:username', authMiddleware, async (req,res)=>{
  try{
    const msg = await Message.findById(req.params.id);
    if(!msg) return res.status(404).json({ error:"Message not found" });
    if(msg.sender !== req.params.username) return res.status(403).json({ error:"Forbidden" });
    await msg.deleteOne();
    res.json({ message:"Deleted" });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ===== Status =====
app.post('/status', authMiddleware, upload.single('file'), async (req,res)=>{
  try{
    const { text } = req.body;
    const fileUrl = req.file ? '/uploads/' + req.file.filename : null;
    res.json({ text, fileUrl });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/status/feed', authMiddleware, async (req,res)=>{
  const users = await User.find({});
  res.json(users.map(u=>({ user: u.username, text:"", fileUrl: u.avatar })));
});

// ===== Groups =====
app.post('/api/groups/create', authMiddleware, async (req,res)=>{
  const { name, members } = req.body;
  const group = new Group({ name, members });
  await group.save();
  res.json({ message:"Group created" });
});

app.get('/api/groups/:username', authMiddleware, async (req,res)=>{
  const groups = await Group.find({ members: req.params.username });
  res.json(groups);
});

// ===== Start Server =====
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
