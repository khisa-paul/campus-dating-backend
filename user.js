// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  phone: { type: String, unique: true, sparse: true }, // +2547...
  username: { type: String, unique: true, sparse: true },
  password: { type: String },
  avatar: { type: String, default: '' },
  privacy: { type: String, default: 'everyone' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
