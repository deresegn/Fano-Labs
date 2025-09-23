#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Download a simple PNG icon
function downloadPNGIcon() {
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  
  // Create a simple 1x1 blue pixel PNG (base64 encoded)
  const base64PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  
  try {
    const pngData = Buffer.from(base64PNG, 'base64');
    fs.writeFileSync(iconPath, pngData);
    console.log('✅ Downloaded PNG icon: src-tauri/icons/icon.png');
    console.log('💡 This is a valid 1x1 blue PNG. Replace with a proper icon for production.');
  } catch (error) {
    console.error('❌ Failed to download PNG icon:', error.message);
  }
}

// Alternative: Create a simple PNG using a different approach
function createSimplePNG() {
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  
  // This is a valid 1x1 blue pixel PNG
  const pngData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, // bit depth
    0x06, // color type (RGBA)
    0x00, // compression
    0x00, // filter
    0x00, // interlace
    0x37, 0x6E, 0xF9, 0x24, // CRC
    0x00, 0x00, 0x00, 0x0C, // IDAT chunk length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data
    0x00, 0x00, 0x00, 0x00, // IEND chunk length
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82  // CRC
  ]);

  try {
    fs.writeFileSync(iconPath, pngData);
    console.log('✅ Created simple PNG icon: src-tauri/icons/icon.png');
    console.log('💡 This is a valid 1x1 PNG. Replace with a proper icon for production.');
  } catch (error) {
    console.error('❌ Failed to create PNG icon:', error.message);
  }
}

// Try the base64 approach first
downloadPNGIcon(); 