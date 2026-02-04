// Icon Generator Script
// Run: node create-icons.js

const fs = require('fs');
const path = require('path');

// Simple PNG encoder (creates minimal valid PNG)
function createPNG(width, height, rgbaData) {
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(data) {
    let crc = 0xffffffff;
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type);
    const crcData = Buffer.concat([typeBuffer, data]);
    const crcValue = Buffer.alloc(4);
    crcValue.writeUInt32BE(crc32(crcData), 0);
    return Buffer.concat([length, typeBuffer, data, crcValue]);
  }

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT chunk (raw image data with zlib)
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      rawData.push(rgbaData[idx], rgbaData[idx + 1], rgbaData[idx + 2], rgbaData[idx + 3]);
    }
  }

  // Simple zlib compression (store only, no actual compression)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(rawData), { level: 9 });

  // IEND chunk
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend)
  ]);
}

function createIconData(size) {
  const data = new Uint8Array(size * size * 4);

  // Colors
  const bgColor = [26, 26, 46, 255];  // #1a1a2e
  const gradientStart = [168, 85, 247, 255]; // #a855f7
  const gradientEnd = [99, 102, 241, 255];   // #6366f1

  // Draw background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      data[idx] = bgColor[0];
      data[idx + 1] = bgColor[1];
      data[idx + 2] = bgColor[2];
      data[idx + 3] = bgColor[3];
    }
  }

  // Draw play button triangle
  const scale = size / 128;
  const x1 = 40 * scale, y1 = 36 * scale;
  const x2 = 88 * scale, y2 = 64 * scale;
  const x3 = 40 * scale, y3 = 92 * scale;

  function sign(p1x, p1y, p2x, p2y, p3x, p3y) {
    return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
  }

  function pointInTriangle(px, py) {
    const d1 = sign(px, py, x1, y1, x2, y2);
    const d2 = sign(px, py, x2, y2, x3, y3);
    const d3 = sign(px, py, x3, y3, x1, y1);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pointInTriangle(x, y)) {
        const idx = (y * size + x) * 4;
        // Gradient based on position
        const t = (x + y) / (size * 2);
        data[idx] = Math.round(gradientStart[0] * (1 - t) + gradientEnd[0] * t);
        data[idx + 1] = Math.round(gradientStart[1] * (1 - t) + gradientEnd[1] * t);
        data[idx + 2] = Math.round(gradientStart[2] * (1 - t) + gradientEnd[2] * t);
        data[idx + 3] = 255;
      }
    }
  }

  return data;
}

// Generate icons
const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

sizes.forEach(size => {
  const data = createIconData(size);
  const png = createPNG(size, size, data);
  const filename = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Created: ${filename}`);
});

console.log('All icons created successfully!');
