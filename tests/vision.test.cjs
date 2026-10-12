'use strict';

// End-to-end tests: SVG output -> real raster pixels -> bundled detector -> API.
// Run with Node and sharp installed; no DOM, browser, camera, or network needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let sharp;
try { sharp = require('sharp'); }
catch (error) { sharp = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'sharp')); }
const CardVision = require('../dist/vision.js');
const { AR } = require('../dist/vendor/aruco.js');
const detector = CardVision.createDetector();
const fixtureDir = path.join(__dirname, 'fixtures');
fs.mkdirSync(fixtureDir, { recursive: true });
const tests = [];
const start = Date.now();

function check(name, actual, expected) {
  const got = actual.map(({ id, answer }) => ({ id, answer }));
  assert.deepEqual(got, expected, name);
  for (const marker of actual) {
    assert.equal(marker.corners.length, 4, name);
    assert(marker.corners.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), name);
  }
  tests.push(name);
}

async function raster(svg, size) {
  const result = await sharp(Buffer.from(svg), { density: 192 }).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: result.info.width, height: result.info.height, data: new Uint8ClampedArray(result.data) };
}

async function transform(image, angle = 0, size) {
  let pipeline = sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } });
  if (size) pipeline = pipeline.resize(size, size);
  if (angle) pipeline = pipeline.rotate(angle, { background: '#ffffff' });
  const result = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: result.info.width, height: result.info.height, data: new Uint8ClampedArray(result.data) };
}

async function png(image, name) {
  await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toFile(path.join(fixtureDir, name));
}

function solve(matrix, rhs) {
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    assert(Math.abs(divisor) > 1e-10);
    for (let j = col; j <= 8; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= 8; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map(row => row[8]);
}

// Independent inverse homography and bilinear resampling; does not use CV's
// square2quad or detector geometry to create the perspective test photographs.
function perspective(image, quad, width = 300, height = 300) {
  const source = [[0, 0], [image.width - 1, 0], [image.width - 1, image.height - 1], [0, image.height - 1]];
  const matrix = [], rhs = [];
  quad.forEach(([x, y], index) => {
    const [u, v] = source[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.push(v);
  });
  const h = solve(matrix, rhs);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const w = h[6] * x + h[7] * y + 1;
    const u = (h[0] * x + h[1] * y + h[2]) / w;
    const v = (h[3] * x + h[4] * y + h[5]) / w;
    if (u < 0 || v < 0 || u > image.width - 1 || v > image.height - 1) continue;
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, image.width - 1), y1 = Math.min(y0 + 1, image.height - 1);
    const tx = u - x0, ty = v - y0;
    const value = (xx, yy, channel) => image.data[(yy * image.width + xx) * 4 + channel];
    for (let channel = 0; channel < 3; channel += 1) {
      data[(y * width + x) * 4 + channel] =
        value(x0, y0, channel) * (1 - tx) * (1 - ty) + value(x1, y0, channel) * tx * (1 - ty) +
        value(x0, y1, channel) * (1 - tx) * ty + value(x1, y1, channel) * tx * ty;
    }
  }
  return { width, height, data };
}

function corruptCells(image, cells) {
  const copy = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const cell = image.width / 10;
  assert(Number.isInteger(cell));
  cells.forEach(index => {
    const left = (index % 6 + 2) * cell;
    const top = (Math.floor(index / 6) + 2) * cell;
    for (let y = top; y < top + cell; y += 1) for (let x = left; x < left + cell; x += 1) {
      const offset = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c += 1) copy.data[offset + c] = 255 - copy.data[offset + c];
    }
  });
  return copy;
}

function compose(images, padding = 16) {
  const width = images.reduce((sum, image) => sum + image.width, padding * (images.length + 1));
  const height = Math.max(...images.map(image => image.height)) + padding * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let left = padding;
  for (const image of images) {
    for (let y = 0; y < image.height; y += 1) {
      data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + padding) * width + left) * 4);
    }
    left += image.width + padding;
  }
  return { width, height, data };
}

(async () => {
  const base = new Map();
  const lettersClockwise = ['A', 'D', 'C', 'B'];
  for (let id = 1; id <= 40; id += 1) {
    const svg = CardVision.markerSvg(id);
    assert(svg.startsWith('<svg ') && svg.includes('viewBox="0 0 10 10"'));
    assert(svg.includes('fill="white"') && svg.includes('fill="black"'));
    base.set(id, await raster(svg, 200));
    for (let turn = 0; turn < 4; turn += 1) {
      check(`card ${id}, rotation ${turn * 90}`, detector.detect(await transform(base.get(id), turn * 90)), [{ id, answer: lettersClockwise[turn] }]);
    }
  }

  for (const id of [1, 8, 21, 40]) for (const size of [50, 80]) for (let turn = 0; turn < 4; turn += 1) {
    check(`downsample ${id}, SVG ${size}px, rotation ${turn * 90}`, detector.detect(await transform(base.get(id), turn * 90, size)), [{ id, answer: lettersClockwise[turn] }]);
  }

  const quad = [[57, 30], [248, 59], [269, 258], [31, 239]];
  for (const id of [1, 8, 21, 40]) {
    const projected = perspective(base.get(id), quad);
    for (let turn = 0; turn < 4; turn += 1) {
      check(`perspective ${id}, rotation ${turn * 90}`, detector.detect(await transform(projected, turn * 90)), [{ id, answer: lettersClockwise[turn] }]);
    }
    if (id === 1) await png(projected, 'card-1-perspective.png');
  }

  const tilted = [[20, 'A'], [70, 'D'], [110, 'D'], [160, 'C'], [200, 'C'], [250, 'B'], [290, 'B'], [340, 'A']];
  for (const id of [1, 21, 40]) for (const [angle, answer] of tilted) {
    check(`accepted tilt ${id}, ${angle}`, detector.detect(await transform(base.get(id), angle)), [{ id, answer }]);
  }
  for (const angle of [35, 45, 55, 125, 135, 145, 215, 225, 235, 305, 315, 325]) {
    const image = await transform(base.get(1), angle);
    check(`ambiguous tilt ${angle}`, detector.detect(image), []);
    if (angle === 45) await png(image, 'card-1-ambiguous.png');
  }
  check('projected edges both within 30 degrees, but tied', detector.detect(perspective(base.get(1), [[70, 150], [150, 10], [230, 150], [150, 290]])), []);

  for (const id of [1, 17, 40]) for (const errors of [1, 2, 3]) {
    check(`bit corruption ${id}, ${errors} cells`, detector.detect(corruptCells(base.get(id), [3, 19, 31].slice(0, errors))), errors <= 2 ? [{ id, answer: 'A' }] : []);
  }

  const dictionary = new AR.Dictionary('ARUCO_MIP_36h12');
  for (const internalId of [40, 249]) {
    check(`unknown dictionary ID ${internalId}`, detector.detect(await raster(dictionary.generateSVG(internalId), 200)), []);
  }
  check('white frame', detector.detect({ width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(255) }), []);
  const black = new Uint8ClampedArray(200 * 200 * 4);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  check('black frame', detector.detect({ width: 200, height: 200, data: black }), []);

  const fourCards = compose(await Promise.all([1, 8, 21, 40].map((id, index) => transform(base.get(id), index * 90, 140))));
  check('four cards at once', detector.detect(fourCards), [1, 8, 21, 40].map((id, index) => ({ id, answer: lettersClockwise[index] })));
  await png(fourCards, 'cards-four-orientations.png');
  check('duplicate ID with conflicting answers', detector.detect(compose([base.get(1), await transform(base.get(1), 90)])), []);
  check('duplicate ID with matching answers', detector.detect(compose([base.get(1), base.get(1)])), [{ id: 1, answer: 'A' }]);

  for (const id of [0, 41, -1, 1.2, '1', NaN]) assert.throws(() => CardVision.markerSvg(id), RangeError);
  for (const image of [null, {}, { width: 10, height: 10, data: new Uint8ClampedArray(4) }]) assert.throws(() => detector.detect(image), TypeError);

  const report = { status: 'passed', imageCases: tests.length, elapsedMs: Date.now() - start, groups: ['all 40 card IDs × four rotations', 'downsampled SVGs', 'perspective resampling', 'moderate tilt accepted', 'ambiguous tilt rejected', 'bit-error threshold', 'unknown IDs and empty frames', 'multiple cards and duplicate conflicts'], note: 'Synthetic images test decoding and mapping; physical camera/print testing remains a separate classroom check.' };
  fs.writeFileSync(path.join(__dirname, 'vision-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
