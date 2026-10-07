// presentation/mote-paint-stays-within-mote-r — what a mote adds to the frame is
// inside `MOTE_R` of the mote, and nothing further out moves.
//
// THE RULE. "Every mote's drawn form fits inside this radius of its position"
// (`specs/field.md`, the `MOTE_R` row, `22`), restated in the art bar of
// `specs/assets.md`: "Every mote's paint stays inside `MOTE_R` (`22`) of its
// center, so motes on adjacent hexes never blur together." Adjacent hex centres
// are `HEX_PITCH` (`48`) apart, so two forms of radius `22` leave four units of
// sky between them; paint reaching further closes that gap.
//
// WHAT THIS READS, AND HOW IT DIFFERS FROM THE FILE. `assets/mote-paint-within-mote-r`
// reads the produced FILE and finds no painted pixel outside the radius on its
// canvas. This reads the FRAME, which is the drawn form the rule is about: a build
// that produced a tidy file and then drew it at twice its size, or drew a glow
// around it in code, has a drawn form larger than its file. The reading is a
// difference of two frames of the same scene — one with the mote on the field and
// one with it removed, everything else untouched — so what is measured is the
// mote's own contribution and not the field drawn under it.
//
// WHAT COUNTS AS A PIXEL "MORE THAN MOTE_R FROM ITS POSITION" is the art bar's
// own next clause: "The radius bounds the form drawn rather than the pixels it
// lands on: a form drawn to `MOTE_R` meets the bound wherever a hex center falls
// between two pixels, and paint sits outside the radius only where the whole of a
// pixel does" (`specs/assets.md`). A pixel covers an area rather than a point, so
// it is outside the radius only when the distance from the mote's position to the
// NEAREST point of the pixel's square is more than `MOTE_R`. That leaves the
// verdict where the rule puts it, on the form rather than on the resampling —
// `hexY` is not a whole number for most rows.
//
// A MOTIONLESS BUILD DOES NOT PASS THIS. A frame that drew nothing for the mote
// differs from the frame without it nowhere at all, and would clear an "outside
// the radius" reading trivially, so the check first reads back that the mote's
// presence changed the frame.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the
// completion switch held off, a live run, an EMPTY FIELD — with one `sol` spawned
// back on `(1, 1)` and nothing else, and the reading taken over the square of
// `HEX_PITCH` (`48`) either side of it, which reaches the centres of all six
// adjacent hexes.
//
// THE EVIDENCE is the frame with the mote on it, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HEX_PITCH, MOTE_R } from "../constants";
import { at, hexCenter } from "../field";
import { BARE } from "../fixtures";
import {
  CHANNEL_EPSILON,
  captureStill,
  createHarness,
  openBareRun,
  pixelAt,
  spawnMote,
  type Harness,
  type PixelRect,
} from "../harness";

/** The hex the lone mote rests on, and the type it is. */
const SPOT = at(1, 1);
const TYPE = "sol";

/** How far from the mote the frame is read: out to the adjacent hex centres. */
const REACH = HEX_PITCH;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes no pixel outside MOTE_R of the mote, and does change pixels inside it", async () => {
  const centre = hexCenter(SPOT);
  const x0 = Math.round(centre.x) - REACH;
  const y0 = Math.round(centre.y) - REACH;
  const side = REACH * 2;

  await openBareRun(h, { challenge: BARE });
  const mote = await spawnMote(h, SPOT, TYPE);
  await h.advance(1);
  const withMote = await h.pixelRect(x0, y0, side, side);
  await captureStill(h, "radius");

  await h.debug.removeMote(mote);
  await h.advance(1);
  const without = await h.pixelRect(x0, y0, side, side);

  /** Whether the two readings hold different colour at one pixel. */
  const moved = (a: PixelRect, b: PixelRect, x: number, y: number): boolean => {
    const left = pixelAt(a, x, y);
    const right = pixelAt(b, x, y);
    return left.some(
      (channel, index) => Math.abs(channel - right[index]) > CHANNEL_EPSILON,
    );
  };

  /** The distance from the mote's position to the nearest point of a pixel. */
  const nearestOf = (x: number, y: number): number => {
    const left = x0 + x;
    const top = y0 + y;
    const dx = Math.max(0, left - centre.x, centre.x - (left + 1));
    const dy = Math.max(0, top - centre.y, centre.y - (top + 1));
    return Math.hypot(dx, dy);
  };

  let inside = 0;
  let outside = 0;
  let furthest = 0;
  for (let y = 0; y < withMote.height; y += 1) {
    for (let x = 0; x < withMote.width; x += 1) {
      if (!moved(withMote, without, x, y)) continue;
      const near = nearestOf(x, y);
      if (near > MOTE_R) {
        outside += 1;
        if (near > furthest) furthest = near;
      } else {
        inside += 1;
      }
    }
  }

  assertGreaterThan(
    inside,
    0,
    "pixels within MOTE_R (22) of the mote's position that the mote's presence changed, so the frame drew the mote at all",
  );
  assertEqual(
    outside,
    0,
    `pixels further than MOTE_R (22) from the mote's position that the mote's presence changed, the furthest of them ${furthest.toFixed(2)} away`,
  );
});
