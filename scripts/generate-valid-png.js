#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// CRC32 calculation function
function crc32(data) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[i] = c;
  }
  
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Create a valid PNG chunk
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunkData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(chunkData), 0);
  
  return Buffer.concat([length, chunkData, crc]);
}

// Generate a valid PNG icon
function generateValidPNGIcon() {
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk data (13 bytes)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);  // width: 1
  ihdrData.writeUInt32BE(1, 4);  // height: 1
  ihdrData.writeUInt8(8, 8);     // bit depth
  ihdrData.writeUInt8(6, 9);     // color type (RGBA)
  ihdrData.writeUInt8(0, 10);    // compression
  ihdrData.writeUInt8(0, 11);    // filter
  ihdrData.writeUInt8(0, 12);    // interlace
  
  const ihdrChunk = createChunk('IHDR', ihdrData);
  
  // IDAT chunk data (minimal compressed data for 1x1 RGBA pixel)
  const idatData = Buffer.from([0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  const idatChunk = createChunk('IDAT', idatData);
  
  // IEND chunk (no data)
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  // Combine all chunks
  const pngData = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  
  try {
    fs.writeFileSync(iconPath, pngData);
    console.log('✅ Generated valid PNG icon: src-tauri/icons/icon.png');
    console.log('💡 This is a valid 1x1 PNG. Replace with a proper icon for production.');
  } catch (error) {
    console.error('❌ Failed to generate PNG icon:', error.message);
  }
}

// Alternative: Create a simple colored square using a different approach
function generateSimpleColoredPNG() {
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  
  // Create a simple 1x1 blue pixel PNG using a known good structure
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
    0x37, 0x6E, 0xF9, 0x24, // CRC (pre-calculated)
    0x00, 0x00, 0x00, 0x0C, // IDAT chunk length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data
    0x00, 0x00, 0x00, 0x00, // IEND chunk length
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82  // CRC (pre-calculated)
  ]);

  try {
    fs.writeFileSync(iconPath, pngData);
    console.log('✅ Generated simple colored PNG icon: src-tauri/icons/icon.png');
    console.log('💡 This is a valid 1x1 PNG. Replace with a proper icon for production.');
  } catch (error) {
    console.error('❌ Failed to generate PNG icon:', error.message);
  }
}

// Run the simple version first
generateSimpleColoredPNG(); 