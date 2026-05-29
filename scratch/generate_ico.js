const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '..', 'public', 'icon-192.png');
const icoPath = path.join(__dirname, '..', 'public', 'favicon.ico');

if (!fs.existsSync(pngPath)) {
  console.error('icon-192.png not found!');
  process.exit(1);
}

const pngBuffer = fs.readFileSync(pngPath);
const pngSize = pngBuffer.length;

// Create 22-byte header
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // Reserved
header.writeUInt16LE(1, 2); // Type (1 = ICO)
header.writeUInt16LE(1, 4); // Number of images (1)

// Directory entry
header.writeUInt8(192, 6); // Width
header.writeUInt8(192, 7); // Height
header.writeUInt8(0, 8); // Color palette
header.writeUInt8(0, 9); // Reserved
header.writeUInt16LE(1, 10); // Color planes
header.writeUInt16LE(32, 12); // Bits per pixel (32)
header.writeUInt32LE(pngSize, 14); // Size of PNG data
header.writeUInt32LE(22, 18); // Offset to PNG data (header size)

// Combine header and PNG buffer
const icoBuffer = Buffer.concat([header, pngBuffer]);

fs.writeFileSync(icoPath, icoBuffer);
console.log('Successfully generated public/favicon.ico from public/icon-192.png!');
