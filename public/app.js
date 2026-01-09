// ============================================
// Termux SSH Client - Mobile First
// ============================================

const socket = io();

// VPS credentials loaded from server config
let VPS_CONFIG = null;

// State
let terminal = null;
let fitAddon = null;
let isConnected = false;
let currentConfig = null;
let currentFilename = null;

// Fetch config from server
async function loadConfig() {
    try {
        const res = await fetch('/config');
        VPS_CONFIG = await res.json();
    } catch (err) {
        console.error('Failed to load config:', err);
        VPS_CONFIG = { host: '', port: 22, username: 'root', password: '' };
    }
}

// DOM Elements
const $ = (id) => document.getElementById(id);

const dom = {
    // App
    termuxApp: $('termuxApp'),
    sessionName: $('sessionName'),
    connIndicator: $('connIndicator'),
    statusText: $('statusText'),
    disconnectBtn: $('disconnectBtn'),
    menuBtn: $('menuBtn'),
    
    // Drawer
    drawer: $('drawer'),
    drawerOverlay: $('drawerOverlay'),
    drawerClose: $('drawerClose'),
    reconnectBtn: $('reconnectBtn'),
    newSessionBtn: $('newSessionBtn'),
    killSessionBtn: $('killSessionBtn'),
    
    // Upload
    uploadZone: $('uploadZone'),
    fileInput: $('fileInput'),
    uploadProgress: $('uploadProgress'),
    progressFill: $('progressFill'),
    progressText: $('progressText'),
    remotePathSection: $('remotePathSection'),
    remotePath: $('remotePath'),
    sftpUploadBtn: $('sftpUploadBtn'),
    
    // Toast
    toast: $('toast')
};

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'info') {
    dom.toast.textContent = message;
    dom.toast.className = 'termux-toast ' + type + ' show';
    
    setTimeout(() => {
        dom.toast.classList.remove('show');
    }, 3000);
}

// ============================================
// Terminal Setup
// ============================================
function initTerminal() {
    terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: window.innerWidth <= 480 ? 12 : 14,
        fontFamily: '"Fira Code", "SF Mono", "Roboto Mono", Consolas, monospace',
        lineHeight: 1.15,
        letterSpacing: 0,
        theme: {
            background: '#000000',
            foreground: '#f8f8f2',
            cursor: '#50fa7b',
            cursorAccent: '#000000',
            selection: 'rgba(80, 250, 123, 0.3)',
            black: '#21222c',
            red: '#ff5555',
            green: '#50fa7b',
            yellow: '#f1fa8c',
            blue: '#8be9fd',
            magenta: '#bd93f9',
            cyan: '#8be9fd',
            white: '#f8f8f2',
            brightBlack: '#6272a4',
            brightRed: '#ff6e6e',
            brightGreen: '#69ff94',
            brightYellow: '#ffffa5',
            brightBlue: '#d6acff',
            brightMagenta: '#ff92df',
            brightCyan: '#a4ffff',
            brightWhite: '#ffffff'
        },
        allowTransparency: true,
        scrollback: 5000,
        convertEol: true,
        scrollOnUserInput: true
    });

    fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open($('terminal'));

    // Initial fit
    setTimeout(() => fitAddon.fit(), 50);

    // Handle terminal input
    terminal.onData((data) => {
        if (isConnected) {
            socket.emit('ssh-input', data);
        }
    });

    // Handle resize
    let resizeTimeout;
    const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (fitAddon) {
                fitAddon.fit();
                if (isConnected) {
                    socket.emit('ssh-resize', {
                        cols: terminal.cols,
                        rows: terminal.rows
                    });
                }
            }
        }, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
        setTimeout(handleResize, 200);
    });

    // Focus terminal on tap
    $('terminal').addEventListener('click', () => terminal.focus());
    $('terminal').addEventListener('touchend', () => {
        setTimeout(() => terminal.focus(), 50);
    });
}

// ============================================
// Connection Management
// ============================================
function updateConnectionStatus(state, text) {
    dom.connIndicator.className = 'connection-indicator ' + state;
    dom.statusText.textContent = text;
}

function connectSSH() {
    currentConfig = VPS_CONFIG;
    
    updateConnectionStatus('connecting', 'Connecting...');

    terminal.clear();
    terminal.writeln('\x1b[38;2;80;250;123m$ ssh ' + VPS_CONFIG.username + '@' + VPS_CONFIG.host + '\x1b[0m');
    terminal.writeln('\x1b[38;2;98;114;164mConnecting to ' + VPS_CONFIG.host + ':' + VPS_CONFIG.port + '...\x1b[0m');
    terminal.writeln('');

    socket.emit('ssh-connect', VPS_CONFIG);
}

function disconnect() {
    socket.emit('ssh-disconnect');
}

function showLoginScreen() {
    // No login screen - just reconnect
    connectSSH();
}

function showTerminalScreen() {
    // Terminal is always visible now, just focus it
    setTimeout(() => {
        fitAddon.fit();
        terminal.focus();
    }, 100);
}

// ============================================
// Drawer Menu
// ============================================
function openDrawer() {
    dom.drawer.classList.add('open');
    dom.drawerOverlay.classList.add('active');
}

function closeDrawer() {
    dom.drawer.classList.remove('open');
    dom.drawerOverlay.classList.remove('active');
}

// ============================================
// File Upload
// ============================================
function handleFileSelect(file) {
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);

    dom.uploadProgress.classList.remove('hidden');
    dom.progressFill.style.width = '0%';
    dom.progressText.textContent = 'Uploading ' + file.name + '...';
    dom.progressText.className = 'progress-text';

    // Simulate progress
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress > 90) progress = 90;
        dom.progressFill.style.width = progress + '%';
    }, 200);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        clearInterval(progressInterval);
        dom.progressFill.style.width = '100%';
        
        if (data.success) {
            currentFilename = data.filename;
            dom.progressText.textContent = '✓ ' + data.filename + ' ready';
            dom.progressText.className = 'progress-text success';
            dom.remotePathSection.classList.remove('hidden');
            dom.remotePath.value = '/root/' + data.filename;
            showToast('File uploaded: ' + data.filename, 'success');
        } else {
            dom.progressText.textContent = '✗ Upload failed';
            dom.progressText.className = 'progress-text error';
            showToast('Upload failed', 'error');
        }
    })
    .catch(err => {
        clearInterval(progressInterval);
        dom.progressText.textContent = '✗ Upload failed';
        dom.progressText.className = 'progress-text error';
        showToast('Upload failed', 'error');
    });
}

function uploadToVPS() {
    if (!isConnected) {
        showToast('Not connected to SSH', 'error');
        return;
    }
    
    if (!currentFilename) {
        showToast('No file selected', 'error');
        return;
    }

    dom.progressText.textContent = 'Transferring to VPS...';
    dom.progressText.className = 'progress-text';

    socket.emit('sftp-upload', {
        filename: currentFilename,
        remotePath: dom.remotePath.value
    });
}

// ============================================
// Keyboard Shortcuts Handler
// ============================================
function setupShortcuts() {
    // Special action buttons
    const pasteBtn = document.getElementById('pasteBtn');
    const copyBtn = document.getElementById('copyBtn');
    const clearBtn = document.getElementById('clearBtn');
    const selectAllBtn = document.getElementById('selectAllBtn');

    // Paste button
    if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text && isConnected) {
                    socket.emit('ssh-input', text);
                    showToast('Pasted!', 'success');
                    vibrate();
                }
            } catch (err) {
                // Fallback for browsers that don't support clipboard API
                showToast('Paste not supported', 'error');
            }
            terminal.focus();
        });
    }

    // Copy button - copies selected text from terminal
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const selection = terminal.getSelection();
            if (selection) {
                try {
                    await navigator.clipboard.writeText(selection);
                    showToast('Copied!', 'success');
                    vibrate();
                } catch (err) {
                    showToast('Copy failed', 'error');
                }
            } else {
                showToast('Select text first', 'info');
            }
            terminal.focus();
        });
    }

    // Clear button
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (isConnected) {
                socket.emit('ssh-input', 'clear\n');
                vibrate();
            }
            terminal.focus();
        });
    }

    // Select All button
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            terminal.selectAll();
            showToast('All selected', 'info');
            vibrate();
        });
    }

    // Regular shortcut buttons
    document.querySelectorAll('.shortcut-btn').forEach(btn => {
        // Skip action buttons we already handled
        if (btn.id) return;
        
        btn.addEventListener('click', () => {
            if (!isConnected) {
                showToast('Not connected', 'error');
                return;
            }

            const key = btn.dataset.key;
            const isCtrl = btn.dataset.ctrl === 'true';
            const insert = btn.dataset.insert;

            if (insert) {
                // Direct character insert
                socket.emit('ssh-input', insert);
            } else if (isCtrl) {
                // Ctrl+key combination
                const charCode = key.toLowerCase().charCodeAt(0) - 96;
                socket.emit('ssh-input', String.fromCharCode(charCode));
            } else {
                // Special keys
                switch(key) {
                    case 'Tab':
                        socket.emit('ssh-input', '\t');
                        break;
                    case 'Escape':
                        socket.emit('ssh-input', '\x1b');
                        break;
                    case 'ArrowUp':
                        socket.emit('ssh-input', '\x1b[A');
                        break;
                    case 'ArrowDown':
                        socket.emit('ssh-input', '\x1b[B');
                        break;
                    case 'ArrowRight':
                        socket.emit('ssh-input', '\x1b[C');
                        break;
                    case 'ArrowLeft':
                        socket.emit('ssh-input', '\x1b[D');
                        break;
                    case 'Home':
                        socket.emit('ssh-input', '\x1b[H');
                        break;
                    case 'End':
                        socket.emit('ssh-input', '\x1b[F');
                        break;
                    case 'PageUp':
                        socket.emit('ssh-input', '\x1b[5~');
                        break;
                    case 'PageDown':
                        socket.emit('ssh-input', '\x1b[6~');
                        break;
                    case 'Backspace':
                        socket.emit('ssh-input', '\x7f');
                        break;
                    case 'Delete':
                        socket.emit('ssh-input', '\x1b[3~');
                        break;
                }
            }

            vibrate();
            terminal.focus();
        });
    });
}

// Haptic feedback helper
function vibrate() {
    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
}

// Quick Commands
function setupQuickCommands() {
    document.querySelectorAll('.quick-cmd').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!isConnected) {
                showToast('Not connected', 'error');
                return;
            }

            const cmd = btn.dataset.cmd;
            socket.emit('ssh-input', cmd + '\n');
            
            if (navigator.vibrate) {
                navigator.vibrate(10);
            }
            
            closeDrawer();
            terminal.focus();
        });
    });
}

// ============================================
// Socket Event Handlers
// ============================================
socket.on('ssh-ready', () => {
    isConnected = true;
    updateConnectionStatus('connected', 'Connected');
    
    dom.sessionName.textContent = currentConfig.username + '@' + currentConfig.host;
    
    showTerminalScreen();
    
    terminal.writeln('\x1b[38;2;80;250;123m✓ Connection established\x1b[0m');
    terminal.writeln('');
    
    // Send initial resize
    setTimeout(() => {
        fitAddon.fit();
        socket.emit('ssh-resize', {
            cols: terminal.cols,
            rows: terminal.rows
        });
    }, 100);
    
    showToast('Connected to ' + currentConfig.host, 'success');
});

socket.on('ssh-data', (data) => {
    terminal.write(data);
});

socket.on('ssh-error', (error) => {
    terminal.writeln('');
    terminal.writeln('\x1b[38;2;255;85;85m✗ Error: ' + error + '\x1b[0m');
    terminal.writeln('\x1b[38;2;98;114;164mRetrying in 3 seconds...\x1b[0m');
    
    updateConnectionStatus('', 'Disconnected');
    isConnected = false;
    
    showToast('Connection error - retrying...', 'error');
    
    // Auto-retry after 3 seconds
    setTimeout(() => {
        connectSSH();
    }, 3000);
});

socket.on('ssh-close', () => {
    terminal.writeln('');
    terminal.writeln('\x1b[38;2;241;250;140m━━━ Connection closed ━━━\x1b[0m');
    
    updateConnectionStatus('', 'Disconnected');
    isConnected = false;
    
    showToast('Connection closed', 'info');
});

socket.on('sftp-success', (message) => {
    dom.progressText.textContent = '✓ ' + message;
    dom.progressText.className = 'progress-text success';
    dom.remotePathSection.classList.add('hidden');
    currentFilename = null;
    
    setTimeout(() => {
        dom.uploadProgress.classList.add('hidden');
    }, 3000);
    
    showToast('File transferred!', 'success');
});

socket.on('sftp-error', (error) => {
    dom.progressText.textContent = '✗ ' + error;
    dom.progressText.className = 'progress-text error';
    showToast('Transfer failed: ' + error, 'error');
});

// ============================================
// Event Listeners Setup
// ============================================
function setupEventListeners() {
    // Drawer
    dom.menuBtn.addEventListener('click', openDrawer);
    dom.drawerOverlay.addEventListener('click', closeDrawer);
    dom.drawerClose.addEventListener('click', closeDrawer);

    // Disconnect
    dom.disconnectBtn.addEventListener('click', () => {
        disconnect();
        closeDrawer();
    });

    // Reconnect
    dom.reconnectBtn.addEventListener('click', () => {
        connectSSH();
        closeDrawer();
    });

    // New session (just reconnect since there's only one)
    dom.newSessionBtn.addEventListener('click', () => {
        disconnect();
        closeDrawer();
        setTimeout(showLoginScreen, 100);
    });

    // Kill session
    dom.killSessionBtn.addEventListener('click', () => {
        disconnect();
        closeDrawer();
        terminal.clear();
        showLoginScreen();
    });

    // File upload
    dom.uploadZone.addEventListener('click', () => {
        dom.fileInput.click();
    });

    dom.fileInput.addEventListener('change', () => {
        if (dom.fileInput.files.length > 0) {
            handleFileSelect(dom.fileInput.files[0]);
        }
    });

    dom.uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.uploadZone.classList.add('dragover');
    });

    dom.uploadZone.addEventListener('dragleave', () => {
        dom.uploadZone.classList.remove('dragover');
    });

    dom.uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    dom.sftpUploadBtn.addEventListener('click', uploadToVPS);

    // Prevent double-tap zoom on iOS
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            e.preventDefault();
        }
        lastTouchEnd = now;
    }, { passive: false });

    // Prevent pinch zoom
    document.addEventListener('gesturestart', (e) => {
        e.preventDefault();
    });

    // Handle visibility change
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && fitAddon) {
            setTimeout(() => fitAddon.fit(), 100);
        }
    });
}

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Load config first
    await loadConfig();
    
    initTerminal();
    setupEventListeners();
    setupShortcuts();
    setupQuickCommands();
    
    // Auto-connect on page load
    setTimeout(() => {
        connectSSH();
    }, 500);
});
