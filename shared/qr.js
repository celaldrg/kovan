// QR Code, byte mode, error correction M. Versions 1–15.
// Enough for a pairing URL. Returns null when the text does not fit.

const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655];
const ECC_M = [0, 10, 16, 26, 36, 48, 64, 72, 88, 110, 130, 150, 176, 198, 216, 240];
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
let gfReady = false;
function initGf() {
  if (gfReady) return;
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  gfReady = true;
}
function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function reedSolomon(data, eccLen) {
  initGf();
  let gen = [1];
  for (let i = 0; i < eccLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], GF_EXP[i]);
    }
    gen = next;
  }
  const res = data.concat(new Array(eccLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (!coef) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], coef);
  }
  return res.slice(data.length);
}

function alignmentCenters(version) {
  if (version === 1) return [];
  const n = version * 4 + 17;
  const count = Math.floor(version / 7) + 2;
  const step = n === 145 ? 26 : Math.ceil((n - 13) / (2 * count - 2)) * 2;
  const pos = [n - 7];
  for (let i = 1; i < count - 1; i++) pos.push(pos[i - 1] - step);
  pos.push(6);
  return pos.reverse();
}

function pushBits(bits, value, len) {
  for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function dataCodewords(bytes, version, dataCount) {
  const bits = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) pushBits(bits, b, 8);
  const cap = dataCount * 8;
  if (bits.length > cap) return null;
  const term = Math.min(4, cap - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  for (let i = 0; out.length < dataCount; i++) out.push(i % 2 === 0 ? 0xec : 0x11);
  return out;
}

function splitBlocks(codewords, version) {
  const blocks = BLOCKS_M[version];
  const eccEach = ECC_M[version] / blocks;
  const dataCount = codewords.length;
  const base = Math.floor(dataCount / blocks);
  const extra = dataCount % blocks;
  const out = [];
  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const len = base + (i >= blocks - extra ? 1 : 0);
    const data = codewords.slice(offset, offset + len);
    offset += len;
    out.push({ data, ecc: reedSolomon(data, eccEach) });
  }
  return out;
}

function interleave(blocks) {
  const out = [];
  const maxData = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  const eccLen = blocks[0].ecc.length;
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.ecc[i]);
  const bits = [];
  for (const w of out) pushBits(bits, w, 8);
  return bits;
}

function formatBits(mask) {
  const data = mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function versionBits(version) {
  const G = 0b1111100100101;
  const degree = 12;
  let d = version << 12;
  while (bitLength(d) - degree - 1 >= 0) d ^= G << (bitLength(d) - degree - 1);
  return (version << 12) | d;
}
function bitLength(n) {
  let d = 0;
  while (n) { d++; n >>>= 1; }
  return d;
}

function blank(n) {
  return Array.from({ length: n }, () => Array(n).fill(false));
}

function paintFinder(matrix, reserved, r0, c0) {
  const n = matrix.length;
  for (let y = -1; y <= 7; y++) {
    for (let x = -1; x <= 7; x++) {
      const r = r0 + y;
      const c = c0 + x;
      if (r < 0 || c < 0 || r >= n || c >= n) continue;
      const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
      const edge = inside && (x === 0 || x === 6 || y === 0 || y === 6);
      const core = inside && x >= 2 && x <= 4 && y >= 2 && y <= 4;
      matrix[r][c] = edge || core;
      reserved[r][c] = true;
    }
  }
}

function paintAlignment(matrix, reserved, cx, cy) {
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const on = Math.max(Math.abs(x), Math.abs(y)) !== 1;
      matrix[cy + y][cx + x] = on;
      reserved[cy + y][cx + x] = true;
    }
  }
}

function reserveFormat(reserved) {
  const n = reserved.length;
  for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][n - 1 - i] = true; reserved[n - 1 - i][8] = true; }
}

function drawVersion(matrix, reserved, version) {
  if (version < 7) return;
  const n = matrix.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1;
    const a = n - 11 + (i % 3);
    const b = Math.floor(i / 3);
    matrix[a][b] = on;
    matrix[b][a] = on;
    reserved[a][b] = true;
    reserved[b][a] = true;
  }
}

function placeData(matrix, reserved, bits) {
  const n = matrix.length;
  let i = 0;
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const row = upward ? n - 1 - k : k;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        matrix[row][c] = i < bits.length ? bits[i] === 1 : false;
        i++;
      }
    }
    upward = !upward;
  }
}

function maskOf(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function applyMask(matrix, reserved, mask) {
  const n = matrix.length;
  const out = matrix.map(row => row.slice());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!reserved[r][c] && maskOf(mask, r, c)) out[r][c] = !out[r][c];
    }
  }
  return out;
}

function drawFormat(matrix, mask) {
  const n = matrix.length;
  const bits = formatBits(mask);
  const bit = i => ((bits >>> i) & 1) === 1;
  // Coordinates follow the QR symbol: matrix[row][col], format bit 0 is the LSB.
  for (let i = 0; i <= 5; i++) matrix[i][8] = bit(i);
  matrix[7][8] = bit(6);
  matrix[8][8] = bit(7);
  matrix[8][7] = bit(8);
  for (let i = 9; i < 15; i++) matrix[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) matrix[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) matrix[n - 15 + i][8] = bit(i);
}

function penalty(matrix) {
  const n = matrix.length;
  let score = 0;
  const run = (get) => {
    for (let i = 0; i < n; i++) {
      let count = 1;
      let prev = get(i, 0);
      for (let j = 1; j < n; j++) {
        const v = get(i, j);
        if (v === prev) count++;
        else { if (count >= 5) score += 3 + (count - 5); count = 1; prev = v; }
      }
      if (count >= 5) score += 3 + (count - 5);
    }
  };
  run((i, j) => matrix[i][j]);
  run((i, j) => matrix[j][i]);
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3;
    }
  }
  const pattern = (row) => {
    const s = row.map(v => (v ? '1' : '0')).join('');
    const a = '10111010000';
    const b = '00001011101';
    let hits = 0;
    for (let i = 0; i + 11 <= s.length; i++) {
      const w = s.slice(i, i + 11);
      if (w === a || w === b) hits++;
    }
    return hits;
  };
  for (let r = 0; r < n; r++) score += pattern(matrix[r]) * 40;
  for (let c = 0; c < n; c++) score += pattern(matrix.map(row => row[c])) * 40;
  let dark = 0;
  for (const row of matrix) for (const v of row) if (v) dark++;
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

export function qrMatrix(text, forceMask = null) {
  const bytes = Buffer.from(String(text), 'utf8');
  let version = 0;
  let codewords = null;
  for (let v = 1; v <= 15; v++) {
    const dataCount = TOTAL[v] - ECC_M[v];
    const packed = dataCodewords(bytes, v, dataCount);
    if (packed) { version = v; codewords = packed; break; }
  }
  if (!version) return null;
  const n = version * 4 + 17;
  const matrix = blank(n);
  const reserved = blank(n);
  paintFinder(matrix, reserved, 0, 0);
  paintFinder(matrix, reserved, 0, n - 7);
  paintFinder(matrix, reserved, n - 7, 0);
  for (let i = 0; i < n; i++) {
    if (!reserved[6][i]) { matrix[6][i] = i % 2 === 0; reserved[6][i] = true; }
    if (!reserved[i][6]) { matrix[i][6] = i % 2 === 0; reserved[i][6] = true; }
  }
  const centers = alignmentCenters(version);
  const finderZone = (r, c) => (r < 9 && c < 9) || (r < 9 && c > n - 10) || (r > n - 10 && c < 9);
  for (const r of centers) {
    for (const c of centers) {
      if (finderZone(r, c)) continue;
      paintAlignment(matrix, reserved, c, r);
    }
  }
  matrix[4 * version + 9][8] = true;
  reserved[4 * version + 9][8] = true;
  reserveFormat(reserved);
  drawVersion(matrix, reserved, version);
  placeData(matrix, reserved, interleave(splitBlocks(codewords, version)));
  let best = null;
  let bestScore = Infinity;
  let bestMask = 0;
  const masks = forceMask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of masks) {
    const candidate = applyMask(matrix, reserved, mask);
    drawFormat(candidate, mask);
    const score = penalty(candidate);
    if (score < bestScore) { bestScore = score; best = candidate; bestMask = mask; }
  }
  best.mask = bestMask;
  return best;
}

export function qrSvg(text) {
  const matrix = qrMatrix(text);
  if (!matrix) return '';
  const n = matrix.length;
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (matrix[r][c]) rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"><rect width="${n}" height="${n}" fill="#fff"/><g fill="#14120c">${rects}</g></svg>`;
}
