const express = require("express");
const router = express.Router();
const VMManager = require("../utils/VMManager"); // ✅ Import class, don't define again
const requireAuth = require("../middlewares/requireAuth");
const { CONFIG } = require("../config/db")
const fs = require("fs-extra")
const Docker = require("dockerode")

const docker = new Docker()
// All VM endpoints...

router.post("/api/create-vm", requireAuth, async (req, res) => {
    try {
        const { vmPassword, customDomain } = req.body
        const userId = req.session.userId.toString()

        console.log(`VM creation request from user ${userId}`)

        if (!vmPassword) {
            return res.status(400).json({ error: "VM password is required" })
        }

        // Check if user already has a VM
        const vmData = await VMManager.loadVMData()
        if (vmData[userId]) {
            return res.status(400).json({ error: "User already has a VM" })
        }

        // Get available ports
        const { sshPort, httpPort, rdpPort } = await VMManager.getNextAvailablePorts()
        console.log(`Assigned ports - SSH: ${sshPort}, HTTP: ${httpPort}`)

        // Generate subdomain
        const subdomain = customDomain || `user${userId.slice(-6)}`
        console.log(`Using subdomain: ${subdomain}`)

        // Create container
        console.log("Starting container creation...")
        const container = await VMManager.createContainer(userId, vmPassword, sshPort, httpPort, rdpPort)

        // Generate Nginx config
        console.log("Generating Nginx configuration...")
        await VMManager.generateNginxConfig(userId, httpPort, subdomain)

        // Save VM data
        vmData[userId] = {
            containerId: container.id,
            containerName: `vm_${userId}`,
            sshPort,
            httpPort,
            subdomain,
            domain: `${subdomain}.${CONFIG.DOMAIN}`,
            createdAt: new Date().toISOString(),
            status: "running",
        }

        await VMManager.saveVMData(vmData)
        console.log(`VM data saved for user ${userId}`)

        res.json({
            success: true,
            vm: vmData[userId],
            message: "VM created successfully! Please wait 1-2 minutes for full initialization.",
        })
    } catch (error) {
        console.error("VM creation error:", error)
        res.status(500).json({ error: "Failed to create VM: " + error.message })
    }
})







router.get("/api/vm-status", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId.toString()
        const vmData = await VMManager.loadVMData()
        const userVM = vmData[userId]

        if (!userVM) {
            return res.json({ hasVM: false })
        }

        // Check container status
        try {
            const container = docker.getContainer(userVM.containerId)
            const info = await container.inspect()
            userVM.status = info.State.Running ? "running" : "stopped"
        } catch (error) {
            userVM.status = "error"
        }

        res.json({
            hasVM: true,
            vm: userVM,
        })
    } catch (error) {
        console.error("VM status error:", error)
        res.status(500).json({ error: "Failed to get VM status" })
    }
})

router.post("/api/vm-action", requireAuth, async (req, res) => {
    try {
        const { action } = req.body
        const userId = req.session.userId.toString()
        const vmData = await VMManager.loadVMData()
        const userVM = vmData[userId]

        if (!userVM) {
            return res.status(404).json({ error: "VM not found" })
        }

        const container = docker.getContainer(userVM.containerId)
        console.log(action)
        switch (action) {
            case "start":
                await container.start()
                userVM.status = "running"
                break
            case "stop":
                await container.stop()
                userVM.status = "stopped"
                break
            case "restart":
                await container.restart()
                userVM.status = "running"
                break
            case "remove":
                await container.remove({ force: true })
                await VMManager.removeNginxConfig(userVM.subdomain)
                delete vmData[userId]
                await VMManager.saveVMData(vmData)
                return res.json({ success: true, message: "VM removed successfully" })
            default:
                return res.status(400).json({ error: "Invalid action" })
        }

        await VMManager.saveVMData(vmData)
        res.json({ success: true, vm: userVM })
    } catch (error) {
        console.error("VM action error:", error)
        res.status(500).json({ error: "Failed to perform VM action: " + error.message })
    }
})

router.post("/api/fix-vm-password", requireAuth, async (req, res) => {
    try {
        const { newPassword } = req.body
        const userId = req.session.userId.toString()
        const vmData = await VMManager.loadVMData()
        const userVM = vmData[userId]

        if (!userVM) {
            return res.status(404).json({ error: "VM not found" })
        }

        if (!newPassword) {
            return res.status(400).json({ error: "New password is required" })
        }

        // Fix the password in the container
        const success = await VMManager.fixContainerPassword(userVM.containerId, newPassword)

        if (success) {
            res.json({
                success: true,
                message: "Password updated successfully. Try SSH again in 30 seconds.",
            })
        } else {
            res.status(500).json({ error: "Failed to update password" })
        }
    } catch (error) {
        console.error("Password fix error:", error)
        res.status(500).json({ error: "Failed to fix password: " + error.message })
    }
})
module.exports = router;