const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

// Configuration
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = [
    '.txt', '.js', '.html', '.css', '.json', '.md', '.py', '.php', '.java',
    '.cpp', '.c', '.sql', '.xml', '.yaml', '.yml', '.env', '.config', '.ini',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip', '.rar',
    '.mp3', '.wav', '.mp4', '.avi', '.mov', '.ts', '.jsx', '.tsx', '.scss', '.sass'
];

// Helper: Get user's root directory
function getUserRootDir(userId) {
    if (!userId) {
        throw new Error('User ID is required');
    }
    return path.resolve(__dirname, '..', 'Hostedfiles', userId.toString());
}

// Middleware: Require authentication and set ROOT_DIR
const requireAuth = (req, res, next) => {
    const userId = req.session?.userId?.toString();
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Set ROOT_DIR for this request
    req.ROOT_DIR = getUserRootDir(userId);
    req.userId = userId;
    next();
};

// Apply auth middleware to all routes
router.use(requireAuth);

// Ensure directories exist
async function ensureDirectories() {
    try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
    } catch (error) {
        console.error('Failed to create upload directory:', error);
    }
}

// Initialize directories
ensureDirectories();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 10
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_EXTENSIONS.includes(ext) || ext === '') {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} not allowed`), false);
        }
    }
});

// Helper: Validate path security
function validatePath(filePath, basePath) {
    try {
        const resolvedPath = path.resolve(filePath);
        const resolvedBase = path.resolve(basePath);
        return resolvedPath.startsWith(resolvedBase);
    } catch (error) {
        return false;
    }
}

// Helper: Get file stats with error handling
async function getFileStats(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return {
            size: stats.size,
            mtime: stats.mtime,
            ctime: stats.ctime,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile()
        };
    } catch (error) {
        return null;
    }
}

// Helper: Get MIME type
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// Helper: Recursively walk directory with enhanced metadata
async function walkDir(dir, relativePath = '') {
    try {
        const items = await fs.readdir(dir);
        const results = [];

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
            const stats = await getFileStats(fullPath);

            if (!stats) continue;

            if (stats.isDirectory) {
                const children = await walkDir(fullPath, itemRelativePath);
                results.push({
                    name: item,
                    type: 'folder',
                    path: itemRelativePath,
                    children: children,
                    size: children.reduce((acc, child) => acc + (child.size || 0), 0),
                    modified: stats.mtime,
                    created: stats.ctime
                });
            } else {
                results.push({
                    name: item,
                    type: 'file',
                    path: itemRelativePath,
                    size: stats.size,
                    modified: stats.mtime,
                    created: stats.ctime,
                    extension: path.extname(item).toLowerCase(),
                    mimeType: getMimeType(item)
                });
            }
        }

        // Sort: folders first, then files, both alphabetically
        return results.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
    } catch (error) {
        console.error(`Error walking directory ${dir}:`, error);
        return [];
    }
}

// Helper: Create directory recursively
async function createDirectory(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch (error) {
        console.error('Failed to create directory:', error);
        return false;
    }
}

// Helper: Delete directory or file recursively
async function deleteItem(itemPath) {
    try {
        const stats = await getFileStats(itemPath);
        if (!stats) return false;

        if (stats.isDirectory) {
            await fs.rm(itemPath, { recursive: true, force: true });
        } else {
            await fs.unlink(itemPath);
        }
        return true;
    } catch (error) {
        console.error('Failed to delete item:', error);
        return false;
    }
}

// Helper: Copy file or directory
async function copyItem(sourcePath, destPath) {
    try {
        const stats = await getFileStats(sourcePath);
        if (!stats) return false;

        if (stats.isDirectory) {
            await fs.mkdir(destPath, { recursive: true });
            const items = await fs.readdir(sourcePath);
            for (const item of items) {
                const srcItem = path.join(sourcePath, item);
                const destItem = path.join(destPath, item);
                await copyItem(srcItem, destItem);
            }
        } else {
            await fs.copyFile(sourcePath, destPath);
        }
        return true;
    } catch (error) {
        console.error('Failed to copy item:', error);
        return false;
    }
}

// Route: Get file tree
router.get('/list', async (req, res) => {
    try {
        // Ensure user directory exists
        await createDirectory(req.ROOT_DIR);
        
        const requestedPath = req.query.path || '';
        const safePath = path.resolve(req.ROOT_DIR, requestedPath);
        
        if (!safePath.startsWith(req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const tree = await walkDir(req.ROOT_DIR);
        res.json(tree);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: 'Failed to list files', details: error.message });
    }
});

// Route: Read file content
router.post('/read', async (req, res) => {
    try {
        const { path: filePath } = req.body;
        if (!filePath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        const fullPath = path.join(req.ROOT_DIR, filePath);
        if (!validatePath(fullPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        const stats = await getFileStats(fullPath);
        if (!stats) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (stats.isDirectory) {
            return res.status(400).json({ error: 'Cannot read directory as file' });
        }

        // Check if file is too large for text editing (>10MB)
        if (stats.size > 10 * 1024 * 1024) {
            return res.status(413).json({ error: 'File too large for editing' });
        }

        const content = await fs.readFile(fullPath, 'utf-8');
        res.json({
            content,
            stats: {
                size: stats.size,
                mtime: stats.mtime,
                ctime: stats.ctime
            },
            path: filePath
        });
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EISDIR') {
            res.status(400).json({ error: 'Cannot read directory as file' });
        } else {
            res.status(500).json({ error: 'Failed to read file', details: error.message });
        }
    }
});
// Route: Save file content
router.post('/save', async (req, res) => {
    try {
        const { path: filePath, content } = req.body;
        if (!filePath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        const fullPath = path.join(req.ROOT_DIR, filePath);

        if (!validatePath(fullPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        // Ensure parent directory exists
        const parentDir = path.dirname(fullPath);
        await createDirectory(parentDir);

        // Only backup if file exists and is larger than 1KB
        const stats = await getFileStats(fullPath);
        const isInsideBackupDir = fullPath.includes(path.sep + 'backup' + path.sep);

        if (stats && stats.size > 1024 && !isInsideBackupDir) {
            const backupDir = path.join(parentDir, 'backup');
            await createDirectory(backupDir); // Ensure backup folder exists

            const fileName = path.basename(fullPath);
            const timestamp = Date.now();
            const backupPath = path.join(backupDir, `${fileName}.backup.${timestamp}`);

            try {
                await fs.copyFile(fullPath, backupPath);
            } catch (backupError) {
                console.warn('Failed to create backup:', backupError);
            }
        }

        await fs.writeFile(fullPath, content || '', 'utf-8');
        const newStats = await getFileStats(fullPath);

        res.json({
            success: true,
            path: filePath,
            stats: newStats
        });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).json({ error: 'Failed to save file', details: error.message });
    }
});


// Route: Upload files
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { target = '' } = req.body;
        const targetDir = path.join(req.ROOT_DIR, target);
        
        if (!validatePath(targetDir, req.ROOT_DIR)) {
            // Clean up temp file
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                console.warn('Failed to cleanup temp file:', cleanupError);
            }
            return res.status(403).json({ error: 'Invalid target path' });
        }

        await createDirectory(targetDir);
        const targetPath = path.join(targetDir, req.file.originalname);

        // Check if file already exists and rename if necessary
        let finalPath = targetPath;
        let counter = 1;
        while (await getFileStats(finalPath)) {
            const ext = path.extname(req.file.originalname);
            const name = path.basename(req.file.originalname, ext);
            finalPath = path.join(targetDir, `${name}_${counter}${ext}`);
            counter++;
        }

        await fs.rename(req.file.path, finalPath);

        res.json({
            success: true,
            filename: path.basename(finalPath),
            path: path.relative(req.ROOT_DIR, finalPath)
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        // Clean up temp file on error
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                console.warn('Failed to cleanup temp file:', cleanupError);
            }
        }
        res.status(500).json({ error: 'Upload failed', details: error.message });
    }
});

// Route: Create directory
router.post('/mkdir', async (req, res) => {
    try {
        const { path: dirPath } = req.body;
        if (!dirPath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        const fullPath = path.join(req.ROOT_DIR, dirPath);
        if (!validatePath(fullPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        // Check if already exists
        const stats = await getFileStats(fullPath);
        if (stats) {
            return res.status(409).json({ error: 'Directory already exists' });
        }

        const success = await createDirectory(fullPath);
        if (success) {
            res.json({ success: true, path: dirPath });
        } else {
            res.status(500).json({ error: 'Failed to create directory' });
        }
    } catch (error) {
        console.error('Error creating directory:', error);
        res.status(500).json({ error: 'Failed to create directory', details: error.message });
    }
});

// Route: Delete file or directory
router.post('/delete', async (req, res) => {
    try {
        const { path: itemPath } = req.body;
        if (!itemPath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        const fullPath = path.join(req.ROOT_DIR, itemPath);
        if (!validatePath(fullPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        const stats = await getFileStats(fullPath);
        if (!stats) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const success = await deleteItem(fullPath);
        if (success) {
            res.json({
                success: true,
                path: itemPath,
                type: stats.isDirectory ? 'folder' : 'file'
            });
        } else {
            res.status(500).json({ error: 'Failed to delete item' });
        }
    } catch (error) {
        console.error('Error deleting item:', error);
        res.status(500).json({ error: 'Failed to delete item', details: error.message });
    }
});

// Route: Rename file or directory
router.post('/rename', async (req, res) => {
    try {
        const { oldPath, newPath } = req.body;
        if (!oldPath || !newPath) {
            return res.status(400).json({ error: 'Both oldPath and newPath are required' });
        }

        const fullOldPath = path.join(req.ROOT_DIR, oldPath);
        const fullNewPath = path.join(req.ROOT_DIR, newPath);

        if (!validatePath(fullOldPath, req.ROOT_DIR) || !validatePath(fullNewPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        // Check if source exists
        const oldStats = await getFileStats(fullOldPath);
        if (!oldStats) {
            return res.status(404).json({ error: 'Source item not found' });
        }

        // Check if destination already exists
        const newStats = await getFileStats(fullNewPath);
        if (newStats) {
            return res.status(409).json({ error: 'Destination already exists' });
        }

        await fs.rename(fullOldPath, fullNewPath);

        res.json({
            success: true,
            oldPath,
            newPath,
            type: oldStats.isDirectory ? 'folder' : 'file'
        });
    } catch (error) {
        console.error('Error renaming item:', error);
        res.status(500).json({ error: 'Failed to rename item', details: error.message });
    }
});

// Route: Copy file or directory
router.post('/copy', async (req, res) => {
    try {
        const { sourcePath, destPath } = req.body;
        if (!sourcePath || !destPath) {
            return res.status(400).json({ error: 'Both sourcePath and destPath are required' });
        }

        const fullSourcePath = path.join(req.ROOT_DIR, sourcePath);
        const fullDestPath = path.join(req.ROOT_DIR, destPath);

        if (!validatePath(fullSourcePath, req.ROOT_DIR) || !validatePath(fullDestPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        // Check if source exists
        const sourceStats = await getFileStats(fullSourcePath);
        if (!sourceStats) {
            return res.status(404).json({ error: 'Source item not found' });
        }

        // Check if destination already exists
        const destStats = await getFileStats(fullDestPath);
        if (destStats) {
            return res.status(409).json({ error: 'Destination already exists' });
        }

        const success = await copyItem(fullSourcePath, fullDestPath);
        if (success) {
            res.json({
                success: true,
                sourcePath,
                destPath,
                type: sourceStats.isDirectory ? 'folder' : 'file'
            });
        } else {
            res.status(500).json({ error: 'Failed to copy item' });
        }
    } catch (error) {
        console.error('Error copying item:', error);
        res.status(500).json({ error: 'Failed to copy item', details: error.message });
    }
});

// Route: Move file or directory
router.post('/move', async (req, res) => {
    try {
        const { sourcePath, destPath } = req.body;
        if (!sourcePath || !destPath) {
            return res.status(400).json({ error: 'Both sourcePath and destPath are required' });
        }

        const fullSourcePath = path.join(req.ROOT_DIR, sourcePath);
        const fullDestPath = path.join(req.ROOT_DIR, destPath);

        if (!validatePath(fullSourcePath, req.ROOT_DIR) || !validatePath(fullDestPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        // Check if source exists
        const sourceStats = await getFileStats(fullSourcePath);
        if (!sourceStats) {
            return res.status(404).json({ error: 'Source item not found' });
        }

        // Check if destination already exists
        const destStats = await getFileStats(fullDestPath);
        if (destStats) {
            return res.status(409).json({ error: 'Destination already exists' });
        }

        // Ensure destination directory exists
        const destDir = path.dirname(fullDestPath);
        await createDirectory(destDir);

        await fs.rename(fullSourcePath, fullDestPath);

        res.json({
            success: true,
            sourcePath,
            destPath,
            type: sourceStats.isDirectory ? 'folder' : 'file'
        });
    } catch (error) {
        console.error('Error moving item:', error);
        res.status(500).json({ error: 'Failed to move item', details: error.message });
    }
});

// Route: Search files and directories
router.post('/search', async (req, res) => {
    try {
        const { query, type = 'all', path: searchPath = '' } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const searchDir = path.join(req.ROOT_DIR, searchPath);
        if (!validatePath(searchDir, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid search path' });
        }

        const results = [];

        async function searchInDir(dir, relativePath = '') {
            try {
                const items = await fs.readdir(dir);
                for (const item of items) {
                    const fullPath = path.join(dir, item);
                    const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
                    const stats = await getFileStats(fullPath);

                    if (!stats) continue;

                    const matchesQuery = item.toLowerCase().includes(query.toLowerCase());
                    const matchesType = type === 'all' ||
                        (type === 'file' && stats.isFile) ||
                        (type === 'folder' && stats.isDirectory);

                    if (matchesQuery && matchesType) {
                        results.push({
                            name: item,
                            type: stats.isDirectory ? 'folder' : 'file',
                            path: itemRelativePath,
                            size: stats.size,
                            modified: stats.mtime
                        });
                    }

                    // Recursively search in subdirectories
                    if (stats.isDirectory) {
                        await searchInDir(fullPath, itemRelativePath);
                    }
                }
            } catch (error) {
                console.warn(`Error searching in directory ${dir}:`, error);
            }
        }

        await searchInDir(searchDir, searchPath);

        res.json({
            success: true,
            query,
            results: results.slice(0, 100) // Limit to 100 results
        });
    } catch (error) {
        console.error('Error searching:', error);
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});

// Route: Get file/directory info
router.post('/info', async (req, res) => {
    try {
        const { path: itemPath } = req.body;
        if (!itemPath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        const fullPath = path.join(req.ROOT_DIR, itemPath);
        if (!validatePath(fullPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        const stats = await getFileStats(fullPath);
        if (!stats) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const info = {
            name: path.basename(itemPath),
            path: itemPath,
            type: stats.isDirectory ? 'folder' : 'file',
            size: stats.size,
            modified: stats.mtime,
            created: stats.ctime,
            isDirectory: stats.isDirectory,
            isFile: stats.isFile
        };

        if (stats.isFile) {
            info.extension = path.extname(itemPath).toLowerCase();
            info.mimeType = getMimeType(itemPath);
        }

        res.json(info);
    } catch (error) {
        console.error('Error getting item info:', error);
        res.status(500).json({ error: 'Failed to get item info', details: error.message });
    }
});

// Route: Download file
router.get('/download', async (req, res) => {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            return res.status(400).json({ error: 'Path parameter is required' });
        }

        const fullPath = path.join(req.ROOT_DIR, filePath);
        if (!validatePath(fullPath, req.ROOT_DIR)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        const stats = await getFileStats(fullPath);
        if (!stats) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (stats.isDirectory) {
            return res.status(400).json({ error: 'Cannot download directory' });
        }

        const filename = path.basename(filePath);
        const mimeType = getMimeType(filePath);

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stats.size);

        const fileStream = fsSync.createReadStream(fullPath);
        fileStream.pipe(res);
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Download failed', details: error.message });
    }
});

// Error handling middleware
router.use((error, req, res, next) => {
    console.error('Router error:', error);
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(413).json({ error: 'Too many files' });
        }
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
});

module.exports = router;
