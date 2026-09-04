// presentation/vents-and-exhausts-read-apart — a way in is not a way out.
//
// THE RULE. specs/overview.md's legibility table: "a vent and an exhaust read
// apart from each other and from the casing, and an exhaust reads as dangerous."
// The two openings do opposite things to a player: specs/surge.md has a unit
// enter at a vent, and reaching its exhaust costs lives that never come back.
// specs/floor.md is what puts each of the four where it is — the left vent on
// rows 16 to 19, the right exhaust on the same rows, the top vent on columns 22
// to 29 and the bottom exhaust on the same columns — so a check knows exactly
// which stretch of casing to read and which stretch is plain wall.
//
// ALL FOUR ARE READ, AS TWO KINDS. Every vent is read against every exhaust,
// because a player who cannot tell the top vent from the bottom exhaust is in the
// same trouble as one who cannot tell the left vent from the right one; and each
// of the four is read against the plain casing on its own wall, because an
// opening a player cannot pick out of the wall is an opening they will not plan
// around.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette, and in particular it does not say an exhaust is red. Every reading is
// a comparison between two things the BUILD drew. That an exhaust "reads as
// dangerous" is not measurable as a distance and is left to the reviewer's eye;
// what is measurable, and what this point asserts, is that it does not read as
// the vent or as the wall.
//
// WHERE THE READINGS ARE TAKEN. At the band's mid-depth, nine units in, on the
// middle of each opening's run, and on a plain rank of the same wall well clear
// of it. Each is a small cluster rather than one pixel, so a rivet or a grille
// line a build drew cannot decide it.
//
// WHAT IT DOES NOT DECIDE. Which rows and columns each opening spans is the
// `floor` group's — `floor.left-vent-rows` and its three siblings. That the band
// between the openings is unbroken is `floor.casing-band`, and how far apart the
// wall and the floor read is `casing-reads-as-a-wall`.

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
  type Rgb,
} from "../harness";
import { showRgb, spotColor } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, two of these readings must sit.
 *
 * The suite's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at.
 */
const APART_MIN = 50;

/** Where in the band a reading is taken, in units from the wall's outer face. */
const BAND_DEPTH = CASING / 2;

/** One opening: which kind it is, where it is read, and the wall beside it. */
interface Opening {
  name: string;
  kind: "vent" | "exhaust";
  at: Point;
  wall: Point;
}

/** The middle of a run of ranks. */
function middle(run: readonly number[]): number {
  return run[Math.floor(run.length / 2)];
}

const OPENINGS: readonly Opening[] = [
  {
    name: "the left vent",
    kind: "vent",
    at: { x: BAND_DEPTH, y: tileCY(middle(LEFT_VENT_ROWS)) },
    wall: { x: BAND_DEPTH, y: tileCY(6) },
  },
  {
    name: "the top vent",
    kind: "vent",
    at: { x: tileCX(middle(TOP_VENT_COLS)), y: BAND_DEPTH },
    wall: { x: tileCX(8), y: BAND_DEPTH },
  },
  {
    name: "the right exhaust",
    kind: "exhaust",
    at: { x: PANEL_X - BAND_DEPTH, y: tileCY(middle(RIGHT_EXHAUST_ROWS)) },
    wall: { x: PANEL_X - BAND_DEPTH, y: tileCY(29) },
  },
  {
    name: "the bottom exhaust",
    kind: "exhaust",
    at: { x: tileCX(middle(BOTTOM_EXHAUST_COLS)), y: STAGE_H - BAND_DEPTH },
    wall: { x: tileCX(40), y: STAGE_H - BAND_DEPTH },
  },
];

/** Each opening, and the plain wall on its own side, as they were drawn. */
function readOpenings(h: Harness): { opening: Opening; cut: Rgb; wall: Rgb }[] {
  return OPENINGS.map((opening) => ({
    opening,
    cut: spotColor(h, opening.at.x, opening.at.y),
    wall: spotColor(h, opening.wall.x, opening.wall.y),
  }));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a vent plainly apart from an exhaust", async () => {
  startRun(h);
  await h.advance(1);
  captureStill(h, "openings");

  const read = readOpenings(h);
  for (const vent of read.filter((r) => r.opening.kind === "vent")) {
    for (const exhaust of read.filter((r) => r.opening.kind === "exhaust")) {
      assertGreaterThanOrEqual(
        colorDistance(vent.cut, exhaust.cut),
        APART_MIN,
        `${vent.opening.name} (${showRgb(vent.cut)}) against ` +
          `${exhaust.opening.name} (${showRgb(exhaust.cut)}), out of 441 ` +
          `(specs/overview.md: a vent and an exhaust read apart from each ` +
          `other)`,
      );
    }
  }
});

it("draws each opening plainly apart from the casing around it", async () => {
  startRun(h);
  await h.advance(1);

  for (const { opening, cut, wall } of readOpenings(h)) {
    assertGreaterThanOrEqual(
      colorDistance(cut, wall),
      APART_MIN,
      `${opening.name} (${showRgb(cut)}) against the plain casing on its own ` +
        `wall (${showRgb(wall)}), out of 441 (specs/overview.md: a vent and ` +
        `an exhaust read apart from the casing)`,
    );
  }
});
