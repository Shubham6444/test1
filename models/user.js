// models/User.js
const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
  domain: { type: String, required: true },
  sslEnabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  domains:  { type: [domainSchema], default: [] },
  createdAt:{ type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
