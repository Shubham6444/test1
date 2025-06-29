const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { CONFIG } = require("../config/db");
const fs = require("fs-extra");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const Docker = require("dockerode");
const docker = new Docker();

const isPortFree = async (port) => {
  try {
    await execAsync(`lsof -i:${port}`);
    return false;
  } catch {
    return true;
  }
};

class VMManager {
  static async getNextAvailablePorts() {
    let sshPort = CONFIG.SSH_PORT_START;
    let httpPort = CONFIG.HTTP_PORT_START;
    let rdpPort = CONFIG.RDP_PORT_START;

    while (!(await isPortFree(sshPort))) sshPort++;
    while (!(await isPortFree(httpPort))) httpPort++;
    while (!(await isPortFree(rdpPort))) rdpPort++;

    return { sshPort, httpPort, rdpPort };
  }

  static async loadVMData() {
    try {
      await fs.ensureFile(CONFIG.DATA_FILE);
      const data = await fs.readJson(CONFIG.DATA_FILE);
      return data || {};
    } catch (error) {
      return {};
    }
  }

  static async saveVMData(data) {
    await fs.ensureDir(path.dirname(CONFIG.DATA_FILE));
    await fs.writeJson(CONFIG.DATA_FILE, data, { spaces: 2 });
  }

  static async createContainer(userId, password, sshPort, httpPort, rdpPort) {
    const containerName = `vm_${userId}`;
    const actualPassword = password?.trim() || "defaultpass123";

    console.log(`Creating container ${containerName} with SSH port ${sshPort}`);

    const userVolumePath = path.resolve("/users/public/users", userId);
    const userhostdata = path.resolve(__dirname, "..", "Hostedfiles", userId);

    await fs.ensureDir(`${userVolumePath}/etc/letsencrypt`);
    await fs.ensureDir(`${userVolumePath}/var/lib/letsencrypt`);
    await fs.ensureDir(`${userVolumePath}/var/www/html`);
    await execAsync(`chown -R root:root ${userVolumePath}`);
    await execAsync(`chmod -R 500 ${userVolumePath}`);

    try {
      const container = await docker.createContainer({
        Image: "ubuntu:22.04",
        name: containerName,
        Cmd: [
          "/bin/bash",
          "-c",
          `
            apt-get update && \
            DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server sudo nginx curl wget git vim nano htop systemd && \
            mkdir -p /var/run/sshd && \
            echo 'Port 22' > /etc/ssh/sshd_config && \
            echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && \
            echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config && \
            echo 'PubkeyAuthentication yes' >> /etc/ssh/sshd_config && \
            ssh-keygen -A && \
            echo 'root:${actualPassword}' | chpasswd && \
            echo 'root ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
            echo '<h1>Welcome to your VM!</h1><p>SSH Port: ${sshPort}</p>' > /var/www/html/index.html && \
            service ssh start && \
            service nginx start && \
            tail -f /dev/null
          `,
        ],
        ExposedPorts: {
          "22/tcp": {},
          "80/tcp": {},
          "3389/tcp": {},
        },
        HostConfig: {
          PortBindings: {
            "22/tcp": [{ HostPort: sshPort.toString() }],
            "80/tcp": [{ HostPort: httpPort.toString() }],
            "3389/tcp": [{ HostPort: rdpPort.toString() }],
          },
          Binds: [
            `${userVolumePath}/etc/letsencrypt:/etc/letsencrypt`,
            `${userVolumePath}/var/lib/letsencrypt:/var/lib/letsencrypt`,
            `${userVolumePath}/var/www/html:/var/www/html`,
            `${userhostdata}:/app`,
          ],
          Memory: 512 * 1024 * 1024,
          CpuShares: 512,
        },
        Tty: true,
        OpenStdin: true,
      });

      await container.start();

      const data = await this.loadVMData();
      data[userId] = { sshPort, httpPort, rdpPort, containerId: container.id };
      await this.saveVMData(data);

      return container;
    } catch (error) {
      console.error("Container creation error:", error);
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  static async generateNginxConfig(userId, httpPort, subdomain) {
    const configContent = `
server {
    listen 80;
    server_name ${subdomain}.${CONFIG.DOMAIN};

    location / {
        proxy_pass http://localhost:${httpPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`;

    const configPath = path.join(CONFIG.NGINX_CONFIG_PATH, `${subdomain}.${CONFIG.DOMAIN}`);
    const enabledPath = path.join(CONFIG.NGINX_ENABLED_PATH, `${subdomain}.${CONFIG.DOMAIN}`);

    try {
      await fs.writeFile(configPath, configContent);
      try {
        await fs.symlink(configPath, enabledPath);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }

      await execAsync("nginx -t");
      await execAsync("systemctl reload nginx");
    } catch (error) {
      console.error("Nginx config generation error:", error);
      throw new Error("Failed to generate Nginx configuration");
    }
  }

  static async removeNginxConfig(subdomain) {
    const configPath = path.join(CONFIG.NGINX_CONFIG_PATH, `${subdomain}.${CONFIG.DOMAIN}`);
    const enabledPath = path.join(CONFIG.NGINX_ENABLED_PATH, `${subdomain}.${CONFIG.DOMAIN}`);

    try {
      await fs.remove(enabledPath);
      await fs.remove(configPath);
      await execAsync("systemctl reload nginx");
    } catch (error) {
      console.error("Nginx config removal error:", error);
    }
  }

  static async fixContainerPassword(containerId, password) {
    try {
      const container = docker.getContainer(containerId);
      const actualPassword = password?.trim() || "defaultpass123";

      const commands = [
        `echo 'root:${actualPassword}' | chpasswd`,
        "usermod -aG sudo root",
        "grep -q 'root ALL=(ALL) NOPASSWD:ALL' /etc/sudoers || echo 'root ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers",
        "service ssh restart",
      ];

      for (const cmd of commands) {
        try {
          const exec = await container.exec({
            Cmd: ["/bin/bash", "-c", cmd],
            AttachStdout: true,
            AttachStderr: true,
          });
          await exec.start();
        } catch (error) {
          console.error(`Error executing: ${cmd}`, error);
        }
      }

      return true;
    } catch (error) {
      console.error("Password fix error:", error);
      return false;
    }
  }
}

module.exports = VMManager;
