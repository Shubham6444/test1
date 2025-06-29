// const express = require('express');
// const bcrypt = require('bcrypt');
// const Docker = require('dockerode');
// const fs = require('fs-extra');
// const path = require('path');
// const { exec } = require('child_process');
// const util = require('util');
// const { MongoClient, ObjectId } = require("mongodb")


// const router = express.Router();
// const docker = new Docker();
// const execAsync = util.promisify(exec);

// // Admin credentials (in production, store in database)
// const ADMIN_CREDENTIALS = {
//     username: 'admin',
//     password: '$2b$10$deWGKiFUtQDSIpYdCjM.f.Z9yjHrVMnHWylmVNpwLmRRqgjqSTYmS' // 'admin123'
// };
// const CONFIG = {
//     PORT: 3000,
//     MONGODB_URL:"mongodb+srv://pathshalamath6:8GifF4HGtqxknH6U@cluster0.ryifmx3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
//     DB_NAME: "vm_platform",
//     SSH_PORT_START: 2201,
//     HTTP_PORT_START: 8001,
//     RDP_PORT_START: 3390,
//     DOMAIN: "remixorbit.in",
//     NGINX_CONFIG_PATH: "/etc/nginx/sites-available",
//     NGINX_ENABLED_PATH: "/etc/nginx/sites-enabled",
//     DATA_FILE: "./data/vm_mappings.json",
// }
// // Admin authentication middleware
// const requireAdmin = (req, res, next) => {
//     if (req.session.isAdmin) {
//         next();
//     } else {
//         res.status(401).json({ error: 'Admin authentication required' });
//     }
// };

// // Admin login
// router.post('/login', async (req, res) => {
//     try {
//         const { username, password } = req.body;

//         if (username === ADMIN_CREDENTIALS.username &&
//             await bcrypt.compare(password, ADMIN_CREDENTIALS.password)) {
//             req.session.isAdmin = true;
//             req.session.adminUsername = username;
//             res.json({ success: true, message: 'Admin login successful' });
//         } else {
//             res.status(401).json({ error: 'Invalid admin credentials' });
//         }
//     } catch (error) {
//         console.error('Admin login error:', error);
//         res.status(500).json({ error: 'Login failed' });
//     }
// });

// // Admin logout
// router.post('/logout', (req, res) => {
//     req.session.isAdmin = false;
//     req.session.adminUsername = null;
//     res.json({ success: true, message: 'Admin logged out successfully' });
// });

// // Get all users
// router.get('/users', requireAdmin, async (req, res) => {
//     try {
//         const db = req.app.locals.db || global.db;
//         const users = await db.collection('users').find({}, {
//             projection: { password: 0 }
//         }).toArray();

//         res.json({ success: true, users });
//     } catch (error) {
//         console.error('Error fetching users:', error);
//         res.status(500).json({ error: 'Failed to fetch users' });
//     }
// });

// // Get all VMs
// router.get('/vms', requireAdmin, async (req, res) => {
//     try {
//         const VMManager = req.app.locals.VMManager;
//         const vmData = await VMManager.loadVMData();

//         // Get container statuses
//         const vmsWithStatus = {};
//         for (const [userId, vm] of Object.entries(vmData)) {
//             try {
//                 const container = docker.getContainer(vm.containerId);
//                 const info = await container.inspect();
//                 vmsWithStatus[userId] = {
//                     ...vm,
//                     status: info.State.Running ? 'running' : 'stopped',
//                     containerInfo: {
//                         created: info.Created,
//                         startedAt: info.State.StartedAt,
//                         finishedAt: info.State.FinishedAt,
//                         restartCount: info.RestartCount
//                     }
//                 };
//             } catch (error) {
//                 vmsWithStatus[userId] = {
//                     ...vm,
//                     status: 'error',
//                     error: error.message
//                 };
//             }
//         }

//         res.json({ success: true, vms: vmsWithStatus });
//     } catch (error) {
//         console.error('Error fetching VMs:', error);
//         res.status(500).json({ error: 'Failed to fetch VMs' });
//     }
// });
// MongoClient.connect(CONFIG.MONGODB_URL)
//     .then((client) => {
//         console.log("Connected to MongoDB")
//         db = client.db(CONFIG.DB_NAME)
//     })
//     .catch((error) => console.error("MongoDB connection error:", error))

// // Get system statistics
// router.get('/stats', requireAdmin, async (req, res) => {
//     try {
//         const db = req.app.locals.db || global.db;
//         const VMManager = req.app.locals.VMManager;

//         // Get user count
//         const userCount = await db.collection('users').countDocuments();

//         // Get VM data
//         const vmData = await VMManager.loadVMData();
//         const vmCount = Object.keys(vmData).length;

//         // Get running containers
//         const containers = await docker.listContainers();
//         const runningVMs = containers.filter(c => c.Names[0].startsWith('/vm_')).length;

//         // Get system info
//         const systemInfo = await docker.info();

//         // Get port usage
//         const usedSSHPorts = Object.values(vmData).map(vm => vm.sshPort);
//         const usedHTTPPorts = Object.values(vmData).map(vm => vm.httpPort);

//         res.json({
//             success: true,
//             stats: {
//                 users: userCount,
//                 totalVMs: vmCount,
//                 runningVMs: runningVMs,
//                 stoppedVMs: vmCount - runningVMs,
//                 usedSSHPorts: usedSSHPorts.length,
//                 usedHTTPPorts: usedHTTPPorts.length,
//                 systemInfo: {
//                     containers: systemInfo.Containers,
//                     images: systemInfo.Images,
//                     memTotal: systemInfo.MemTotal,
//                     cpus: systemInfo.NCPU
//                 }
//             }
//         });
//     } catch (error) {
//         console.error('Error fetching stats:', error);
//         res.status(500).json({ error: 'Failed to fetch statistics' });
//     }
// });

// // VM Actions (start, stop, restart, delete)
// router.post('/vm-action', requireAdmin, async (req, res) => {
//     try {
//         const { userId, action } = req.body;
//         const VMManager = req.app.locals.VMManager;

//         if (!userId || !action) {
//             return res.status(400).json({ error: 'User ID and action are required' });
//         }

//         const vmData = await VMManager.loadVMData();
//         const userVM = vmData[userId];

//         if (!userVM) {
//             return res.status(404).json({ error: 'VM not found' });
//         }

//         const container = docker.getContainer(userVM.containerId);

//         switch (action) {
//   case 'start':
//     try {
//       const inspectStart = await container.inspect();
//       if (!inspectStart.State.Running) {
//         await container.start();
//         userVM.status = 'running';
//         console.log(`Container ${userVM.containerId} started.`);
//       } else {
//         console.log(`Container ${userVM.containerId} is already running.`);
//       }
//     } catch (err) {
//       console.error(`Failed to start container:`, err);
//       return res.status(500).json({ error: 'Failed to start container' });
//     }
//     break;

//   case 'stop':
//     try {
//       const inspectStop = await container.inspect();
//       if (inspectStop.State.Running) {
//         await container.stop();
//         userVM.status = 'stopped';
//         console.log(`Container ${userVM.containerId} stopped.`);
//       } else {
//         console.log(`Container ${userVM.containerId} is already stopped.`);
//       }
//     } catch (err) {
//       console.error(`Failed to stop container:`, err);
//       return res.status(500).json({ error: 'Failed to stop container' });
//     }
//     break;

//   case 'restart':
//     try {
//       await container.restart();
//       userVM.status = 'running';
//       console.log(`Container ${userVM.containerId} restarted.`);
//     } catch (err) {
//       console.error(`Failed to restart container:`, err);
//       return res.status(500).json({ error: 'Failed to restart container' });
//     }
//     break;

//   case 'delete':
//     try {
//       await container.remove({ force: true });
//       console.log(`Container ${userVM.containerId} deleted.`);
//     } catch (err) {
//       if (err.statusCode === 404) {
//         console.warn(`Container ${userVM.containerId} already deleted or missing.`);
//       } else {
//         console.error(`Failed to delete container:`, err);
//         return res.status(500).json({ error: 'Failed to delete container' });
//       }
//     }

//     try {
//       await VMManager.removeNginxConfig(userVM.subdomain);
//     } catch (err) {
//       console.warn(`Failed to remove NGINX config:`, err.message);
//     }

//     delete vmData[userId];
//     await VMManager.saveVMData(vmData);
//     return res.json({ success: true, message: 'VM deleted successfully' });

//   default:
//     return res.status(400).json({ error: 'Invalid action' });
// }


//         await VMManager.saveVMData(vmData);
//         res.json({ success: true, message: `VM ${action} completed successfully`, vm: userVM });
//     } catch (error) {
//         console.error('VM action error:', error);
//         res.status(500).json({ error: `Failed to perform VM action: ${error.message}` });
//     }
// });

// // Change VM password
// router.post('/change-vm-password', requireAdmin, async (req, res) => {
//     try {
//         const { userId, newPassword } = req.body;
//         const VMManager = req.app.locals.VMManager;

//         if (!userId || !newPassword) {
//             return res.status(400).json({ error: 'User ID and new password are required' });
//         }

//         const vmData = await VMManager.loadVMData();
//         const userVM = vmData[userId];

//         if (!userVM) {
//             return res.status(404).json({ error: 'VM not found' });
//         }

//         // Fix the password in the container
//         const success = await VMManager.fixContainerPassword(userVM.containerId, newPassword);

//         if (success) {
//             res.json({
//                 success: true,
//                 message: 'VM password updated successfully'
//             });
//         } else {
//             res.status(500).json({ error: 'Failed to update VM password' });
//         }
//     } catch (error) {
//         console.error('Password change error:', error);
//         res.status(500).json({ error: 'Failed to change VM password' });
//     }
// });

// // Delete user account
// router.delete('/user/:userId', requireAdmin, async (req, res) => {
//     try {
//         const { userId } = req.params;
//         const db = req.app.locals.db || global.db;
//         const VMManager = req.app.locals.VMManager;

//         // First, delete user's VM if exists
//         const vmData = await VMManager.loadVMData();
//         if (vmData[userId]) {
//             try {
//                 const container = docker.getContainer(vmData[userId].containerId);
//                 await container.remove({ force: true });
//                 await VMManager.removeNginxConfig(vmData[userId].subdomain);
//                 delete vmData[userId];
//                 await VMManager.saveVMData(vmData);
//             } catch (error) {
//                 console.error('Error removing user VM:', error);
//             }
//         }

//         // Delete user from database
//         // const result = await db.collection('users').deleteOne({ _id: require('mongodb').ObjectId(userId) });
//         const result = await db.collection('users').deleteOne({ _id: new ObjectId(userId) });

//         if (result.deletedCount > 0) {
//             res.json({ success: true, message: 'User and associated VM deleted successfully' });
//         } else {
//             res.status(404).json({ error: 'User not found' });
//         }
//     } catch (error) {
//         console.error('User deletion error:', error);
//         res.status(500).json({ error: 'Failed to delete user' });
//     }
// });

// // Get VM logs
// router.get('/vm-logs/:userId', requireAdmin, async (req, res) => {
//     try {
//         const { userId } = req.params;
//         const VMManager = req.app.locals.VMManager;

//         const vmData = await VMManager.loadVMData();
//         const userVM = vmData[userId];

//         if (!userVM) {
//             return res.status(404).json({ error: 'VM not found' });
//         }

//         const container = docker.getContainer(userVM.containerId);
//         const logs = await container.logs({
//             stdout: true,
//             stderr: true,
//             tail: 100,
//             timestamps: true
//         });

//         res.json({
//             success: true,
//             logs: logs.toString()
//         });
//     } catch (error) {
//         console.error('Error fetching VM logs:', error);
//         res.status(500).json({ error: 'Failed to fetch VM logs' });
//     }
// });

// // Execute command in VM
// router.post('/vm-exec', requireAdmin, async (req, res) => {
//     try {
//         const { userId, command } = req.body;
//         const VMManager = req.app.locals.VMManager;

//         if (!userId || !command) {
//             return res.status(400).json({ error: 'User ID and command are required' });
//         }

//         const vmData = await VMManager.loadVMData();
//         const userVM = vmData[userId];

//         if (!userVM) {
//             return res.status(404).json({ error: 'VM not found' });
//         }

//         const container = docker.getContainer(userVM.containerId);
//         const exec = await container.exec({
//             Cmd: ['/bin/bash', '-c', command],
//             AttachStdout: true,
//             AttachStderr: true
//         });

//         const stream = await exec.start();
//         let output = '';

//         stream.on('data', (chunk) => {
//             output += chunk.toString();
//         });

//         stream.on('end', () => {
//             res.json({
//                 success: true,
//                 output: output
//             });
//         });

//     } catch (error) {
//         console.error('Command execution error:', error);
//         res.status(500).json({ error: 'Failed to execute command' });
//     }
// });

// // Get system logs
// router.get('/system-logs', requireAdmin, async (req, res) => {
//     try {
//         const { lines = 50 } = req.query;

//         // Get system logs (adjust path based on your system)
//         const logCommands = [
//             `journalctl -u nginx -n ${lines} --no-pager`,
//             `tail -n ${lines} /var/log/syslog`,
//             `docker system events --since 1h --until now`
//         ];

//         const logs = {};
//         for (const cmd of logCommands) {
//             try {
//                 const { stdout } = await execAsync(cmd);
//                 logs[cmd] = stdout;
//             } catch (error) {
//                 logs[cmd] = `Error: ${error.message}`;
//             }
//         }

//         res.json({
//             success: true,
//             logs: logs
//         });
//     } catch (error) {
//         console.error('System logs error:', error);
//         res.status(500).json({ error: 'Failed to fetch system logs' });
//     }
// });

// // Cleanup orphaned containers
// router.post('/cleanup', requireAdmin, async (req, res) => {
//     try {
//         const VMManager = req.app.locals.VMManager;
//         const vmData = await VMManager.loadVMData();

//         // Get all containers
//         const containers = await docker.listContainers({ all: true });
//         const vmContainers = containers.filter(c => c.Names[0].startsWith('/vm_'));

//         let cleaned = 0;

//         for (const containerInfo of vmContainers) {
//             const containerName = containerInfo.Names[0].substring(1); // Remove leading /
//             const userId = containerName.replace('vm_', '');

//             // If container exists but no VM data, it's orphaned
//             if (!vmData[userId]) {
//                 try {
//                     const container = docker.getContainer(containerInfo.Id);
//                     await container.remove({ force: true });
//                     cleaned++;
//                     console.log(`Cleaned orphaned container: ${containerName}`);
//                 } catch (error) {
//                     console.error(`Failed to clean container ${containerName}:`, error);
//                 }
//             }
//         }

//         res.json({
//             success: true,
//             message: `Cleanup completed. Removed ${cleaned} orphaned containers.`,
//             cleaned: cleaned
//         });
//     } catch (error) {
//         console.error('Cleanup error:', error);
//         res.status(500).json({ error: 'Failed to perform cleanup' });
//     }
// });

// module.exports = router;











const express = require('express');
const bcrypt = require('bcrypt');
const Docker = require('dockerode');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const User = require('../models/user'); // ✅ Use Mongoose User model
const CONFIG = require('../config/db')
const router = express.Router();
const docker = new Docker();
const execAsync = util.promisify(exec);

// Admin credentials (hash stored - for demo only, store in DB in production)
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: '$2b$10$deWGKiFUtQDSIpYdCjM.f.Z9yjHrVMnHWylmVNpwLmRRqgjqSTYmS' // 'admin123'
};

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.status(401).json({ error: 'Admin authentication required' });
};

// Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        if (username === ADMIN_CREDENTIALS.username &&
            await bcrypt.compare(password, ADMIN_CREDENTIALS.password)) {
            req.session.isAdmin = true;
            req.session.adminUsername = username;
            return res.json({ success: true, message: 'Admin login successful' });
        }
        res.status(401).json({ error: 'Invalid admin credentials' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.isAdmin = false;
    req.session.adminUsername = null;
    res.json({ success: true, message: 'Admin logged out' });
});

// Get all users
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json({ success: true, users });
    } catch (error) {
        console.error('Fetching users failed:', error);
        res.status(500).json({ error: 'Could not retrieve users' });
    }
});

// Delete user
router.delete('/user/:userId', requireAdmin, async (req, res) => {
    const { userId } = req.params;
    const VMManager = req.app.locals.VMManager;

    try {
        const vmData = await VMManager.loadVMData();
        if (vmData[userId]) {
            try {
                const container = docker.getContainer(vmData[userId].containerId);
                await container.remove({ force: true });
                await VMManager.removeNginxConfig(vmData[userId].subdomain);
                delete vmData[userId];
                await VMManager.saveVMData(vmData);
            } catch (error) {
                console.error('Error deleting container:', error.message);
            }
        }

        const result = await User.deleteOne({ _id: userId });
        if (result.deletedCount > 0) {
            res.json({ success: true, message: 'User and VM deleted' });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        console.error('User delete error:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

// System stats
router.get('/stats', requireAdmin, async (req, res) => {
    try {
        const VMManager = req.app.locals.VMManager;
        const userCount = await User.countDocuments();
        const vmData = await VMManager.loadVMData();
        const containers = await docker.listContainers();
        const runningVMs = containers.filter(c => c.Names[0].startsWith('/vm_')).length;
        const systemInfo = await docker.info();

        res.json({
            success: true,
            stats: {
                users: userCount,
                totalVMs: Object.keys(vmData).length,
                runningVMs,
                stoppedVMs: Object.keys(vmData).length - runningVMs,
                usedSSHPorts: Object.values(vmData).map(vm => vm.sshPort).length,
                usedHTTPPorts: Object.values(vmData).map(vm => vm.httpPort).length,
                systemInfo: {
                    containers: systemInfo.Containers,
                    images: systemInfo.Images,
                    memTotal: systemInfo.MemTotal,
                    cpus: systemInfo.NCPU
                }
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

module.exports = router;


