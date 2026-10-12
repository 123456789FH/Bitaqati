# CardVision integration

The production reader is `dist/vision.js`. Its only dependencies are the two
locally bundled, unmodified js-aruco2 2.0.0 source files. Load classic scripts in
this order (all three may use `defer` in this order):

```html
<script src="vendor/cv.js" defer></script>
<script src="vendor/aruco.js" defer></script>
<script src="vision.js" defer></script>
```

```js
const detector = window.CardVision.createDetector();
const markers = detector.detect(context.getImageData(0, 0, width, height));
// [{ id: 1, answer: 'A', corners: [{x, y}, {x, y}, {x, y}, {x, y}] }]

const svg = window.CardVision.markerSvg(1); // Integer from 1 through 40.
```

## Card layout and direction

Use A at the top, B at the right, C at the bottom and D at the left of the
returned SVG. Keep the SVG square and retain its white quiet margin. Put the
card number and answer letters **outside** the SVG; do not put text over any
part of its black/white grid or white margin. The marker takes 80% of the SVG
width. For printing, set the SVG's width and height to the same physical size.

The app uses the first 40 markers of `ARUCO_MIP_36h12`, with application card
number equal to dictionary index plus one. These are ArUco markers, not Plickers
codes; existing Plickers cards are not inputs to this reader.

Corners retain the identity of the original SVG's top-left, top-right,
bottom-right and bottom-left corners. Do not sort them by their current image
position. A clockwise physical turn maps 0°→A, 90°→D, 180°→C, 270°→B.

The detector compares projected center-to-edge directions, accepting an edge
only within 30° of image-up and at least 20° ahead of the next edge. This avoids
assigning a letter to a card halfway between choices. These are image-space
criteria, not a promise to measure a physical 3D roll angle. Very small or
strongly foreshortened quadrilaterals are omitted.

## Frame handling

Pass ordinary, **unmirrored** RGBA `ImageData`. CSS mirroring of a preview alone
is separate from the pixels passed to the detector. Do not flip the input pixels
and attempt to compensate by swapping B/D: that changes the encoded marker.

The API is synchronous and returns only accepted cards, sorted by card number.
It returns `[]` for an empty/unreadable/ambiguous frame, and throws `TypeError`
for malformed image data. Duplicate instances of one ID with different answers
are omitted for that frame. It makes no network calls and requests no camera
permission. Camera setup, image resizing, scan scheduling, and answer stability
over successive frames belong to the application. Omitted detections must not
be interpreted as a new answer.

The library's Hamming threshold is exclusive (`distance < tau`). The wrapper
sets it to 3, permitting at most two corrupted payload cells. It also ignores
dictionary markers outside application cards 1–40.

## Provenance and notices

- Upstream: https://github.com/damianofalcioni/js-aruco2
- Pinned package: https://www.npmjs.com/package/js-aruco2/v/2.0.0
- Source distribution: https://cdn.jsdelivr.net/npm/js-aruco2@2.0.0/
- Complete upstream notices: `dist/vendor/LICENSE-js-aruco2.txt`
- Exact download URLs, byte lengths and SHA-256 hashes: `dist/vendor/manifest.json`

Keep the bundled license/notices file and source copyright headers when
publishing. The package declares MIT and includes additional upstream notices,
which are retained in full. No vendor code has been modified.

## Verification

Run `node tests/vision.test.cjs` with `sharp` installed. The test has a fallback
for the supplied workspace runtime's `CODEX_PRIMARY_RUNTIME_NODE_MODULES`.
It renders the actual public SVG output to pixels and runs the real detector;
it does not mock recognition. Perspective fixtures use an independent inverse
homography with bilinear sampling.

`vision-report.json` records 261 passing image cases, including all 40 IDs at
all four cardinal orientations, downsampling, perspective, moderate roll,
ambiguous roll, payload corruption, unknown IDs, blank frames, several cards,
and conflicting duplicate IDs. These are synthetic-image tests. They do not
replace a physical printed-card/camera check in the classroom's lighting and
distances.

`fixtures/cards-four-orientations.png` is a convenient upload test image:
card 1=A, card 8=D, card 21=C, card 40=B. Test fixtures are outside `dist` and are
not required in the deployed site.
