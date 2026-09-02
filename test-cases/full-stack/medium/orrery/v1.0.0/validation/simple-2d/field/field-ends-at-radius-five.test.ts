// field/field-ends-at-radius-five — no cell is drawn outside the field's radius.
//
// THE RULE. "The field is the hexagonal region of radius `FIELD_R` around
// `(0, 0)`: hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`. That is `91` hexes"
// (`specs/field.md`, Hexes and axial coordinates). "Exactly when" is the whole of
// the point: the ninety-one are drawn — "the field's hexes are visible enough to
// place parts by" (`specs/field.md`, Presentation) — and the hexes beyond them
// are not there to be drawn at all. `specs/editor.md` gives the field's region as
// "`x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y` `HEADING_H` (`48`)
// to `TAPE_Y0` (`560`)", which is where the question can be asked: outside it a
// build is drawing the tray, the readout, the heading or the tape panel, and what
// is there says nothing about the field.
//
// WHERE IT IS ASKED. Ring `6` — `max(|q|, |r|, |q + r|)` exactly `6` — is the
// first ring the rule excludes, and the sample disc is `16` about a computed
// center. That radius is what makes the reading unambiguous: adjacent centers are
// `HEX_PITCH` (`48`) apart and a pointy-top cell of that pitch reaches
// `HEX_PITCH / sqrt(3)` (`27.71`) to its vertex, so a point within `16` of a
// ring-`6` center is at least `20.29` outside any cell of the field. Only the
// ring-`6` hexes whose WHOLE disc lies inside the field's region are read; the
// rest are asking about somebody else's panel.
//
// THE VERDICT. Every sample in every one of those discs matches the sky — within
// `25` of a colour distance that runs to `441` over the whole RGB cube — so
// nothing of the field reaches ring `6`.
//
// AND THE FIELD WAS REALLY DRAWN. A build that drew nothing at all would pass a
// check that only asks for sky, so the same reading is taken the other way round
// on the ring-`5` hexes that border the discs: each of them differs from the sky
// somewhere within `HEX_PITCH / 2` (`24`) of its center, which is its own cell.
// The pair is one statement — the field is drawn out to radius `FIELD_R` and
// stops there.
//
// THE SKY IS READ AS THE DARKEST OF FOUR PATCHES of the field's region that no
// hex of the field or of ring `6` reaches: `specs/assets.md` puts every sprite on
// "the dark sky", so the darkest patch is the one nothing was drawn over, and
// four of them means a build is free to seat something in any one band.
//
// THE WORLD IS POSED, NOT SEARCHED. The challenge is loaded into the editor with
// an empty machine and no run at all, so there is no part, no mote and no fixture
// anywhere on the field — nothing but the field itself to draw.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertLessThanOrEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { FIELD_CX, FIELD_CY, FIELD_R, HEX_PITCH } from "../constants";
import {
  at,
  contains,
  FIELD_REGION,
  hexCenter,
  onField,
  type Hex,
  type StagePoint,
} from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  darkestOf,
  discPoints,
  openChallengeDocument,
  rgbOf,
  type Harness,
  type Rgb,
} from "../harness";

let h: Harness;

/** How near a sample must land on the sky, of the `441` the RGB cube spans. */
const SKY_TOLERANCE = 25;

/** The radius about a ring-6 center every sample is taken within. */
const SKY_DISC_R = 16;

/** Four patches of the field's region no field hex and no ring-6 hex reaches. */
const SKY_PATCHES: readonly StagePoint[] = [
  { x: 286, y: FIELD_CY },
  { x: 946, y: FIELD_CY },
  { x: FIELD_CX, y: 58 },
  { x: FIELD_CX, y: 550 },
];

/** Every hex at exactly `ring` from the origin, in reading order. */
function ringHexes(ring: number): Hex[] {
  const hexes: Hex[] = [];
  for (let r = -ring; r <= ring; r += 1) {
    for (let q = -ring; q <= ring; q += 1) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === ring) {
        hexes.push(at(q, r));
      }
    }
  }
  return hexes;
}

/** The six neighbours of a hex, whichever of them are on the field. */
function fieldNeighbours(hex: Hex): Hex[] {
  return [
    at(hex.q + 1, hex.r),
    at(hex.q, hex.r + 1),
    at(hex.q - 1, hex.r + 1),
    at(hex.q - 1, hex.r),
    at(hex.q, hex.r - 1),
    at(hex.q + 1, hex.r - 1),
  ].filter(onField);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every ring-6 hex inside the field region as bare sky", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await h.advance(1);
  await captureStill(h, "edge");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.editor.parts,
    0,
    "the machine is empty, so nothing but the field itself is drawn on it",
  );

  const sky: Rgb = await darkestOf(h, SKY_PATCHES);

  const beyond = ringHexes(FIELD_R + 1).filter((hex) =>
    discPoints(hexCenter(hex).x, hexCenter(hex).y, SKY_DISC_R).every((point) =>
      contains(FIELD_REGION, point),
    ),
  );
  assertGreaterThan(
    beyond.length,
    0,
    "some ring-6 hex has its whole sample disc inside the field's region",
  );

  const borders = new Map<string, Hex>();
  for (const hex of beyond) {
    for (const neighbour of fieldNeighbours(hex)) {
      borders.set(`${neighbour.q},${neighbour.r}`, neighbour);
    }
  }

  for (const hex of beyond) {
    const center = hexCenter(hex);
    const disc = discPoints(center.x, center.y, SKY_DISC_R);
    const pixels = await h.pixels(disc);
    let worst = 0;
    for (const pixel of pixels) {
      worst = Math.max(worst, colorDistance(rgbOf(pixel), sky));
    }
    assertLessThanOrEqual(
      worst,
      SKY_TOLERANCE,
      `(${hex.q}, ${hex.r}) is outside max(|q|, |r|, |q + r|) <= FIELD_R, so every sample within ${SKY_DISC_R} of its center is sky`,
    );
  }

  for (const hex of borders.values()) {
    const center = hexCenter(hex);
    const pixels = await h.pixels(
      discPoints(center.x, center.y, HEX_PITCH / 2),
    );
    let worst = 0;
    for (const pixel of pixels) {
      worst = Math.max(worst, colorDistance(rgbOf(pixel), sky));
    }
    assertGreaterThan(
      worst,
      SKY_TOLERANCE,
      `(${hex.q}, ${hex.r}) is on the field, so its cell is drawn rather than left as sky`,
    );
  }
});
