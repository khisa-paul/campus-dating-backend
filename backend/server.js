// server.js
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
app.use('/uploads', express.static(path.join(__dirname,'uploads')));

const JWT_SECRET = "PAUL_SECRET_KEY"; // change to secure in production

// === MongoDB connection ===
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser:true, useUnifiedTopology:true })
.then(()=>console.log("MongoDB connected"))
.catch(err=>console.log(err));

// === Schemas ===
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  avatar: String,
  privacy: { type: String, default:"everyone" }
});

const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  text: String,
  isGroup: Boolean,
  createdAt: { type: Date, default: Date.now }
});

const statusSchema = new mongoose.Schema({
  user: String,
  text: String,
  fileUrl: String,
  createdAt: { type: Date, default: Date.now }
});

const groupSchema = new mongoose.Schema({
  name: String,
  members: [String]
});

const User = mongoose.model("User", userSchema);
const Message = mongoose.model("Message", messageSchema);
const Status = mongoose.model("Status", statusSchema);
const Group = mongoose.model("Group", groupSchema);

// === Multer for file upload ===
const storage = multer.diskStorage({
  destination: function(req,file,cb){ cb(null,'uploads/'); },
  filename: function(req,file,cb){ cb(null,Date.now()+'-'+file.originalname); }
});
const upload = multer({ storage });

// === Auth routes ===
app.post("/auth/register", upload.single('avatar'), async (req,res)=>{
  const { username,password } = req.body;
  const existing = await User.findOne({ username });
  if(existing) return res.status(400).json({ msg:"User exists" });
  const hashed = await bcrypt.hash(password,10);
  const user = new User({ username, password:hashed, avatar:req.file?req.file.path:null });
  await user.save();
  res.json({ msg:"Registered" });
});

app.post("/auth/login", async (req,res)=>{
  const { username,password } = req.body;
  const user = await User.findOne({ username });
  if(!user) return res.status(400).json({ msg:"User not found" });
  const valid = await bcrypt.compare(password,user.password);
  if(!valid) return res.status(400).json({ msg:"Invalid password" });
  const token = jwt.sign({ username }, JWT_SECRET);
  res.json({ token });
});

// === Middleware ===
const auth = (req,res,next)=>{
  const token = req.headers['authorization']?.split(' ')[1];
  if(!token) return res.status(401).json({ msg:"No token" });
  try{ const decoded = jwt.verify(token, JWT_SECRET); req.user = decoded.username; next(); } 
  catch(err){ res.status(401).json({ msg:"Invalid token" }); }
};

// === Messages routes ===
app.post("/api/messages", auth, async (req,res)=>{
  const msg = new Message({ ...req.body, sender:req.user });
  await msg.save();
  res.json(msg);
});

app.delete("/api/message/:id/:user", auth, async (req,res)=>{
  const msg = await Message.findById(req.params.id);
  if(!msg) return res.status(404).json({ msg:"Message not found" });
  if(msg.sender !== req.params.user && msg.receiver !== req.params.user)
    return res.status(403).json({ msg:"Not allowed" });
  await msg.remove();
  res.json({ msg:"Deleted" });
});

// === Status routes ===
app.post("/status", auth, upload.single('file'), async (req,res)=>{
  const status = new Status({ user:req.user, text:req.body.text, fileUrl:req.file?req.file.path:null });
  await status.save();
  res.json(status);
});

app.get("/status/feed", auth, async (req,res)=>{
  const feed = await Status.find().sort({ createdAt:-1 });
  res.json(feed);
});

// === Groups ===
app.post("/api/groups/create", auth, async (req,res)=>{
  const { name,members } = req.body;
  const group = new Group({ name, members:[...members,req.user] });
  await group.save();
  res.json(group);
});

app.get("/api/groups/:user", auth, async (req,res)=>{
  const groups = await Group.find({ members:req.params.user });
  res.json(groups);
});

// === Profile update ===
app.put("/user/:user/profile", auth, upload.single('avatar'), async (req,res)=>{
  const updates = {};
  if(req.body.username) updates.username=req.body.username;
  if(req.body.password) updates.password=await bcrypt.hash(req.body.password,10);
  if(req.body.privacy) updates.privacy=req.body.privacy;
  if(req.file) updates.avatar=req.file.path;
  await User.findOneAndUpdate({ username:req.params.user }, updates);
  res.json({ msg:"Profile updated" });
});

// === Start server ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
