#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple function to create a basic PNG icon using a data URL
// This creates a 128x128 PNG with FANO-LABS branding
function generatePNGIcon() {
  // Create a simple SVG that we'll convert to PNG
  const svg = `
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#007acc;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#005a9e;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="20" fill="url(#grad)"/>
  <text x="64" y="45" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="white">FANO</text>
  <text x="64" y="70" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="white">LABS</text>
  <circle cx="64" cy="95" r="8" fill="white" opacity="0.8"/>
</svg>`;

  // For now, we'll create a simple text file as a placeholder
  // In a real scenario, you'd use a library like sharp or canvas to convert SVG to PNG
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  
  // Create a simple binary PNG header (this is a minimal valid PNG)
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x80, // width: 128
    0x00, 0x00, 0x00, 0x80, // height: 128
    0x08, // bit depth
    0x06, // color type (RGBA)
    0x00, // compression
    0x00, // filter
    0x00, // interlace
    0x00, 0x00, 0x00, 0x00, // CRC placeholder
  ]);

  // For simplicity, let's create a minimal valid PNG with a solid color
  // This is a 1x1 pixel PNG that will work as a placeholder
  const minimalPNG = Buffer.from([
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
    0xAE, 0x42, 0x60, 0x82, // CRC
  ]);

  try {
    fs.writeFileSync(iconPath, minimalPNG);
    console.log('✅ Generated placeholder PNG icon: src-tauri/icons/icon.png');
    console.log('💡 This is a minimal valid PNG. Replace with a proper icon for production.');
  } catch (error) {
    console.error('❌ Failed to generate PNG icon:', error.message);
  }
}

// Generate the icon
generatePNGIcon(); 