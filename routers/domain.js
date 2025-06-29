const express = require("express");
const router = express.Router();
const fs = require("fs").promises;
const path = require("path");
const util = require("util");
const { exec } = require("child_process");
const execAsync = util.promisify(exec);
require("dotenv").config();
const mongoose = require('mongoose')
const User = require('../models/user'); // Import the model
// Helper: Generate NGINX config
async function generateNginxConfig(user, httpPort) {
  let config = "";

  for (const { domain, sslEnabled } of user.domains) {

    // Always create HTTP redirect to HTTPS
    config += `
server {
    listen 80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://${domain}$request_uri;
    }
}
`;

    if (sslEnabled) {
      config += `
server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/${domain}/chain.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_session_cache shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://localhost:${httpPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
}
`;
    } else {
      // For non-SSL domains, just serve static site
      config += `
server {
    listen 80;
    server_name ${domain};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
}
`;
    }
  }

  return config;
}


// SSL Certificate Generator
async function generateSSLCertificate(domain) {
  const email = process.env.CERTBOT_EMAIL || "admin@example.com";

  try {
    await execAsync("sudo nginx -t");
    const command = `sudo certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --email ${email} --no-eff-email`;
    const { stdout } = await execAsync(command);
    console.log(`✅ SSL certificate generated for ${domain}`);
    console.log("Certbot output:", stdout);
    return true;
  } catch (error) {
    console.error(`❌ SSL generation failed for ${domain}:`, error.stderr || error.message);
    return false;
  }
}

router.post("/api/ssl/:domain", async (req, res) => {
  try {
    const { httpPort } = req.body;
    const domain = decodeURIComponent(req.params.domain);
    const userId = req.session.userId;


    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.domains.some(d => d.domain === domain)) {
      return res.status(400).json({ error: "SSL already enabled or domain exists" });
    }

    const sslGenerated = await generateSSLCertificate(domain);
    if (!sslGenerated) {
      return res.status(500).json({ error: "SSL generation failed" });
    }

    user.domains.push({ domain, sslEnabled: true });
    await user.save();

    const config = await generateNginxConfig(user,httpPort);
    const configPath = `/etc/nginx/sites-available/${userId}`;

    await fs.writeFile(configPath, config);
    await execAsync(`sudo ln -sf ${configPath} /etc/nginx/sites-enabled/${userId}`);
    await execAsync("sudo nginx -t && sudo systemctl reload nginx");

    res.json({ success: true });
  } catch (error) {
    console.error("SSL generation error:", error);
    res.status(500).json({ error: "SSL generation failed" });
  }
});

const requireAuth = (req, res, next) => {
  if (req.session?.userId) return next();
  res.status(401).json({ error: "Unauthorized" });
};

router.get("/api/my-domains", requireAuth, async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne(
      { _id: new mongoose.Types.ObjectId(req.session.userId) },
      { projection: { domains: 1 } }
    );

    res.json({ success: true, domains: user?.domains || [] });
  } catch (error) {
    console.error("Error fetching domains:", error);
    res.status(500).json({ success: false, error: "Failed to load domains" });
  }
});

module.exports = router;
