#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting FANO-LABS backend server...');

// Start the backend server
const backendProcess = spawn('npx', ['tsx', 'watch', 'backend/server.ts'], {
  stdio: 'inherit',
  shell: true,
  cwd: path.join(__dirname, '..')
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down backend server...');
  backendProcess.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down backend server...');
  backendProcess.kill('SIGTERM');
  process.exit(0);
});

backendProcess.on('close', (code) => {
  console.log(`Backend server exited with code ${code}`);
  process.exit(code);
}); 