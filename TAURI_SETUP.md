# 🚀 FANO-LABS Tauri Desktop Setup

## Prerequisites

1. **Rust & Cargo** - Install from https://rustup.rs/
2. **Node.js & npm** - Already installed
3. **Tauri CLI** - Already installed via npm

## Quick Start

### Development Mode
```bash
# Start both backend and frontend with Tauri
npm run tauri:dev
```

### Build for Production
```bash
# Build the desktop app
npm run tauri:build
```

### Preview (Frontend Only)
```bash
# Preview without backend (for UI testing)
npm run tauri:preview
```

## Project Structure

```
FANO-LABS/
├── frontend/           # React frontend
├── backend/            # Express backend
├── src-tauri/          # Tauri Rust backend
│   ├── src/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── scripts/            # Utility scripts
└── package.json
```

## Configuration

### Backend Integration
- Backend runs on `http://localhost:3001`
- Frontend connects to backend via API
- Backend starts automatically with `npm run tauri:dev`

### Tauri Settings
- Window size: 1280x800
- Resizable: Yes
- Security: Allows local connections
- Icons: Placeholder icons (replace before production)

## Building

### Development
```bash
npm run tauri:dev
```

### Production
```bash
npm run tauri:build
```

The built app will be in `src-tauri/target/release/`

## Troubleshooting

### Backend Issues
- Ensure Ollama is running: `ollama run codellama:7b-code`
- Check backend health: `curl http://localhost:3001/health`

### Build Issues
- Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Restart terminal after Rust installation
- Run `cargo --version` to verify

### Icon Issues
- Replace placeholder icons in `src-tauri/icons/`
- Use proper PNG/ICO/ICNS formats
- Recommended sizes: 32x32, 128x128, 256x256

## Next Steps

1. Replace placeholder icons with proper FANO-LABS branding
2. Add app menu and system tray integration
3. Implement auto-updates
4. Add installer packaging
5. Code signing for distribution 