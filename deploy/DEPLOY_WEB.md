# FANO-LABS Web Deploy (Frontend + Backend)

## 1) Server prerequisites
- Ubuntu 22.04+ (or similar)
- Node.js 20+
- Nginx
- PM2 (`npm i -g pm2`)
- Domain DNS configured:
  - `app.fanolabs.dev` -> server IP
  - `api.fanolabs.dev` -> server IP

## 2) Clone and install
```bash
git clone <your-repo-url> /var/www/fano-labs/current
cd /var/www/fano-labs/current
npm install
cd backend && npm install && cd ..
```

## 3) Backend env
```bash
cp backend/.env.production.example backend/.env
nano backend/.env
```
Set at least:
- `CORS_ORIGINS=https://app.fanolabs.dev`
- `OPENAI_API_KEY=...` (and optional Anthropic/Gemini)

## 4) Frontend env
```bash
cp frontend/.env.web.production.example frontend/.env.production
nano frontend/.env.production
```
Set:
- `VITE_BACKEND_URL=https://api.fanolabs.dev`

## 5) Build
```bash
npm run build:frontend
npm run build:backend
```

## 6) Run backend with PM2
```bash
sudo mkdir -p /var/log/fano-labs
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

## 7) Nginx config
```bash
sudo cp deploy/nginx.fano-labs.conf /etc/nginx/sites-available/fano-labs
sudo ln -s /etc/nginx/sites-available/fano-labs /etc/nginx/sites-enabled/fano-labs
sudo nginx -t
sudo systemctl reload nginx
```

## 8) TLS (Let's Encrypt)
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.fanolabs.dev -d api.fanolabs.dev
```

## 9) Verify
```bash
curl https://api.fanolabs.dev/health
curl https://api.fanolabs.dev/providers/status
```

## 10) Update workflow
```bash
cd /var/www/fano-labs/current
git pull
npm install
cd backend && npm install && cd ..
npm run build:frontend
npm run build:backend
pm2 restart fano-labs-backend
sudo systemctl reload nginx
```
