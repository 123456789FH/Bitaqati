/*
 * Bitaqati feelings / six-thinking-hats card reader, v2.0.0.
 * Uses the locally bundled js-aruco2; preserve vendor/LICENSE-js-aruco2.txt.
 * Load vendor/cv.js and vendor/aruco.js before this classic script.
 * Reads the printed black/white identifier, not a plain sheet's colour.
 * No camera access, network calls, student names, or persistence in this file.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/aruco.js').AR);
  } else {
    root.SignalVision = factory(root.AR);
  }
}(typeof window !== 'undefined' ? window : globalThis, function (AR) {
  'use strict';

  if (!AR || !AR.Detector || !AR.Dictionary) {
    throw new Error('SignalVision requires vendor/cv.js and vendor/aruco.js first.');
  }

  var MODES = ['feelings', 'hats'];
  var KEYS = Object.freeze({
    feelings: Object.freeze(['red', 'green', 'blue', 'yellow', 'purple', 'white']),
    hats: Object.freeze(['white', 'red', 'yellow', 'black', 'green', 'blue'])
  });
  var STUDENTS = 40;
  var PER_STUDENT = 6;
  var PER_MODE = STUDENTS * PER_STUDENT;
  var MARKER_COUNT = PER_MODE * MODES.length;
  var DICTIONARY = 'ARUCO';
  var MIN_EDGE_PX = 28;
  var dictionary = new AR.Dictionary(DICTIONARY);

  // This bundled ARUCO table has 1023 entries; we assign only entries 0..479.
  // The old multiple-choice cards use ARUCO_MIP_36h12, a different bit grid.
  if (dictionary.codeList.length < MARKER_COUNT) {
    throw new Error('The bundled ARUCO dictionary does not contain enough signal identifiers.');
  }

  function checkMode(mode) {
    if (MODES.indexOf(mode) < 0) throw new RangeError('Signal mode must be feelings or hats.');
    return mode;
  }

  function checkId(id) {
    if (!Number.isInteger(id) || id < 1 || id > STUDENTS) {
      throw new RangeError('Student number must be an integer from 1 to 40.');
    }
    return id;
  }

  function checkKey(mode, key) {
    checkMode(mode);
    if (KEYS[mode].indexOf(key) < 0) throw new RangeError('Unknown card key for this signal mode.');
    return key;
  }

  /** Stable print mapping. Feelings: 0..239; hats: 240..479. */
  function markerId(mode, id, key) {
    checkMode(mode);
    checkId(id);
    checkKey(mode, key);
    return MODES.indexOf(mode) * PER_MODE + (id - 1) * PER_STUDENT + KEYS[mode].indexOf(key);
  }

  function fromMarkerId(value) {
    if (!Number.isInteger(value) || value < 0 || value >= MARKER_COUNT) return null;
    var mode = MODES[Math.floor(value / PER_MODE)];
    var local = value % PER_MODE;
    return { mode: mode, id: Math.floor(local / PER_STUDENT) + 1, key: KEYS[mode][local % PER_STUDENT] };
  }

  /**
   * Preserve the whole SVG including its white margin. Keep colour, words,
   * decoration and cutting lines outside it. Turning the card does not change
   * the message: the identifier encodes the mode, student and message together.
   */
  function markerSvg(mode, id, key) {
    var value = markerId(mode, id, key);
    var arabicId = String(id).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[Number(d)]; });
    return dictionary.generateSVG(value).replace('<svg ',
      '<svg width="270" height="270" shape-rendering="crispEdges" role="img" ' +
      'aria-label="رمز بطاقة الطالب ' + arabicId + '" data-signal-mode="' + mode +
      '" data-student-id="' + id + '" data-signal-key="' + key + '" ');
  }

  function validGeometry(corners) {
    if (!Array.isArray(corners) || corners.length !== 4) return false;
    if (corners.some(function (p) { return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y); })) return false;
    var smallest = Infinity;
    var largest = 0;
    var twiceArea = 0;
    for (var i = 0; i < 4; i += 1) {
      var a = corners[i];
      var b = corners[(i + 1) % 4];
      var c = corners[(i + 2) % 4];
      // Upstream canonical corners retain clockwise image order at any angle.
      var cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross <= 0) return false;
      var edge = Math.hypot(b.x - a.x, b.y - a.y);
      smallest = Math.min(smallest, edge);
      largest = Math.max(largest, edge);
      twiceArea += a.x * b.y - b.x * a.y;
    }
    return smallest >= MIN_EDGE_PX && smallest / largest >= 0.2 && twiceArea >= MIN_EDGE_PX * MIN_EDGE_PX;
  }

  function checkImageData(image) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
        image.width <= 0 || image.height <= 0 || !image.data ||
        image.data.length !== image.width * image.height * 4) {
      throw new TypeError('detect() needs RGBA ImageData with matching positive width and height.');
    }
  }

  function copyDetection(value) {
    var result = { mode: value.mode, id: value.id, key: value.key };
    if (Array.isArray(value.corners)) {
      result.corners = value.corners.map(function (p) { return { x: p.x, y: p.y }; });
    }
    return result;
  }

  function compare(a, b) {
    return a.id - b.id || MODES.indexOf(a.mode) - MODES.indexOf(b.mode) ||
      KEYS[a.mode].indexOf(a.key) - KEYS[b.mode].indexOf(b.key) ||
      ((a.corners && a.corners[0].x) || 0) - ((b.corners && b.corners[0].x) || 0);
  }

  function createDetector() {
    // Upstream compares distance < tau. A threshold of 1 permits exact matches
    // only; deliberately no bit correction for this denser 5x5 dictionary.
    var detector = new AR.Detector({ dictionaryName: DICTIONARY, maxHammingDistance: 1 });
    return Object.freeze({
      /**
       * Returns every detected physical signal card, including another mode's
       * cards. Does not deduplicate distinct copies of one student's card:
       * classify() must see those conflicts. Image rotation does not select a
       * different key. A camera's mirrored preview must not mirror input pixels.
       */
      detect: function (image) {
        checkImageData(image);
        var found = detector.detect(image);
        var signals = [];
        for (var i = 0; i < found.length; i += 1) {
          var marker = found[i];
          if (marker.hammingDistance !== 0 || !validGeometry(marker.corners)) continue;
          var signal = fromMarkerId(marker.id);
          if (!signal) continue;
          signal.corners = marker.corners.map(function (p) { return { x: p.x, y: p.y }; });
          signals.push(signal);
        }
        return signals.sort(compare);
      }
    });
  }

  function rosterSet(ids) {
    if (!Array.isArray(ids) && !(ids instanceof Set)) throw new TypeError('Student IDs must be an array or Set.');
    var result = new Set();
    ids.forEach(function (id) { result.add(checkId(id)); });
    return result;
  }

  function allowedKeyFor(mode, options) {
    var key = options && options.allowedKey != null ? options.allowedKey : null;
    if (key !== null) checkKey(mode, key);
    return key;
  }

  function classifyWith(detections, mode, allowed, allowedKey) {
    if (!Array.isArray(detections)) throw new TypeError('Detections must be an array.');
    var groups = new Map();
    var result = { updates: [], unknown: [], wrongMode: [], otherKeys: [], ambiguous: [] };
    detections.forEach(function (item) {
      if (!item || MODES.indexOf(item.mode) < 0 || !Number.isInteger(item.id) || item.id < 1 ||
          item.id > STUDENTS || KEYS[item.mode].indexOf(item.key) < 0) return;
      if (!groups.has(item.id)) groups.set(item.id, []);
      groups.get(item.id).push(item);
    });

    groups.forEach(function (matches, id) {
      var isAllowed = allowed.has(id);
      if (!isAllowed) result.unknown.push(id);
      matches.forEach(function (item) {
        if (item.mode !== mode) result.wrongMode.push(copyDetection(item));
        else if (allowedKey !== null && item.key !== allowedKey) result.otherKeys.push(copyDetection(item));
      });
      // Check duplication BEFORE mode and key filtering. A second card of the
      // same student, even from the other mode, makes the frame ambiguous.
      if (matches.length !== 1) { result.ambiguous.push(id); return; }
      var item = matches[0];
      if (isAllowed && item.mode === mode && (allowedKey === null || item.key === allowedKey)) {
        result.updates.push(copyDetection(item));
      }
    });
    result.updates.sort(compare);
    result.unknown.sort(function (a, b) { return a - b; });
    result.wrongMode.sort(compare);
    result.otherKeys.sort(compare);
    result.ambiguous.sort(function (a, b) { return a - b; });
    return result;
  }

  /**
   * Stateless frame classification. unknown and ambiguous contain student IDs;
   * updates, wrongMode and otherKeys contain detection records. Diagnostics may
   * overlap: e.g. a card can belong to another mode AND an unregistered student.
   */
  function classify(detections, mode, ids, options) {
    checkMode(mode);
    return classifyWith(detections, mode, rosterSet(ids), allowedKeyFor(mode, options));
  }

  function createTracker(mode, ids, options) {
    checkMode(mode);
    options = options || {};
    var allowed = rosterSet(ids);
    var allowedKey = allowedKeyFor(mode, options);
    var minFrames = options.minFrames == null ? 3 : options.minFrames;
    var minDurationMs = options.minDurationMs == null ? 240 : options.minDurationMs;
    var expireMs = options.expireMs == null ? 700 : options.expireMs;
    if (!Number.isInteger(minFrames) || minFrames < 1 ||
        !Number.isFinite(minDurationMs) || minDurationMs < 0 ||
        !Number.isFinite(expireMs) || expireMs <= 0) {
      throw new RangeError('Tracker timings and minimum frame count must be positive; duration may be zero.');
    }
    var candidates = new Map();
    var accepted = new Map();

    return Object.freeze({
      /**
       * now is a monotonically increasing millisecond timestamp, e.g.
       * performance.now(). Identical timestamps cannot supply extra frames.
       * Missing, conflicting or ineligible detections break confirmation.
       * Once accepted, a new stable key replaces the old key. An unchanged
       * key is never emitted repeatedly, including after leaving the frame.
       */
      push: function (detections, now) {
        if (now == null) now = Date.now();
        if (!Number.isFinite(now)) throw new TypeError('Tracker timestamp must be finite.');
        var result = classifyWith(detections, mode, allowed, allowedKey);
        var present = new Set(result.updates.map(function (item) { return item.id; }));
        candidates.forEach(function (_, id) { if (!present.has(id)) candidates.delete(id); });
        var updates = [];
        result.updates.forEach(function (item) {
          var candidate = candidates.get(item.id);
          if (!candidate || candidate.key !== item.key || now < candidate.last || now - candidate.last > expireMs) {
            candidate = { key: item.key, count: 1, start: now, last: now };
          } else if (now > candidate.last) {
            candidate.count += 1;
            candidate.last = now;
          }
          candidates.set(item.id, candidate);
          if (candidate.count >= minFrames && now - candidate.start >= minDurationMs && accepted.get(item.id) !== item.key) {
            accepted.set(item.id, item.key);
            updates.push(copyDetection(item));
          }
        });
        result.updates = updates;
        return result;
      },
      reset: function () { candidates.clear(); accepted.clear(); }
    });
  }

  return Object.freeze({
    version: '2.0.0',
    keys: KEYS,
    markerId: markerId,
    fromMarkerId: fromMarkerId,
    markerSvg: markerSvg,
    createDetector: createDetector,
    classify: classify,
    createTracker: createTracker
  });
}));
