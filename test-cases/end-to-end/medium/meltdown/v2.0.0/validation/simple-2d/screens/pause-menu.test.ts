// screens/pause-menu — the pause screen offers its three rows, and the floor is
// still drawn behind them.
//
// THE RULE. specs/screens.md's `paused` section: it "Draws the three rows of
// `PAUSE_ITEMS`: `RESUME`, `RESTART`, and `QUIT TO MENU`. The floor is still drawn
// behind the menu."
//
// THE COPY IS THE CASE'S. `PAUSE_ITEMS` lives in `constants.ts`, transcribed
// from specs/screens.md, so the three exact strings are read off the frame, by
// substring and ignoring case, because a row is commonly drawn with a marker or
// padding around it.
//
// HOW "THE FLOOR IS STILL DRAWN BEHIND" IS DECIDED. Not by a colour, because
// specs/overview.md fixes no palette, and not by comparing the paused frame with a
// running one, because a pause screen is free to dim what it covers. What is
// compared is two PAUSED frames of the same screen that differ only in what is
// standing on the floor: four towers are posed at the corners of the grid and
// read, then removed and the same four points read again. If the floor behind the
// menu is being drawn, those points are painted differently with the towers there;
// if the menu is drawn over a blank ground, they are painted identically whatever
// the floor holds.
//
// THE PROBES ARE AT THE CORNERS AND THREE OF THE FOUR MUST ANSWER. A build is free
// to put its menu anywhere on the stage, and a wide panel can legitimately cover a
// corner of the floor; four corners spread to the ends of a `50 x 36` grid cannot
// all be under one menu, so requiring three leaves a build its layout while still
// failing a screen that hides the floor completely.
//
// WHAT PAUSING DOES TO THE SIMULATION is not read here: that the floor FREEZES is
// `waves.pause-freezes-the-floor`'s requirement, measured over two windows of the
// build's own clock. This item is about the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  poseTower,
  sampleColor,
  towerCentre,
  towerOf,
  type Harness,
  type Point,
} from "../harness";
import { drewText } from "../case-harness/text";
import { poseMenu } from "./menu";

/** The row the screen is posed on: the first, which is where a menu opens. */
const OPENING_ROW = 0;

/**
 * Where the four probe towers stand: the four corners of the grid.
 *
 * Each is the top-left tile of a `2 x 2` footprint, two tiles in from the edge of
 * a `50 x 36` grid, so all four sit on open floor and as far apart as the floor
 * allows.
 */
const PROBES: readonly { col: number; row: number }[] = [
  { col: 2, row: 2 },
  { col: 45, row: 2 },
  { col: 2, row: 32 },
  { col: 45, row: 32 },
];

/** The tower posed at each probe: the cheapest emitter, and a plain one. */
const PROBE_TOWER = "arc";

/**
 * How far apart, out of the 441 the RGB cube spans, a probe must read with a tower
 * on it and without one for the floor to count as drawn there.
 *
 * A pause screen may dim the floor behind it as heavily as it likes, and a scrim
 * that leaves a fifth of what is underneath cuts every difference on the floor to
 * a fifth as well. 6 is under one and a half per cent of the scale: below any
 * difference a tower against bare floor survives such a scrim as, and far above
 * the 0 a screen that draws no floor at all reads at every probe.
 *
 * It is deliberately SLACKER than the 8 specs/overview.md now states for a thing
 * being visible against what is behind it — that sentence was added after this
 * check was written, and this check is not tightened onto it: 6 leaves a build
 * room at the line rather than failing it for a rounding, and what it still
 * catches is the thing specs/screens.md forbids, a screen with no floor behind
 * the menu at all.
 */
const FLOOR_VISIBLE_MIN = 6;

/** How many of the four probes must answer, leaving the menu a corner to cover. */
const PROBES_ANSWERING_MIN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the three pause rows", async () => {
  poseMenu(h, "paused", OPENING_ROW);
  const calls = await drawFrame(h);
  captureStill(h, "pause");

  assertEqual(
    h.snapshot().screen,
    "paused",
    "posing: the screen the rows are read from (specs/screens.md)",
  );
  for (const item of PAUSE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the ${JSON.stringify(item)} row of PAUSE_ITEMS drawn on the pause ` +
        `screen (specs/screens.md)`,
    );
  }
});

it("still draws the floor behind the pause menu", async () => {
  poseMenu(h, "paused", OPENING_ROW);

  // Four towers at the corners of the grid, and where each of them was drawn.
  const at: Point[] = [];
  for (const probe of PROBES) {
    const id = poseTower(h, PROBE_TOWER, probe.col, probe.row);
    at.push(towerCentre(towerOf(h.snapshot(), id)));
  }
  await h.advance(1);
  captureStill(h, "pause");
  const standing = at.map((point) => sampleColor(h, point.x, point.y));

  // The same paused screen with nothing on the floor. `clearTowers` removes every
  // tower and pays no refund (specs/instrumentation.md), so the only thing that
  // changed between the two frames is what the floor holds.
  h.debug.clearTowers();
  await h.advance(1);
  const bare = at.map((point) => sampleColor(h, point.x, point.y));

  assertEqual(
    h.snapshot().screen,
    "paused",
    "posing: both readings were taken on the pause screen (specs/screens.md)",
  );

  const readings = standing.map((colour, index) =>
    colorDistance(colour, bare[index]),
  );
  const answering = readings.filter(
    (reading) => reading >= FLOOR_VISIBLE_MIN,
  ).length;
  assertGreaterThanOrEqual(
    answering,
    PROBES_ANSWERING_MIN,
    `the corners of the floor that were painted differently with a tower ` +
      `standing on them than without, with the pause menu open — the floor ` +
      `is still drawn behind the menu (specs/screens.md); the readings were ` +
      `[${readings.map((value) => value.toFixed(1)).join(", ")}] at a bar of ` +
      `${FLOOR_VISIBLE_MIN} out of 441`,
  );
});
