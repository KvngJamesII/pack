const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// VPS Configuration from environment variables
const VPS_CONFIG = {
    host: process.env.VPS_HOST || '159.203.137.126',
    port: parseInt(process.env.VPS_PORT) || 22,
    username: process.env.VPS_USER || 'root',
    password: process.env.VPS_PASSWORD || ''
};

// Debug: Log config on startup (mask password)
console.log('VPS Config loaded:', {
    host: VPS_CONFIG.host,
    port: VPS_CONFIG.port,
    username: VPS_CONFIG.username,
    password: VPS_CONFIG.password ? '***SET***' : '***EMPTY***'
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Config endpoint for frontend
app.get('/config', (req, res) => {
    res.json({
        host: VPS_CONFIG.host,
        port: VPS_CONFIG.port,
        username: VPS_CONFIG.username,
        password: VPS_CONFIG.password
    });
});

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Store active SSH connections
const sshConnections = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    let sshClient = null;
    let sshStream = null;

    // Handle SSH connection request
    socket.on('ssh-connect', (config) => {
        console.log('SSH connection request for:', config.host);
        
        sshClient = new Client();
        
        sshClient.on('ready', () => {
            console.log('SSH connection established');
            socket.emit('ssh-ready');
            
            sshClient.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
                if (err) {
                    socket.emit('ssh-error', err.message);
                    return;
                }
                
                sshStream = stream;
                sshConnections.set(socket.id, { client: sshClient, stream: sshStream });
                
                stream.on('data', (data) => {
                    socket.emit('ssh-data', data.toString('utf8'));
                });
                
                stream.on('close', () => {
                    socket.emit('ssh-close');
                    sshClient.end();
                });
                
                stream.stderr.on('data', (data) => {
                    socket.emit('ssh-data', data.toString('utf8'));
                });
            });
        });
        
        sshClient.on('error', (err) => {
            console.error('SSH error:', err.message);
            socket.emit('ssh-error', err.message);
        });
        
        sshClient.on('close', () => {
            socket.emit('ssh-close');
        });

        sshClient.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            console.log('Keyboard interactive auth requested');
            finish([config.password]);
        });
        
        // Connect with password authentication
        console.log('Attempting SSH connection to', config.host, 'port', config.port || 22);
        sshClient.connect({
            host: config.host,
            port: config.port || 22,
            username: config.username,
            password: config.password,
            readyTimeout: 120000,
            keepaliveInterval: 15000,
            keepaliveCountMax: 10,
            tryKeyboard: true,
            sock: undefined,
            algorithms: {
                kex: [
                    'curve25519-sha256',
                    'curve25519-sha256@libssh.org',
                    'ecdh-sha2-nistp256',
                    'ecdh-sha2-nistp384',
                    'ecdh-sha2-nistp521',
                    'diffie-hellman-group-exchange-sha256',
                    'diffie-hellman-group14-sha256',
                    'diffie-hellman-group14-sha1',
                    'diffie-hellman-group1-sha1'
                ],
                cipher: [
                    'aes128-ctr',
                    'aes192-ctr',
                    'aes256-ctr',
                    'aes128-gcm',
                    'aes128-gcm@openssh.com',
                    'aes256-gcm',
                    'aes256-gcm@openssh.com',
                    'aes256-cbc',
                    'aes192-cbc',
                    'aes128-cbc'
                ],
                serverHostKey: [
                    'ssh-rsa',
                    'ssh-ed25519',
                    'ecdsa-sha2-nistp256',
                    'ecdsa-sha2-nistp384',
                    'ecdsa-sha2-nistp521',
                    'rsa-sha2-512',
                    'rsa-sha2-256'
                ],
                hmac: [
                    'hmac-sha2-256',
                    'hmac-sha2-512',
                    'hmac-sha1'
                ]
            },
            debug: (msg) => {
                console.log('SSH Debug:', msg);
            }
        });
    });
    
    // Handle terminal input
    socket.on('ssh-input', (data) => {
        if (sshStream) {
            sshStream.write(data);
        }
    });
    
    // Handle terminal resize
    socket.on('ssh-resize', (size) => {
        if (sshStream) {
            sshStream.setWindow(size.rows, size.cols, size.height, size.width);
        }
    });
    
    // Handle file upload via SFTP
    socket.on('sftp-upload', (data) => {
        if (!sshClient) {
            socket.emit('sftp-error', 'No SSH connection');
            return;
        }
        
        sshClient.sftp((err, sftp) => {
            if (err) {
                socket.emit('sftp-error', err.message);
                return;
            }
            
            const localPath = path.join(__dirname, 'uploads', data.filename);
            const remotePath = data.remotePath;
            
            if (!fs.existsSync(localPath)) {
                socket.emit('sftp-error', 'Local file not found');
                return;
            }
            
            sftp.fastPut(localPath, remotePath, {}, (err) => {
                if (err) {
                    socket.emit('sftp-error', err.message);
                } else {
                    socket.emit('sftp-success', `File uploaded to ${remotePath}`);
                    // Clean up local file after upload
                    fs.unlinkSync(localPath);
                }
            });
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (sshClient) {
            sshClient.end();
        }
        sshConnections.delete(socket.id);
    });
    
    // Handle manual disconnect
    socket.on('ssh-disconnect', () => {
        if (sshClient) {
            sshClient.end();
        }
    });
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ 
        success: true, 
        filename: req.file.originalname,
        message: 'File uploaded to server. Use SFTP to transfer to VPS.'
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                  Web SSH Terminal Server                    ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                  ║
║                                                            ║
║  Access from other devices on your network:                ║
║  http://<your-ip>:${PORT}                                     ║
║                                                            ║
║  To find your IP, run: ipconfig (Windows)                  ║
╚════════════════════════════════════════════════════════════╝
    `);
});
