/*
 * Bitaqati card reader, v1.0.0.
 * Uses the locally bundled js-aruco2 2.0.0 (MIT; full upstream notices in
 * vendor/LICENSE-js-aruco2.txt). No camera access or network requests here.
 * Load vendor/cv.js, vendor/aruco.js, then this file as classic scripts.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/aruco.js').AR, require('./vendor/cv.js').CV);
  } else {
    root.CardVision = factory(root.AR, root.CV);
  }
}(typeof window !== 'undefined' ? window : globalThis, function (AR, CV) {
  'use strict';

  if (!AR || !AR.Detector || !AR.Dictionary || !CV || !CV.square2quad) {
    throw new Error('CardVision requires vendor/cv.js and vendor/aruco.js first.');
  }

  var CARD_COUNT = 40;
  var DICTIONARY = 'ARUCO_MIP_36h12';
  var LETTERS = ['A', 'B', 'C', 'D'];
  var EDGE_POINTS = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  var MAX_TILT = Math.PI / 6; // 30 degrees from image-up.
  var MIN_ANGLE_GAP = Math.PI / 9; // At least 20 degrees ahead of next edge.
  var MIN_EDGE_PX = 24;
  var MAX_BIT_ERRORS = 2;
  var dictionary = new AR.Dictionary(DICTIONARY);

  function checkedCardId(id) {
    if (!Number.isInteger(id) || id < 1 || id > CARD_COUNT) {
      throw new RangeError('Card number must be an integer from 1 to 40.');
    }
    return id;
  }

  /**
   * A white-margin, black/white SVG. Its reference edges are A top, B right,
   * C bottom, D left. Add the printed number/letters outside this SVG.
   * App card 1 is dictionary marker 0; app card 40 is marker 39.
   */
  function markerSvg(id) {
    checkedCardId(id);
    return dictionary.generateSVG(id - 1).replace(
      '<svg ',
      '<svg width="240" height="240" shape-rendering="crispEdges" role="img" aria-label="علامة البطاقة ' + id + '" '
    );
  }

  function cross(a, b, c) {
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  }

  function geometry(corners) {
    if (!Array.isArray(corners) || corners.length !== 4) return null;
    for (var i = 0; i < 4; i += 1) {
      if (!corners[i] || !Number.isFinite(corners[i].x) || !Number.isFinite(corners[i].y)) return null;
    }
    var smallest = Infinity;
    var largest = 0;
    var twiceArea = 0;
    for (var j = 0; j < 4; j += 1) {
      var a = corners[j];
      var b = corners[(j + 1) % 4];
      var c = corners[(j + 2) % 4];
      // Canonical corner order is clockwise in image coordinates (y down).
      if (cross(a, b, c) <= 0) return null;
      var edge = Math.hypot(b.x - a.x, b.y - a.y);
      smallest = Math.min(smallest, edge);
      largest = Math.max(largest, edge);
      twiceArea += a.x * b.y - b.x * a.y;
    }
    var area = twiceArea / 2;
    if (smallest < MIN_EDGE_PX || smallest / largest < 0.2 || area < MIN_EDGE_PX * MIN_EDGE_PX / 2) return null;
    return { area: area };
  }

  function project(h, u, v) {
    var w = h[6] * u + h[7] * v + h[8];
    if (!Number.isFinite(w) || w <= 1e-8) return null;
    var x = (h[0] * u + h[1] * v + h[2]) / w;
    var y = (h[3] * u + h[4] * v + h[5]) / w;
    return Number.isFinite(x) && Number.isFinite(y) ? { x: x, y: y } : null;
  }

  function answerFromCorners(corners) {
    // Do not sort these corners by screen position: the detector has already
    // attached them to the marker's original TL, TR, BR, BL corners.
    var h = CV.square2quad(corners);
    if (!h || h.length !== 9 || !h.every(Number.isFinite)) return null;
    var center = project(h, 0.5, 0.5);
    if (!center) return null;
    var directions = [];
    for (var i = 0; i < 4; i += 1) {
      var edge = project(h, EDGE_POINTS[i][0], EDGE_POINTS[i][1]);
      if (!edge) return null;
      var dx = edge.x - center.x;
      var dy = edge.y - center.y;
      if (Math.hypot(dx, dy) < 4) return null;
      directions.push({ answer: LETTERS[i], angle: Math.atan2(Math.abs(dx), -dy) });
    }
    directions.sort(function (a, b) { return a.angle - b.angle; });
    // A tilted/ambiguous card is omitted, rather than assigned arbitrarily.
    if (directions[0].angle > MAX_TILT || directions[1].angle - directions[0].angle < MIN_ANGLE_GAP) return null;
    return directions[0].answer;
  }

  function validateImageData(imageData) {
    if (!imageData || !Number.isInteger(imageData.width) || !Number.isInteger(imageData.height) ||
        imageData.width <= 0 || imageData.height <= 0 || !imageData.data ||
        imageData.data.length !== imageData.width * imageData.height * 4) {
      throw new TypeError('detect() needs RGBA ImageData with matching positive width and height.');
    }
  }

  function createDetector() {
    // Upstream uses distance < maxHammingDistance, so 3 accepts 0, 1, or 2.
    // This is intentionally stricter than the dictionary's default of 12.
    var detector = new AR.Detector({
      dictionaryName: DICTIONARY,
      maxHammingDistance: MAX_BIT_ERRORS + 1
    });

    return Object.freeze({
      /**
       * Synchronous and stateless per frame. Input pixels must be unmirrored.
       * Returns unique, ascending app IDs. Caller handles multi-frame stability.
       * No detection means []; malformed image data raises TypeError.
       */
      detect: function (imageData) {
        validateImageData(imageData);
        var found = detector.detect(imageData);
        var selected = new Map();
        var conflicts = new Set();
        for (var i = 0; i < found.length; i += 1) {
          var marker = found[i];
          if (!Number.isInteger(marker.id) || marker.id < 0 || marker.id >= CARD_COUNT ||
              !Number.isFinite(marker.hammingDistance) || marker.hammingDistance > MAX_BIT_ERRORS) continue;
          var shape = geometry(marker.corners);
          if (!shape) continue;
          var answer = answerFromCorners(marker.corners);
          if (!answer) continue;
          var id = marker.id + 1;
          if (conflicts.has(id)) continue;
          var previous = selected.get(id);
          if (previous && previous.answer !== answer) {
            selected.delete(id);
            conflicts.add(id);
            continue;
          }
          if (previous && (previous.bitErrors < marker.hammingDistance ||
              (previous.bitErrors === marker.hammingDistance && previous.area >= shape.area))) continue;
          selected.set(id, {
            id: id,
            answer: answer,
            corners: marker.corners.map(function (corner) { return { x: corner.x, y: corner.y }; }),
            area: shape.area,
            bitErrors: marker.hammingDistance
          });
        }
        return Array.from(selected.values()).sort(function (a, b) { return a.id - b.id; }).map(function (marker) {
          return { id: marker.id, answer: marker.answer, corners: marker.corners };
        });
      }
    });
  }

  return Object.freeze({ createDetector: createDetector, markerSvg: markerSvg });
}));
