// status-bar/maze-length-drawn — the bar draws the current maze length.
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

import { afterEach, beforeEach, it } from "vitest";
import {
  BAR,
  captureStill,
  createHarness,
  drawnFigure,
  type Harness,
  openYard,
} from "../harness";

/** A whole tile of room to round a real route length in. */
const TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the maze length of the yard as it stands", async () => {
  await openYard(h, { map: "substation" });

  const open = await h.snapshot();
  drawnFigure(
    await h.frameCalls(),
    BAR,
    open.mazeLength,
    "the maze length of the open yard",
    TOLERANCE,
  );
  await captureStill(h, "bar");
});
