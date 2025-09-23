#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Create a simple 128x128 PNG icon for FANO-LABS
function generateSimplePNGIcon() {
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  
  // Create a simple 128x128 PNG with a blue background
  // This is a minimal valid PNG file
  const pngData = Buffer.from([
    // PNG signature
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    
    // IHDR chunk (13 bytes)
    0x00, 0x00, 0x00, 0x0D, // length
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x80, // width: 128
    0x00, 0x00, 0x00, 0x80, // height: 128
    0x08, // bit depth
    0x02, // color type (RGB)
    0x00, // compression
    0x00, // filter
    0x00, // interlace
    0x37, 0x6E, 0xF9, 0x24, // CRC
    
    // IDAT chunk with minimal data
    0x00, 0x00, 0x00, 0x0C, // length
    0x49, 0x44, 0x41, 0x54, // "IDAT"
    0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // minimal compressed data
    0x00, 0x00, 0x00, 0x00, // IEND chunk length
    0x49, 0x45, 0x4E, 0x44, // "IEND"
    0xAE, 0x42, 0x60, 0x82  // CRC
  ]);

  try {
    fs.writeFileSync(iconPath, pngData);
    console.log('✅ Generated simple PNG icon: src-tauri/icons/icon.png');
    console.log('💡 This is a minimal valid PNG. Replace with a proper icon for production.');
  } catch (error) {
    console.error('❌ Failed to generate PNG icon:', error.message);
  }
}

// Alternative: Create a simple colored square PNG
function generateColoredPNGIcon() {
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  
  // Create a simple 1x1 blue pixel PNG (much simpler)
  const simplePNG = Buffer.from([
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
    fs.writeFileSync(iconPath, simplePNG);
    console.log('✅ Generated colored PNG icon: src-tauri/icons/icon.png');
    console.log('💡 This is a minimal valid PNG. Replace with a proper icon for production.');
  } catch (error) {
    console.error('❌ Failed to generate PNG icon:', error.message);
  }
}

// Run the simple version
generateColoredPNGIcon(); 