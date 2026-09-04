// status-bar/maze-length-follows-the-route — the drawn maze length moves the moment a wall lands.
//
// `specs/hud.md` puts "the current maze length, in tiles, as `specs/pathing.md`
// defines it" in the bar, and requires that it "updates the instant a placement
// or a dismantle changes the route". `specs/pathing.md` defines that figure as the
// total length of the ground route from the entry through every waypoint to the
// collector, and states that "every wall the route must go around lengthens that
// route".
//
// TWO CLAIMS, TWO POINTS. A bar that draws a correct figure and never moves it is
// indistinguishable from one carrying no maze read at all if both are decided
// together, and the two failures cost the player different things: the first
// misleads them only after they build, the second tells them nothing at all. So
// `maze-length-drawn` decides the read and `maze-length-follows-the-route`
// decides that it moves.
//
// THE TOLERANCE IS A WHOLE TILE, because a route length is a real number — a leg
// walked diagonally measures `sqrt(2)` a step — and a build is free to round it
// for the player.
//
// THE WALL. The Substation's first leg runs the entry at `(0, 5)` straight along
// row `5` to `WP1`. Four blockers stacked at column `20` close columns `20`–`21`
// from row `0` to row `7`, so that leg has to descend below the wall and climb
// back: several tiles longer, and far more than the tolerance. Rows `8`–`32` stay
// open, so the never-seal rule of `specs/pathing.md` permits every one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotEqual } from "../assert";
import {
  BAR,
  captureStill,
  createHarness,
  drawnFigure,
  type Harness,
  openYard,
  standBlocker,
} from "../harness";

/** The anchors of the wall, stacked to close columns 20–21 over rows 0–7. */
const WALL: readonly [number, number][] = [
  [20, 0],
  [20, 2],
  [20, 4],
  [20, 6],
];

/** A whole tile of room to round a real route length in. */
const TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a new maze length the moment a wall lengthens the route", async () => {
  await openYard(h, { map: "substation" });

  const open = await h.snapshot();
  const before = drawnFigure(
    await h.frameCalls(),
    BAR,
    open.mazeLength,
    "the maze length of the open yard",
    TOLERANCE,
  );

  for (const [col, row] of WALL) await standBlocker(h, col, row);

  const walled = await h.snapshot();
  assertGreaterThan(
    walled.mazeLength,
    open.mazeLength,
    "the route length a wall across the first leg produces (specs/pathing.md)",
  );

  const after = drawnFigure(
    await h.frameCalls(),
    BAR,
    walled.mazeLength,
    "the maze length of the walled yard",
    TOLERANCE,
  );
  await captureStill(h, "bar");
  assertNotEqual(
    after,
    before,
    "the maze length the bar draws once the wall has lengthened the route",
  );
});
