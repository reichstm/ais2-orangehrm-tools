# 🧩 ais2 – OrangeHRM Extension Service

This project extends **OrangeHRM** with additional API and UI functionalities (timesheet, leave calendar, attendance comparison) using **Node.js** and **MySQL**.  
It runs alongside your OrangeHRM instance on the same VM, proxied through **Apache2** under `/ais2`.

---

## 📦 1. Prerequisites

Make sure your environment includes:

- Ubuntu or Debian-based system
- Node.js ≥ 18
- MySQL (same database used by OrangeHRM)
- Apache2 with SSL enabled
- PM2 for process management

---

## ⚙️ 2. Clone and Install

```bash
cd /var/www
sudo git clone https://github.com/reichstm/ais2-orangehrm-tools.git ais2-orangehrm-tools
cd ais2-orangehrm-tools
npm install
```

---

## 🧾 3. Create `.env` file

Create a `.env` file in the project root:

```bash
nano .env
```

Paste the following and update values as needed:

```ini
# Server
PORT=3000
BASE_PATH=/ais2

# Database connection
DB_HOST=localhost
DB_USER=XYZ
DB_PASSWORD=XYZ
DB_NAME=XYZ

# Session secret
SESSION_SECRET=your_random_secret_string
```

> 💡 Note: Make sure the database credentials have **SELECT** access to the OrangeHRM schema.

---

## 🌐 4. Apache2 Reverse Proxy Configuration

Create or modify your Apache site config (e.g. `/etc/apache2/sites-available/orangehrm.conf`):

```apache
<VirtualHost *:443>
    ServerName your-domain.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/your-domain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem

    # OrangeHRM root app
    DocumentRoot /var/www/orangehrm/web
    <Directory /var/www/orangehrm/web>
        AllowOverride All
        Require all granted
    </Directory>

    # Proxy for Node.js app
    ProxyRequests Off
    ProxyPreserveHost On
    ProxyPass /ais2/ http://localhost:3000/
    ProxyPassReverse /ais2/ http://localhost:3000/
 
    # Optional: avoid trailing slash issues
    <Location /ais2/>
        Require all granted
    </Location>

    ErrorLog ${APACHE_LOG_DIR}/orangehrm_error.log
    CustomLog ${APACHE_LOG_DIR}/orangehrm_access.log combined
</VirtualHost>
```

Then enable modules and reload:

```bash
sudo a2enmod proxy proxy_http ssl headers
sudo systemctl reload apache2
```

✅ Your Node app will now be accessible via  
**`https://your-domain.com/ais2/`**

---

## 🔐 5. Enable HTTPS with Certbot

If your VM does not yet have SSL certificates, use **Certbot**:

```bash
sudo apt update
sudo apt install certbot python3-certbot-apache -y
sudo certbot --apache -d your-domain.com
```

To renew automatically:

```bash
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

---

## 🚀 6. Run the Node.js App with PM2

```bash
pm2 start index.js --name ais2-orangehrm-tools
pm2 save
pm2 startup
```

Check logs:

```bash
pm2 logs ais2-orangehrm-tools
```

---

## 🔐 7. Authentication

Currently, the app uses **OrangeHRM credentials** for authentication.  
Users log in with their OrangeHRM username and password.

---

## 📊 8. Features

| Feature                    | Description                                                                   |
|----------------------------|-------------------------------------------------------------------------------|
| **Show Timesheet**         | Query timesheets for a user with optional date filters and total hours.       |
| **Leave Calendar**         | Displays all upcoming leaves of all employees using FullCalendar.             |
| **Attendance Differences** | Compares attended vs booked hours and shows differences.                      |
| **CSV Export**             | Available for timesheets.                                                     |
| **ICS Calendar**           | Endpoint for integration of absences tracked in OrangeHRM for MS Outlook etc. |

---

## 🎨 9. UI Libraries

The app uses:
- **FullCalendar v6.1.19** for the leave calendar
- Minimal HTML + inline CSS for fast loading
- Apache2 reverse proxy for routing

---

## 🔍 10. Troubleshooting

| Issue | Fix |
|-------|-----|
| `Cannot GET /ais2` | Check Apache `ProxyPass` settings and trailing slashes. |
| `.env` not loaded | Ensure `require('dotenv').config()` is at the top of `index.js`. |
| `Access denied for user ''@'localhost'` | Verify `.env` DB_USER / DB_PASSWORD. |
| `FullCalendar is not defined` | Ensure correct CDN links (`index.global.min.js`, `main.min.css`). |
| `pm2 status: errored` | Check logs via `pm2 logs ais2`. |

---

## 📁 Directory Structure

```
ais2/
├── index.js
├── package.json
├── .env
├── README.md
└── node_modules/
```

---

## 💡 Example Environment Integration

| Component | Path | Purpose |
|------------|------|----------|
| OrangeHRM | `/` | Main HR portal |
| Node.js App | `/ais2` | Extension API and UI |
| MySQL | `orangehrm` | Shared database schema |
| Apache2 | Reverse proxy | Routes both apps under same domain |

---

## 🧹 11. Maintenance

To restart or update:

```bash
cd /var/www/ais2-orangehrm-tools
git pull
npm install
pm2 restart ais2-orangehrm-tools
```

---

## ✅ Done!

Your ais2 is now running at:

👉 **https://your-domain.com/ais2/**  
and connected to your existing OrangeHRM instance.
