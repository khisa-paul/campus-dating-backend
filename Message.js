const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: String,       // username or phone
  receiver: String,     // username or phone
  text: String,
  isGroup: Boolean,
  senderAvatar: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
