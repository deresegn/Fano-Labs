#!/bin/bash

# FANO-LABS Complete Startup Script
# This script starts all required services and provides clear feedback

echo "🚀 Starting FANO-LABS Complete Setup..."
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Navigate to project directory
cd "$(dirname "$0")/.." || {
    print_error "Failed to navigate to project directory"
    exit 1
}

print_status "Project directory: $(pwd)"

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    print_error "Ollama is not installed. Please install it first:"
    echo "   Visit: https://ollama.ai/download"
    exit 1
fi

# Check if Ollama is running
if ! pgrep -x "ollama" > /dev/null; then
    print_warning "Ollama is not running. Starting Ollama..."
    ollama serve &
    sleep 3
fi

# Check if CodeLlama model is available
if ! ollama list | grep -q "codellama:7b-code"; then
    print_warning "CodeLlama model not found. Downloading..."
    ollama pull codellama:7b-code
fi

# Start Ollama with CodeLlama
print_status "Starting Ollama with CodeLlama model..."
ollama run codellama:7b-code &
OLLAMA_PID=$!
sleep 5

# Check if Ollama is responding
if curl -s http://localhost:11434/api/tags > /dev/null; then
    print_success "Ollama is running and responding"
else
    print_error "Ollama failed to start properly"
    exit 1
fi

# Start backend server
print_status "Starting backend server..."
npm run dev:backend &
BACKEND_PID=$!

# Wait for backend to start
print_status "Waiting for backend to start..."
sleep 5

# Check if backend is running
if curl -s http://localhost:3001/health > /dev/null; then
    print_success "Backend server is running on http://localhost:3001"
else
    print_error "Backend server failed to start"
    print_status "Checking for port conflicts..."
    lsof -i :3001
    exit 1
fi

# Launch the desktop app
print_status "Launching FANO-LABS desktop app..."
if [ -f "src-tauri/target/release/bundle/macos/FANO-LABS.app" ]; then
    open src-tauri/target/release/bundle/macos/FANO-LABS.app
    print_success "Desktop app launched!"
else
    print_warning "Desktop app not found. Building it first..."
    npm run tauri:build
    if [ -f "src-tauri/target/release/bundle/macos/FANO-LABS.app" ]; then
        open src-tauri/target/release/bundle/macos/FANO-LABS.app
        print_success "Desktop app built and launched!"
    else
        print_error "Failed to build desktop app"
        exit 1
    fi
fi

echo ""
echo "🎉 FANO-LABS is now running!"
echo "=============================="
echo "📱 Desktop App: FANO-LABS.app"
echo "🔧 Backend: http://localhost:3001"
echo "🤖 Ollama: http://localhost:11434"
echo ""
echo "💡 Keep this terminal open to keep services running"
echo "🛑 Press Ctrl+C to stop everything"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    print_status "Shutting down FANO-LABS..."
    kill $BACKEND_PID 2>/dev/null
    kill $OLLAMA_PID 2>/dev/null
    print_success "All services stopped"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Keep the script running
wait 