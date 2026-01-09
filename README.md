# Web SSH Terminal 🖥️

A web-based SSH terminal that lets you connect to your VPS from any browser, including mobile devices.

## Features

- ✅ **Web-based SSH Terminal** - Full terminal access through your browser
- ✅ **Password Authentication** - Secure login with username/password
- ✅ **File Upload** - Upload files from your device to your VPS via SFTP
- ✅ **Mobile Friendly** - Responsive design with special keyboard for mobile
- ✅ **Quick Commands** - One-click common commands
- ✅ **Save Connections** - Remember your server details (passwords not saved)
- ✅ **256 Color Support** - Beautiful terminal with full color support

## Quick Start

### 1. Install Dependencies

```bash
cd VPS
npm install
```

### 2. Start the Server

```bash
npm start
```

### 3. Open in Browser

Go to `http://localhost:3000`

## Usage

1. **Enter your VPS details:**
   - Host: Your DigitalOcean droplet IP address
   - Port: 22 (default SSH port)
   - Username: root (or your user)
   - Password: Your SSH password

2. **Click Connect** - You'll have full shell access!

3. **Upload Files:**
   - Drag & drop or click to select a file
   - Enter the remote path where you want to save it
   - Click "Upload to VPS"

## Access from Your Phone

### Option 1: Same Network (Local)
If your phone is on the same WiFi as your computer:

1. Find your computer's IP address:
   ```bash
   ipconfig  # Windows
   ```
2. Open `http://<your-computer-ip>:3000` on your phone

### Option 2: Access from Anywhere (Deploy to Cloud)

Deploy this app to a cloud service to access from anywhere:

#### Deploy to your DigitalOcean Droplet:

```bash
# On your VPS
git clone <your-repo> or upload files
cd VPS
npm install
npm install pm2 -g
pm2 start server.js --name webssh
```

Then access at `http://<your-droplet-ip>:3000`

#### Using ngrok (Quick temporary access):

```bash
# Install ngrok and run
npx ngrok http 3000
```

## Security Recommendations

⚠️ **Important:** This app transmits passwords, so for production use:

1. **Use HTTPS** - Set up SSL certificate
2. **Add Authentication** - Add a login page to the web interface
3. **Use SSH Keys** - More secure than passwords
4. **Firewall** - Only allow trusted IPs

### Adding Basic HTTPS (Self-signed for testing)

```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

Then modify `server.js` to use HTTPS.

## Project Structure

```
VPS/
├── server.js          # Node.js server with SSH handling
├── package.json       # Dependencies
├── public/
│   ├── index.html     # Web interface
│   ├── styles.css     # Styling
│   └── app.js         # Client-side JavaScript
└── uploads/           # Temporary file storage (auto-created)
```

## Troubleshooting

### "Connection refused"
- Check if your VPS IP is correct
- Verify SSH is running on port 22
- Check firewall allows incoming connections

### "Authentication failed"
- Verify username and password
- Check if password authentication is enabled in SSH config

### Terminal not responding
- Try refreshing the page
- Click disconnect and reconnect

## Tech Stack

- **Backend:** Node.js, Express, Socket.IO, ssh2
- **Frontend:** xterm.js, Socket.IO Client
- **File Transfer:** SFTP via ssh2

## License

MIT License - Use freely!
