#!/bin/bash

# FANO-LABS Desktop App Launcher
# This script starts the backend server and then launches the desktop app

echo "🚀 Starting FANO-LABS..."

# Navigate to project directory
cd "$(dirname "$0")/.."

# Check if Ollama is running
if ! pgrep -x "ollama" > /dev/null; then
    echo "⚠️  Ollama is not running. Starting Ollama with CodeLlama..."
    ollama run codellama:7b-code &
    sleep 5
fi

# Start backend server in background
echo "🔧 Starting backend server..."
npm run dev:backend &
BACKEND_PID=$!

# Wait for backend to start
echo "⏳ Waiting for backend to start..."
sleep 3

# Check if backend is running
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ Backend is running!"
    
    # Launch the desktop app
    echo "🖥️  Launching FANO-LABS desktop app..."
    open src-tauri/target/release/bundle/macos/FANO-LABS.app
    
    echo "🎉 FANO-LABS is now running!"
    echo "💡 Keep this terminal open to keep the backend running."
    echo "🛑 Press Ctrl+C to stop everything."
    
    # Wait for user to stop
    wait $BACKEND_PID
else
    echo "❌ Backend failed to start. Please check the logs above."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi 