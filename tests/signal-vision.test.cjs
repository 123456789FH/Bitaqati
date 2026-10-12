'use strict';

// Run with the primary Node runtime and sharp. These are deterministic image
// and state-machine tests, not a claim of physical classroom camera accuracy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let sharp;
try { sharp = require('sharp'); }
catch (_) { sharp = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'sharp')); }
const SignalVision = require('../dist/signal-vision.js');
const CardVision = require('../dist/vision.js');
const { AR } = require('../dist/vendor/aruco.js');
const detector = SignalVision.createDetector();
const legacyDetector = CardVision.createDetector();
const dir = path.join(__dirname, 'signals');
fs.mkdirSync(dir, { recursive: true });
const imageGroups = {};
const stateGroups = {};
const start = Date.now();
const identity = ({ mode, id, key }) => ({ mode, id, key });
const signal = (mode, id, key) => ({ mode, id, key });

function check(group, name, actual, expected) {
  assert.deepEqual(actual.map(identity), expected, name);
  for (const card of actual) {
    assert.equal(card.corners.length, 4, name);
    assert(card.corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), name);
  }
  imageGroups[group] = (imageGroups[group] || 0) + 1;
}

function state(group, name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  stateGroups[group] = (stateGroups[group] || 0) + 1;
}

async function raster(svg, size = 180) {
  const { data, info } = await sharp(Buffer.from(svg)).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

async function rotate(image, angle) {
  const { data, info } = await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } })
    .rotate(angle, { background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

function grid(images, columns = 3, cell = 220, gap = 20) {
  const rows = Math.ceil(images.length / columns);
  const width = columns * cell + gap * 2;
  const height = rows * cell + gap * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  images.forEach((image, index) => {
    assert(image.width <= cell && image.height <= cell);
    const left = gap + (index % columns) * cell + Math.floor((cell - image.width) / 2);
    const top = gap + Math.floor(index / columns) * cell + Math.floor((cell - image.height) / 2);
    for (let y = 0; y < image.height; y += 1) {
      data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((top + y) * width + left) * 4);
    }
  });
  return { width, height, data };
}

async function png(image, name) {
  await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } })
    .png().toFile(path.join(dir, name));
}

// Independent inverse homography and resampling; fixtures do not use the
// detector's own CV.warp or square2quad functions to construct test images.
function perspective(image, quad, width = 280, height = 280) {
  const source = [[0, 0], [image.width - 1, 0], [image.width - 1, image.height - 1], [0, image.height - 1]];
  const a = [];
  quad.forEach(([x, y], i) => {
    const [u, v] = source[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    assert(Math.abs(divisor) > 1e-9);
    for (let j = col; j <= 8; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const scale = a[row][col];
      for (let j = col; j <= 8; j += 1) a[row][j] -= scale * a[col][j];
    }
  }
  const h = a.map(row => row[8]);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const w = h[6] * x + h[7] * y + 1;
    const u = (h[0] * x + h[1] * y + h[2]) / w;
    const v = (h[3] * x + h[4] * y + h[5]) / w;
    if (u < 0 || v < 0 || u > image.width - 1 || v > image.height - 1) continue;
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, image.width - 1), y1 = Math.min(y0 + 1, image.height - 1);
    const tx = u - x0, ty = v - y0;
    const sample = (xx, yy, c) => image.data[(yy * image.width + xx) * 4 + c];
    for (let c = 0; c < 3; c += 1) data[(y * width + x) * 4 + c] =
      sample(x0, y0, c) * (1 - tx) * (1 - ty) + sample(x1, y0, c) * tx * (1 - ty) +
      sample(x0, y1, c) * (1 - tx) * ty + sample(x1, y1, c) * tx * ty;
  }
  return { width, height, data };
}

function flipCell(image, index) {
  const data = new Uint8ClampedArray(image.data);
  const cell = image.width / 9;
  assert(Number.isInteger(cell));
  const left = (2 + index % 5) * cell;
  const top = (2 + Math.floor(index / 5)) * cell;
  for (let y = top; y < top + cell; y += 1) for (let x = left; x < left + cell; x += 1) {
    const offset = (y * image.width + x) * 4;
    for (let c = 0; c < 3; c += 1) data[offset + c] = 255 - data[offset + c];
  }
  return { width: image.width, height: image.height, data };
}

(async () => {
  const base = new Map();
  const baseKey = (mode, id, key) => `${mode}/${id}/${key}`;
  const codes = new Set();
  for (const mode of ['feelings', 'hats']) for (let id = 1; id <= 40; id += 1) for (const key of SignalVision.keys[mode]) {
    const encoded = SignalVision.markerId(mode, id, key);
    assert(!codes.has(encoded));
    codes.add(encoded);
    assert.deepEqual(SignalVision.fromMarkerId(encoded), { mode, id, key });
    const svg = SignalVision.markerSvg(mode, id, key);
    assert(svg.includes('viewBox="0 0 9 9"') && svg.includes('fill="white"') && svg.includes('fill="black"'));
    const image = await raster(svg);
    base.set(baseKey(mode, id, key), image);
    check('all_480_identifiers', `${mode} student ${id} ${key}`, detector.detect(image), [{ mode, id, key }]);
    check('signals_rejected_by_legacy_reader', `${mode}/${id}/${key} must not become a multiple-choice answer`, legacyDetector.detect(image), []);
  }
  assert.equal(codes.size, 480);
  assert.equal(Math.min(...codes), 0);
  assert.equal(Math.max(...codes), 479);

  for (const mode of ['feelings', 'hats']) for (const id of [1, 40]) for (const key of SignalVision.keys[mode]) {
    const image = base.get(baseKey(mode, id, key));
    for (const angle of [25, 45, 90, 180, 270, 325]) {
      check('rotation_independence', `${mode}/${id}/${key} rotation ${angle}`, detector.detect(await rotate(image, angle)), [{ mode, id, key }]);
    }
    for (const size of [54, 90]) {
      check('smaller_digital_markers', `${mode}/${id}/${key} ${size}px SVG`, detector.detect(await raster(SignalVision.markerSvg(mode, id, key), size)), [{ mode, id, key }]);
    }
    check('strict_bit_rejection', `${mode}/${id}/${key} one changed payload cell`, detector.detect(flipCell(image, 12)), []);
  }

  const quad = [[37, 24], [244, 49], [237, 254], [20, 230]];
  for (const mode of ['feelings', 'hats']) for (const key of SignalVision.keys[mode]) {
    const expected = [{ mode, id: 20, key }];
    const projected = perspective(base.get(baseKey(mode, 20, key)), quad);
    for (const angle of [0, 45, 180, 270]) {
      check('perspective', `${mode}/20/${key} perspective ${angle}`, detector.detect(await rotate(projected, angle)), expected);
    }
  }

  // All 40 legacy cards are checked in four right-angle orientations and at
  // an oblique angle, plus two extra image scales and oblique angles.
  for (let id = 1; id <= 40; id += 1) {
    const svg = CardVision.markerSvg(id);
    const image = await raster(svg);
    for (const angle of [0, 35, 90, 180, 270]) {
      check('legacy_cards_rejected', `legacy ${id} at ${angle}`, detector.detect(await rotate(image, angle)), []);
    }
    for (const size of [90, 270]) for (const angle of [13, 45]) {
      check('legacy_cards_rejected', `legacy ${id} at ${size}px and ${angle}`, detector.detect(await rotate(await raster(svg, size), angle)), []);
    }
  }

  const dictionary = new AR.Dictionary('ARUCO');
  for (const id of [480, 600, 1008, 1022]) {
    check('unassigned_identifiers', `unassigned ARUCO ${id}`, detector.detect(await raster(dictionary.generateSVG(id))), []);
  }
  for (const fill of ['#ffffff', '#000000', '#e53935', '#16a34a', '#2563eb', '#facc15', '#a855f7']) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" fill="white"/><rect x="25" y="25" width="130" height="130" fill="${fill}"/></svg>`;
    check('plain_colours_not_read', `plain ${fill} sheet`, detector.detect(await raster(svg)), []);
  }

  const sceneSpec = [signal('feelings', 1, 'red'), signal('feelings', 2, 'green'), signal('hats', 1, 'blue'),
    signal('feelings', 3, 'blue'), signal('feelings', 40, 'purple'), signal('feelings', 3, 'white')];
  const scene = grid(sceneSpec.map(s => base.get(baseKey(s.mode, s.id, s.key))));
  const sceneDetections = detector.detect(scene);
  const sortedScene = [sceneSpec[0], sceneSpec[2], sceneSpec[1], sceneSpec[3], sceneSpec[5], sceneSpec[4]];
  check('multiple_cards', 'mixed modes, conflicting students, unknown student', sceneDetections, sortedScene);
  const classified = SignalVision.classify(sceneDetections, 'feelings', [1, 2, 3]);
  state('frame_classification', 'only eligible unambiguous student updates', classified.updates.map(identity), [sceneSpec[1]]);
  state('frame_classification', 'other mode is diagnosed', classified.wrongMode.map(identity), [sceneSpec[2]]);
  state('frame_classification', 'unregistered student is diagnosed', classified.unknown, [40]);
  state('frame_classification', 'different modes and same-mode messages both conflict', classified.ambiguous, [1, 3]);
  await png(scene, 'mixed-conflicts.png');

  const duplicate = signal('feelings', 4, 'yellow');
  const duplicateImage = base.get(baseKey(duplicate.mode, duplicate.id, duplicate.key));
  const duplicateDetections = detector.detect(grid([duplicateImage, duplicateImage], 2));
  check('multiple_cards', 'two physical copies remain visible to classifier', duplicateDetections, [duplicate, duplicate]);
  const duplicateClass = SignalVision.classify(duplicateDetections, 'feelings', [4]);
  state('frame_classification', 'two matching copies are also ambiguous', duplicateClass.updates, []);
  state('frame_classification', 'matching duplicate student identified', duplicateClass.ambiguous, [4]);

  const activeSpec = [signal('hats', 1, 'white'), signal('hats', 2, 'red'), signal('hats', 3, 'white'), signal('feelings', 4, 'white')];
  const activeImage = grid(activeSpec.map(s => base.get(baseKey(s.mode, s.id, s.key))), 2);
  const activeDetections = detector.detect(activeImage);
  check('multiple_cards', 'active hat sample retains all detection types', activeDetections, activeSpec);
  const active = SignalVision.classify(activeDetections, 'hats', [1, 2, 3, 4], { allowedKey: 'white' });
  state('active_hat', 'only current thinking hat participates', active.updates.map(identity), [activeSpec[0], activeSpec[2]]);
  state('active_hat', 'other hat has its own diagnosis', active.otherKeys.map(identity), [activeSpec[1]]);
  state('active_hat', 'matching colour in wrong mode is not accepted', active.wrongMode.map(identity), [activeSpec[3]]);
  const crossConflict = SignalVision.classify([signal('hats', 1, 'white'), signal('hats', 1, 'red')], 'hats', [1], { allowedKey: 'white' });
  state('active_hat', 'wrong-key card still invalidates duplicate student', crossConflict.updates, []);
  state('active_hat', 'active-key conflict is diagnosed', crossConflict.ambiguous, [1]);
  await png(activeImage, 'active-hat.png');

  const red = signal('feelings', 1, 'red');
  const blue = signal('feelings', 1, 'blue');
  let tracker = SignalVision.createTracker('feelings', [1]);
  state('stability', 'first frame does not commit', tracker.push([red], 0).updates, []);
  state('stability', 'second frame does not commit', tracker.push([red], 120).updates, []);
  state('stability', 'three frames over 240ms commit', tracker.push([red], 240).updates, [red]);
  state('stability', 'unchanged key is not counted again', tracker.push([red], 360).updates, []);
  state('stability', 'changed key needs confirmation', tracker.push([blue], 480).updates, []);
  state('stability', 'changed key second frame', tracker.push([blue], 600).updates, []);
  state('stability', 'new stable key replaces previous key', tracker.push([blue], 720).updates, [blue]);
  tracker.push([], 800);
  tracker.push([blue], 900);
  tracker.push([blue], 1020);
  state('stability', 'unchanged key after leaving frame is not repeated', tracker.push([blue], 1140).updates, []);

  tracker = SignalVision.createTracker('feelings', [1]);
  tracker.push([red], 0);
  tracker.push([red], 120);
  tracker.push([], 180);
  state('interruption', 'absence starts a new candidate', tracker.push([red], 240).updates, []);
  tracker.push([red], 360);
  state('interruption', 'new complete sequence after absence commits', tracker.push([red], 480).updates, [red]);
  tracker.reset();
  tracker.push([red], 0);
  tracker.push([red], 120);
  state('interruption', 'duplicate frame prevents commitment', tracker.push([red, blue], 240).updates, []);
  tracker.push([red], 360);
  tracker.push([red], 480);
  state('interruption', 'duplicate also clears pending sequence', tracker.push([red], 600).updates, [red]);
  tracker.reset();
  tracker.push([red], 0);
  tracker.push([red], 120);
  state('interruption', 'wrong mode is diagnosed during tracking', tracker.push([signal('hats', 1, 'red')], 240).wrongMode,
    [signal('hats', 1, 'red')]);
  tracker.push([red], 360);
  tracker.push([red], 480);
  state('interruption', 'wrong mode breaks pending sequence', tracker.push([red], 600).updates, [red]);

  tracker = SignalVision.createTracker('feelings', [1]);
  tracker.push([red], 0);
  tracker.push([red], 0);
  state('timing', 'same timestamp cannot add confirmation frames', tracker.push([red], 240).updates, []);
  state('timing', 'later third frame commits', tracker.push([red], 250).updates, [red]);
  tracker.reset();
  tracker.push([red], 0);
  tracker.push([red], 800);
  state('timing', 'long frame gap expires earlier candidate', tracker.push([red], 920).updates, []);
  state('timing', 'confirmation after gap commits', tracker.push([red], 1040).updates, [red]);
  tracker.reset();
  tracker.push([red], 500);
  tracker.push([red], 100);
  state('timing', 'clock rollback starts a new sequence', tracker.push([red], 220).updates, []);
  state('timing', 'new sequence after rollback commits', tracker.push([red], 340).updates, [red]);
  tracker.reset();
  tracker.push([red], 0);
  tracker.push([red], 120);
  state('reset', 'reset clears accepted state as well as candidates', tracker.push([red], 240).updates, [red]);

  tracker = SignalVision.createTracker('hats', [1], { allowedKey: 'white' });
  const whiteHat = signal('hats', 1, 'white');
  const redHat = signal('hats', 1, 'red');
  tracker.push([whiteHat], 0);
  tracker.push([whiteHat], 120);
  const ignored = tracker.push([redHat], 240);
  state('active_hat', 'tracker excludes another hat', ignored.updates, []);
  state('active_hat', 'tracker reports another hat', ignored.otherKeys, [redHat]);
  tracker.push([whiteHat], 360);
  tracker.push([whiteHat], 480);
  state('active_hat', 'fresh active-hat sequence is required', tracker.push([whiteHat], 600).updates, [whiteHat]);
  tracker = SignalVision.createTracker('feelings', [1], { minFrames: 1, minDurationMs: 0 });
  const unknown = tracker.push([signal('feelings', 40, 'green')], 0);
  state('roster', 'student 40 is excluded from a one-student roster', unknown.unknown, [40]);
  state('roster', 'unknown student never produces an update', unknown.updates, []);
  state('roster', 'custom confirmation timing works', tracker.push([red], 0).updates, [red]);
  state('roster', 'empty roster does not silently accept anyone', SignalVision.classify([red], 'feelings', []).updates, []);

  for (const id of [0, 41, -1, 1.5, '1', NaN]) assert.throws(() => SignalVision.markerSvg('feelings', id, 'red'), RangeError);
  for (const mode of ['', 'quiz', 'constructor', null]) assert.throws(() => SignalVision.markerSvg(mode, 1, 'red'), RangeError);
  assert.throws(() => SignalVision.markerSvg('feelings', 1, 'black'), RangeError);
  assert.throws(() => SignalVision.markerSvg('hats', 1, 'purple'), RangeError);
  assert.throws(() => SignalVision.classify([], 'hats', [1], { allowedKey: 'purple' }), RangeError);
  assert.throws(() => SignalVision.classify([], 'hats', [41]), RangeError);
  assert.throws(() => SignalVision.classify(null, 'feelings', [1]), TypeError);
  for (const image of [null, {}, { width: 2, height: 2, data: new Uint8Array(4) }, { width: -1, height: 2, data: [] }]) {
    assert.throws(() => detector.detect(image), TypeError);
  }
  for (const options of [{ minFrames: 0 }, { minFrames: 1.5 }, { minDurationMs: -1 }, { expireMs: 0 }, { expireMs: Infinity }]) {
    assert.throws(() => SignalVision.createTracker('feelings', [1], options), RangeError);
  }
  assert.throws(() => tracker.push([red], NaN), TypeError);
  for (const id of [-1, 480, 1023, NaN, '0', null]) assert.equal(SignalVision.fromMarkerId(id), null);
  const classic = { window: { AR } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/signal-vision.js'), 'utf8'), classic);
  assert.equal(classic.window.SignalVision.markerId('hats', 40, 'blue'), 479);
  assert.equal(classic.window.SignalVision.markerSvg('feelings', 1, 'red'), SignalVision.markerSvg('feelings', 1, 'red'));

  const report = {
    status: 'passed',
    imageCases: Object.values(imageGroups).reduce((sum, n) => sum + n, 0),
    stateCases: Object.values(stateGroups).reduce((sum, n) => sum + n, 0),
    imageGroups, stateGroups,
    elapsedMs: Date.now() - start,
    dictionary: 'ARUCO',
    bundledDictionaryEntries: dictionary.codeList.length,
    assignedMarkerIds: [0, 479],
    bitErrorsAccepted: 0,
    mapping: 'mode offset (feelings 0 / hats 240) + (studentId - 1) * 6 + index in SignalVision.keys[mode]',
    note: 'Synthetic SVG/raster and state tests only. Plain colour sheets are not decoded. Real print, classroom distance, focus, exposure, glare and camera performance require separate field verification.'
  };
  fs.writeFileSync(path.join(dir, 'signal-vision-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
