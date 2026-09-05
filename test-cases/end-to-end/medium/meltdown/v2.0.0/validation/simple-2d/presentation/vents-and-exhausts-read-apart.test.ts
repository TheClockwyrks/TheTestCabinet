// presentation/vents-and-exhausts-read-apart — an opening is drawn on the wall it
// is cut into.
//
// THE RULE. specs/overview.md's legibility table: "a vent and an exhaust read
// apart from each other and from the casing, and an exhaust reads as dangerous."
// What a check can decide of that is the middle clause, and only as presence: the
// build drew SOMETHING in each opening's stretch of the band that it did not draw
// on the plain casing beside it. How far a vent reads from an exhaust, and
// whether an exhaust reads as dangerous, are appearance — specs/overview.md hands
// the palette, the type and the glow to the build — and the reviewer's
// presentation rating is what judges them.
//
// WHERE THE OPENINGS ARE. specs/floor.md puts each of the four where it is — the
// left vent on rows 16 to 19, the right exhaust on the same rows, the top vent on
// columns 22 to 29 and the bottom exhaust on the same columns — so a check knows
// exactly which stretch of casing to read and which stretch is plain wall.
//
// WHERE THE READINGS ARE TAKEN, AND WHERE THE BAR COMES FROM. At the band's
// mid-depth, nine units in, on the middle of each opening's run, and on two plain
// ranks of the SAME wall well clear of it — one either side, because a build is
// free to shade its casing and a reference from another wall would be reading
// that shading. Each is a small cluster rather than one pixel, so a rivet or a
// grille line a build drew cannot decide it. The bar is that wall's own
// variation, measured rather than stated: how far the two plain readings sit from
// each other is how much the build's art moves the band on its own, and the
// opening has to sit further from both of them than that, by `NOISE_MARGIN`.
//
// WHAT IT DOES NOT DECIDE. Which rows and columns each opening spans is the
// `floor` group's — `floor.left-vent-rows` and its three siblings. That the band
// between the openings is unbroken is `floor.casing-band`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  BOTTOM_EXHAUST_COLS,
  CASING,
  LEFT_VENT_ROWS,
  PANEL_X,
  RIGHT_EXHAUST_ROWS,
  STAGE_H,
  TOP_VENT_COLS,
  tileCX,
  tileCY,
} from "../constants";
import type { Point } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { NOISE_MARGIN, showRgb, spotColor } from "./read";

/** Where in the band a reading is taken, in units from the wall's outer face. */
const BAND_DEPTH = CASING / 2;

/** One opening: where it is read, and the two plain ranks of its own wall. */
interface Opening {
  name: string;
  at: Point;
  wall: readonly [Point, Point];
}

/** The middle of a run of ranks. */
function middle(run: readonly number[]): number {
  return run[Math.floor(run.length / 2)];
}

const OPENINGS: readonly Opening[] = [
  {
    name: "the left vent",
    at: { x: BAND_DEPTH, y: tileCY(middle(LEFT_VENT_ROWS)) },
    wall: [
      { x: BAND_DEPTH, y: tileCY(6) },
      { x: BAND_DEPTH, y: tileCY(29) },
    ],
  },
  {
    name: "the top vent",
    at: { x: tileCX(middle(TOP_VENT_COLS)), y: BAND_DEPTH },
    wall: [
      { x: tileCX(8), y: BAND_DEPTH },
      { x: tileCX(40), y: BAND_DEPTH },
    ],
  },
  {
    name: "the right exhaust",
    at: { x: PANEL_X - BAND_DEPTH, y: tileCY(middle(RIGHT_EXHAUST_ROWS)) },
    wall: [
      { x: PANEL_X - BAND_DEPTH, y: tileCY(6) },
      { x: PANEL_X - BAND_DEPTH, y: tileCY(29) },
    ],
  },
  {
    name: "the bottom exhaust",
    at: { x: tileCX(middle(BOTTOM_EXHAUST_COLS)), y: STAGE_H - BAND_DEPTH },
    wall: [
      { x: tileCX(8), y: STAGE_H - BAND_DEPTH },
      { x: tileCX(40), y: STAGE_H - BAND_DEPTH },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each opening on the casing it is cut into", async () => {
  startRun(h);
  await h.advance(1);
  captureStill(h, "openings");

  for (const opening of OPENINGS) {
    const cut = spotColor(h, opening.at.x, opening.at.y);
    const wall = opening.wall.map((at) => spotColor(h, at.x, at.y));
    const spread = colorDistance(wall[0], wall[1]);
    const drawn = Math.min(...wall.map((plain) => colorDistance(cut, plain)));

    assertGreaterThanOrEqual(
      drawn,
      spread + NOISE_MARGIN,
      `${opening.name} (${showRgb(cut)}): something is drawn there that the ` +
        `plain casing on its own wall (${showRgb(wall[0])} and ` +
        `${showRgb(wall[1])}) does not carry — further from both of them than ` +
        `the ${spread} that plain casing varies by on its own ` +
        `(specs/overview.md: a vent and an exhaust read apart from the ` +
        `casing; specs/floor.md puts the opening on those ranks)`,
    );
  }
});
