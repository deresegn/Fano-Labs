# 🚀 FANO-LABS

**AI-Powered Code Editor with Desktop App Support**

FANO-LABS is a local, AI-powered code editor that runs completely offline using Ollama and can be packaged as a desktop application using Tauri.

## ✨ Features

### 🎯 Core Features
- **AI Code Generation** - Generate code using local LLMs (CodeLlama, Phind)
- **Model Selection** - Choose from multiple AI models
- **Real-time Chat** - Sidebar chat panel for AI assistance
- **Inline Suggestions** - Copilot-like code completions
- **Code Refactoring** - AI-powered code cleaning and optimization
- **Multi-language Support** - JavaScript, TypeScript, Python, Java, C++, C#, Go, Rust

### 🖥️ Desktop App Features
- **Cross-platform** - Windows, macOS, Linux
- **Native Performance** - Built with Tauri (Rust + Web Technologies)
- **Offline First** - Works without internet connection
- **Modern UI** - VS Code-like interface with dark/light themes

## 🚀 Quick Start

### Prerequisites
1. **Node.js & npm** - [Download here](https://nodejs.org/)
2. **Rust & Cargo** - [Install here](https://rustup.rs/)
3. **Ollama** - [Install here](https://ollama.ai/)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd FANO-LABS

# Install dependencies
npm install

# Start Ollama with CodeLlama
ollama run codellama:7b-code

# Start the application
npm run dev
```

### Desktop App

```bash
# Development mode (with backend)
npm run tauri:dev

# Build for production
npm run tauri:build

# Preview (frontend only)
npm run tauri:preview
```

## 🛠️ Development

### Project Structure
```
FANO-LABS/
├── frontend/           # React frontend
│   ├── src/
│   ├── public/
│   └── index.html
├── backend/            # Express backend
│   ├── server.ts
│   └── routes/
├── src-tauri/          # Tauri Rust backend
│   ├── src/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── shared/             # Shared TypeScript types
├── scripts/            # Utility scripts
└── package.json
```

### Available Scripts

```bash
# Development
npm run dev              # Start both frontend and backend
npm run dev:frontend     # Start frontend only
npm run dev:backend      # Start backend only

# Desktop App
npm run tauri:dev        # Start Tauri with backend
npm run tauri:preview    # Preview Tauri app
npm run tauri:build      # Build desktop app

# Build
npm run build            # Build frontend
npm run build:frontend   # Build frontend only
```

## 🎨 UI Features

### Editor Controls
- **Language Selection** - Choose programming language
- **Theme Toggle** - Switch between dark and light themes
- **Model Selection** - Select AI model for code generation
- **Inline Suggestions** - Toggle AI code completions (🤖 button)

### Chat Panel
- **Toggle Button** - Click 💬 to open/close chat
- **Real-time Messaging** - Chat with AI about your code
- **Code Highlighting** - Syntax-highlighted code in chat
- **Keyboard Shortcuts** - Enter to send, Shift+Enter for new line

### Keyboard Shortcuts
- `Ctrl/Cmd + Enter` - Generate code from prompt
- `Ctrl/Cmd + Tab` - Accept inline suggestion
- `Enter` - Send chat message
- `Shift + Enter` - New line in chat

## 🔧 Configuration

### Backend Settings
- **Port**: 3001 (configurable in `backend/server.ts`)
- **Ollama URL**: http://localhost:11434
- **Default Model**: codellama:7b-code

### Available Models
- **CodeLlama 7B** - Fast and efficient
- **Phind CodeLlama 34B** - High-quality with better reasoning
- **CodeLlama 13B** - Balanced performance and quality

### Tauri Settings
- **Window Size**: 1280x800
- **Resizable**: Yes
- **Security**: Allows local connections
- **Icons**: Placeholder icons (replace before production)

## 🚀 Building for Production

### Desktop App
```bash
# Build the desktop application
npm run tauri:build

# The built app will be in:
# - macOS: src-tauri/target/release/bundle/macos/
# - Windows: src-tauri/target/release/bundle/msi/
# - Linux: src-tauri/target/release/bundle/appimage/
```

### Web App
```bash
# Build for web deployment
npm run build

# The built files will be in frontend/dist/
```

## 🔍 Troubleshooting

### Backend Issues
```bash
# Check if backend is running
curl http://localhost:3001/health

# Check if Ollama is running
curl http://localhost:11434/api/tags
```

### Build Issues
```bash
# Verify Rust installation
cargo --version

# Clean and rebuild
npm run build
npm run tauri:build
```

### Desktop App Issues
- Ensure Rust is installed: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Restart terminal after Rust installation
- Check Tauri requirements: https://tauri.app/v1/guides/getting-started/prerequisites

## 🎯 Roadmap

### Completed ✅
- [x] Backend with Express and CORS
- [x] Frontend with React and Monaco Editor
- [x] AI integration with Ollama
- [x] Model selection dropdown
- [x] Sidebar chat panel
- [x] Inline code suggestions
- [x] Code refactoring endpoint
- [x] Tauri desktop app setup
- [x] Cross-platform build support

### Planned 🔄
- [ ] Replace placeholder icons with proper branding
- [ ] Add app menu and system tray integration
- [ ] Implement auto-updates
- [ ] Add installer packaging
- [ ] Code signing for distribution
- [ ] VS Code extension support
- [ ] Git integration
- [ ] File explorer panel

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

- **Issues**: Create an issue on GitHub
- **Discussions**: Use GitHub Discussions
- **Documentation**: Check the docs folder

---

**Built with ❤️ using React, TypeScript, Express, Ollama, and Tauri**
