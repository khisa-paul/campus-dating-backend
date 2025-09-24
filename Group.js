const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
  name: String,
  members: [String], // array of username/phone
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Group', GroupSchema);
