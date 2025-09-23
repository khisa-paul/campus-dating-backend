const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// Multer config for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// === Schemas ===
const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  avatar: String,
  privacy: { type: String, default: "everyone" }
});
const User = mongoose.model("User", UserSchema);

const MessageSchema = new mongoose.Schema({
  sender: String,
  receiver: String, // username or groupId
  text: String,
  senderAvatar: String,
  isGroup: Boolean,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model("Message", MessageSchema);

const GroupSchema = new mongoose.Schema({
  name: String,
  members: [String] // array of usernames
});
const Group = mongoose.model("Group", GroupSchema);

const StatusSchema = new mongoose.Schema({
  user: String,
  file: String,
  createdAt: { type: Date, default: Date.now }
});
const Status = mongoose.model("Status", StatusSchema);

// === Auth ===
app.post("/auth/register", upload.single('avatar'), async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const avatar = req.file ? `/uploads/${req.file.filename}` : null;
  const user = new User({ username, password: hashed, avatar });
  await user.save();
  res.json({ msg: "Registered" });
});

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if(!user) return res.status(400).json({ msg:"User not found" });
  const match = await bcrypt.compare(password, user.password);
  if(!match) return res.status(400).json({ msg:"Wrong password" });
  const token = jwt.sign({ username }, process.env.JWT_SECRET || "secret");
  res.json({ token, username, avatar: user.avatar });
});

// === Messages ===
app.post("/api/messages", async (req, res) => {
  const { sender, receiver, text, isGroup } = req.body;
  const senderData = await User.findOne({ username: sender });
  const msg = new Message({ sender, receiver, text, senderAvatar: senderData.avatar, isGroup });
  await msg.save();
  res.json(msg);
});

app.delete("/api/message/:id/:user", async (req, res) => {
  await Message.findByIdAndDelete(req.params.id);
  res.json({ msg:"Deleted" });
});

// === Status ===
app.post("/status", upload.single('file'), async (req,res) => {
  const { user } = req.body;
  if(!req.file) return res.status(400).json({ msg:"No file uploaded" });
  const status = new Status({ user, file: `/uploads/${req.file.filename}` });
  await status.save();
  res.json({ msg:"Status uploaded" });
});

app.get("/status/feed", async (req,res) => {
  const statuses = await Status.find().sort({ createdAt: -1 });
  res.json(statuses);
});

// === Groups ===
app.post("/api/groups/create", async (req,res) => {
  const { name, members } = req.body;
  const group = new Group({ name, members });
  await group.save();
  res.json({ msg:"Group created", group });
});

app.get("/api/groups/:user", async (req,res) => {
  const groups = await Group.find({ members: req.params.user });
  res.json(groups);
});

// === Contacts ===
app.get("/api/contacts/:user", async (req,res) => {
  const users = await User.find({}, "username avatar");
  res.json(users.filter(u=>u.username !== req.params.user));
});

// === Profile update ===
app.put("/user/:user/profile", upload.single('avatar'), async (req,res) => {
  const { username, password, privacy } = req.body;
  const update = {};
  if(username) update.username=username;
  if(password) update.password=await bcrypt.hash(password,10);
  if(privacy) update.privacy=privacy;
  if(req.file) update.avatar=`/uploads/${req.file.filename}`;
  await User.findOneAndUpdate({ username:req.params.user }, update);
  res.json({ msg:"Profile updated" });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
