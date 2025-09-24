const mongoose = require('mongoose');

const StatusSchema = new mongoose.Schema({
  user: String,        // username or phone
  text: String,
  fileUrl: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Status', StatusSchema);
