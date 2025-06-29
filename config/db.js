const mongoose = require('mongoose');

// Configuration
require("dotenv").config();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI,
  SSH_PORT_START: parseInt(process.env.SSH_PORT_START || "2201"),
  HTTP_PORT_START: parseInt(process.env.HTTP_PORT_START || "8001"),
  RDP_PORT_START: parseInt(process.env.RDP_PORT_START || "3390"),
  DOMAIN: process.env.DOMAIN || "localhost",
  NGINX_CONFIG_PATH: process.env.NGINX_CONFIG_PATH || "/etc/nginx/sites-available",
  NGINX_ENABLED_PATH: process.env.NGINX_ENABLED_PATH || "/etc/nginx/sites-enabled",
  DATA_FILE: process.env.DATA_FILE || "./data/vm_mappings.json",
};

module.exports = CONFIG;

// Connect to MongoDB
mongoose.connect(CONFIG.MONGO_URI, {
  dbName: CONFIG.DB_NAME,
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB via Mongoose"))
  .catch((err) => console.error("❌ Mongoose connection error:", err));

// Export both mongoose and config
module.exports = {
  mongoose,
  CONFIG,
};
