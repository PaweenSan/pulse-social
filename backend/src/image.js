import { crc32 } from 'node:zlib';

export const MAX_IMAGE_BYTES = 1024 * 1024;
const maxBase64Length = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const imageError = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const dimensions = (width, height) => width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 32000000;

function validPng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return false;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  if (!dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))) return false;
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) return false;
  let position = 8, imageData = 0;
  while (position + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(position);
    const end = position + length + 12;
    if (end > bytes.length) return false;
    const type = bytes.toString('ascii', position + 4, position + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || (type === 'IHDR' && position !== 8)) return false;
    if (crc32(bytes.subarray(position + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    if (type === 'IDAT') imageData += length;
    if (type === 'IEND') return length === 0 && end === bytes.length && imageData > 0;
    position = end;
  }
  return false;
}

function validJpeg(bytes) {
  if (bytes.length < 14 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  let position = 2, frame = false;
  while (position + 4 < bytes.length) {
    if (bytes[position++] !== 0xff) return false;
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (!marker || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || position + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(position);
    if (length < 2 || position + length > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || length !== 8 + 3 * bytes[position + 7] || !dimensions(bytes.readUInt16BE(position + 5), bytes.readUInt16BE(position + 3))) return false;
      frame = true;
    }
    // Validate the frame and scan headers without implementing a JPEG decoder.
    if (marker === 0xda) return frame && length >= 6 && bytes[position + 2] >= 1 && bytes[position + 2] <= 4 && length === 6 + 2 * bytes[position + 2] && position + length < bytes.length - 2;
    position += length;
  }
  return false;
}

function validWebp(bytes) {
  if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let position = 12, imageCount = 0;
  while (position + 8 <= bytes.length) {
    const type = bytes.toString('ascii', position, position + 4);
    const length = bytes.readUInt32LE(position + 4);
    const start = position + 8, end = start + length;
    if (end + (length % 2) > bytes.length) return false;
    if (position === 12 && !['VP8 ', 'VP8L', 'VP8X'].includes(type)) return false;
    if (type === 'VP8X') {
      if (position !== 12 || length !== 10 || !dimensions(1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3))) return false;
    }
    if (type === 'VP8 ') {
      if (length < 10 || (bytes[start] & 1) !== 0 || bytes.toString('hex', start + 3, start + 6) !== '9d012a' || !dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff)) return false;
      imageCount++;
    }
    if (type === 'VP8L') {
      if (length < 5 || bytes[start] !== 0x2f) return false;
      const header = bytes.readUInt32LE(start + 1);
      if ((header >>> 29) !== 0 || !dimensions(1 + (header & 0x3fff), 1 + ((header >>> 14) & 0x3fff))) return false;
      imageCount++;
    }
    position = end + (length % 2);
  }
  return position === bytes.length && imageCount === 1;
}

export function readImage(image) {
  if (!image || typeof image !== 'object' || Array.isArray(image) || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mime)) imageError('Choose a JPEG, PNG, or WebP image.');
  if (typeof image.data !== 'string' || !image.data || image.data.length % 4 !== 0) imageError('Image data must be canonical base64.');
  if (image.data.length > maxBase64Length) imageError('Image must be 1 MiB or smaller after compression.', 413);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) imageError('Image data must be canonical base64.');
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) imageError('Image must be 1 MiB or smaller after compression.', 413);
  if (bytes.toString('base64') !== image.data) imageError('Image data must be canonical base64.');
  const valid = image.mime === 'image/png' ? validPng(bytes) : image.mime === 'image/jpeg' ? validJpeg(bytes) : validWebp(bytes);
  if (!valid) imageError('Image contents must match its JPEG, PNG, or WebP type, with dimensions at most 8192px and 32 million pixels.');
  return { bytes, mime: image.mime };
}
