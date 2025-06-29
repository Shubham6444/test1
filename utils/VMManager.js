
const express = require("express");
const router = express.Router();
// const VMManager = require("../utils/VMManager"); // Adjust path to your class file
const { v4: uuidv4 } = require("uuid");
const { CONFIG } = require("../config/db")
const fs = require("fs-extra")
const path = require("path")
const { exec } = require("child_process")
const util = require("util")
const execAsync = util.promisify(exec)
const Docker = require("dockerode")
const docker = new Docker()

class VMManager {
  static async getNextAvailablePorts() {
    const data = await this.loadVMData()
    const usedSSHPorts = Object.values(data).map((vm) => vm.sshPort)
    const usedHTTPPorts = Object.values(data).map((vm) => vm.httpPort)
    const usedRDPPorts = Object.values(data).map((vm) => vm.rdpPort)

    let sshPort = CONFIG.SSH_PORT_START
    let httpPort = CONFIG.HTTP_PORT_START
    let rdpPort = CONFIG.RDP_PORT_START  // start from 3389 or higher

    while (usedSSHPorts.includes(sshPort)) sshPort++
    while (usedHTTPPorts.includes(httpPort)) httpPort++
    while (usedRDPPorts.includes(rdpPort)) rdpPort++

    return { sshPort, httpPort, rdpPort }
  }


  static async loadVMData() {
    try {
      await fs.ensureFile(CONFIG.DATA_FILE)
      const data = await fs.readJson(CONFIG.DATA_FILE)
      return data || {}
    } catch (error) {
      return {}
    }
  }

  static async saveVMData(data) {
    await fs.ensureDir(path.dirname(CONFIG.DATA_FILE))
    await fs.writeJson(CONFIG.DATA_FILE, data, { spaces: 2 })
  }

  static async createContainer(userId, password, sshPort, httpPort, rdpPort) {
    const containerName = `vm_${userId}`
    const actualPassword = password?.trim() || "defaultpass123"

    console.log(`Creating container ${containerName} with SSH port ${sshPort}`)
    const userVolumePath = `/users/public/users/${userId}`
    // updated 28/06/25

const userhostdata = path.resolve(__dirname, '..', 'Hostedfiles', userId); // ✅ absolute path

    await fs.ensureDir(`${userVolumePath}/etc/letsencrypt`)
    await fs.ensureDir(`${userVolumePath}/var/lib/letsencrypt`)
    await fs.ensureDir(`${userVolumePath}/var/www/html`)
    await execAsync(`chown -R root:root ${userVolumePath}`)
    await execAsync(`chmod -R 500 ${userVolumePath}`)


    try {
      // Create container with proper setup
      const container = await docker.createContainer({
        Image: "ubuntu:22.04",
        name: containerName,
        Cmd: [
          "/bin/bash",
          "-c",
          `
                    # Update system
                    apt-get update && 
                    
                    # Install required packages
                    DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server sudo nginx curl wget git vim nano htop systemd &&
                    
                    # Setup SSH
                    mkdir -p /var/run/sshd &&
                    
                    # Create SSH config
                    echo 'Port 22' > /etc/ssh/sshd_config &&
                    echo 'PermitRootLogin no' >> /etc/ssh/sshd_config &&
                    echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config &&
                    echo 'PubkeyAuthentication yes' >> /etc/ssh/sshd_config &&
                    echo 'ChallengeResponseAuthentication no' >> /etc/ssh/sshd_config &&
                    echo 'UsePAM no' >> /etc/ssh/sshd_config &&
                    echo 'X11Forwarding yes' >> /etc/ssh/sshd_config &&
                    echo 'PrintMotd no' >> /etc/ssh/sshd_config &&
                    echo 'AcceptEnv LANG LC_*' >> /etc/ssh/sshd_config &&
                    echo 'Subsystem sftp /usr/lib/openssh/sftp-server' >> /etc/ssh/sshd_config &&
                    
                    # Generate SSH host keys
                    ssh-keygen -A &&
                    
                    # Create user
                    useradd -m -s /bin/bash root &&
                    echo 'root:${actualPassword}' | chpasswd &&
                    usermod -aG sudo root &&
                    echo 'root ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers &&
                    
                    // useradd -m -s /bin/bash root && \
                    // echo "root:${actualPassword}" | chpasswd && \
                    // usermod -aG sudo root && \
                    // echo 'root ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

                    # Setup user home
                    mkdir -p /home/root/.ssh &&
                    chown -R root:root /home/root &&
                    chmod 700 /home/root/.ssh &&
                    
                    # Create welcome page
                    echo '<h1>Welcome to your VM!</h1><p>Container: ${containerName}</p><p>SSH Port: ${sshPort}</p><p>User: root</p><p>Status: Ready!</p>' > /var/www/html/index.html &&
                    
                    # Start services
                    service ssh start &&
                    service nginx start &&
                    
                    # Keep container running
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
            // updated 28/06/25

            `${userhostdata}:/app`, // 👈 Mount /Hostedfiles/<userId> to /app

          ],

          Memory: 512 * 1024 * 1024, // 512MB
          CpuShares: 512,
        },
        Tty: true,
        OpenStdin: true,
      })

      console.log(`Starting container ${containerName}...`)
      await container.start()

      // Wait for container to initialize
      console.log("Waiting for container initialization...")
      await new Promise((resolve) => setTimeout(resolve, 15000))

      // Verify services are running
      try {
        const verifyExec = await container.exec({
          Cmd: ["/bin/bash", "-c", "ps aux | grep sshd && netstat -tlnp | grep :22 && service ssh status"],
          AttachStdout: true,
          AttachStderr: true,
        })
        await verifyExec.start()
        console.log(`Services verification completed for ${containerName}`)
      } catch (error) {
        console.error("Service verification failed:", error)
      }

      // Double-check password is set
      try {
        const passwordExec = await container.exec({
          Cmd: ["/bin/bash", "-c", `echo 'root:${actualPassword}' | chpasswd && echo "Password reset completed"`],
          AttachStdout: true,
          AttachStderr: true,
        })
        await passwordExec.start()
        console.log(`Password verification completed for ${containerName}`)
      } catch (error) {
        console.error("Password verification failed:", error)
      }

      console.log(`Container ${containerName} created successfully`)
      return container
    } catch (error) {
      console.error("Container creation error:", error)
      throw new Error(`Failed to create container: ${error.message}`)
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
}
`

    const configPath = path.join(CONFIG.NGINX_CONFIG_PATH, `${subdomain}.${CONFIG.DOMAIN}`)
    const enabledPath = path.join(CONFIG.NGINX_ENABLED_PATH, `${subdomain}.${CONFIG.DOMAIN}`)

    try {
      await fs.writeFile(configPath, configContent)
      console.log(`Nginx config written to ${configPath}`)

      // Create symlink to enabled sites
      try {
        await fs.symlink(configPath, enabledPath)
        console.log(`Nginx config enabled at ${enabledPath}`)
      } catch (error) {
        if (error.code !== "EEXIST") throw error
      }

      // Test and reload nginx
      try {
        await execAsync("nginx -t")
        await execAsync("systemctl reload nginx")
        console.log("Nginx reloaded successfully")
      } catch (error) {
        console.error("Nginx reload error:", error)
        // Don't throw error here, just log it
      }
    } catch (error) {
      console.error("Nginx config generation error:", error)
      throw new Error("Failed to generate Nginx configuration")
    }
  }

  static async removeNginxConfig(subdomain) {
    const configPath = path.join(CONFIG.NGINX_CONFIG_PATH, `${subdomain}.${CONFIG.DOMAIN}`)
    const enabledPath = path.join(CONFIG.NGINX_ENABLED_PATH, `${subdomain}.${CONFIG.DOMAIN}`)

    try {
      await fs.remove(enabledPath)
      await fs.remove(configPath)
      await execAsync("systemctl reload nginx")
      console.log(`Nginx config removed for ${subdomain}`)
    } catch (error) {
      console.error("Nginx config removal error:", error)
    }
  }

  static async fixContainerPassword(containerId, password) {
    try {
      const container = docker.getContainer(containerId)
      const actualPassword = password?.trim() || "defaultpass123"

      console.log(`Fixing password for container ${containerId}`)

      const commands = [
        // Ensure user exists
        "id root || useradd -m -s /bin/bash root",

        // Set password
        `echo 'root:${actualPassword}' | chpasswd`,

        // Ensure sudo access
        "usermod -aG sudo root",
        "grep -q 'root ALL=(ALL) NOPASSWD:ALL' /etc/sudoers || echo 'root ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers",

        // Restart SSH
        "service ssh restart",

        // Test user
        `su - root -c 'whoami && echo "User test successful"'`,
      ]

      for (const cmd of commands) {
        try {
          const exec = await container.exec({
            Cmd: ["/bin/bash", "-c", cmd],
            AttachStdout: true,
            AttachStderr: true,
          })
          await exec.start()
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (error) {
          console.error(`Error executing: ${cmd}`, error)
        }
      }

      console.log("Password fix completed")
      return true
    } catch (error) {
      console.error("Password fix error:", error)
      return false
    }
  }
}

module.exports = VMManager;