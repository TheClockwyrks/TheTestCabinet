// hopping/refuse-vehicle — a hop onto a tile a vehicle covers is refused.
//
// specs/hopping.md refuses a hop whose target tile "is covered by a vehicle",
// citing specs/ice.md for when a vehicle covers a tile, and leaves "everything as
// it was: the critter stays where it stands ... no life is lost". This is the only
// refusal that is not geometry: the other four are fixed by the grid and the far
// shore, and this one is fixed by what happens to be on the strait, so a build can
// have all four and still hop straight into a plow.
//
// THE VEHICLE IS PARKED, AND IT IS ONE ROW UP. {@link poseLane} holds its lane at
// rest, so the tile it covers is the tile it was posed on for the whole of the
// check and no reading depends on where a moving lane had got to. It never shares a
// row with the critter, so nothing here can be confused with the crush rule
// (specs/ice.md), which is about a vehicle's OWN MOTION reaching a critter: the
// target tile is occupied, the tile stood on is clear, and the only question is
// whether the hop is taken.
//
// The hop is taken up, into the MIDDLE of the plow's span rather than at either end
// of it, so a build whose covering rule is a tile short at one edge is still asked
// the plain question here. The span is the specification's, not the build's:
// specs/ice.md fixes a plow at `3` tiles occupying `[x, x + TILE * len)`, so a plow
// whose LEFT EDGE is posed one column left of the target covers that target. What
// the build reports for its own span is `ice/covers-every-tile`'s item, and is
// deliberately not read here, so one wrong length costs one point rather than two. The critter stands on plain solid ice with the rest of
// the strait emptied (specs/strait.md), and the drive runs on for a quarter of a
// second after the press so that a life taken a tick late is still seen.
//
// THE PRESS IS DOWN, ONE WHOLE TICK, UP. specs/controls.md reads the four movement
// actions as HELD on the `playing` screen, so a key genuinely down while a tick
// runs is the one press a held reading and a press-edge reading both see, and
// exactly once: `HOP_COOLDOWN` is `14.4` ticks, so no second request can follow
// inside that tick.

import { afterEach, beforeEach, it } from "vitest";
import { START_COL, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  keyFor,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The ice row the critter stands on, and the ice row the vehicle is parked on. */
const ROW = 15;
const VEHICLE_ROW = ROW - 1;

/** How long the drive runs on after the refused press, in ticks. */
const SETTLE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop onto a tile a parked vehicle covers and costs no life", async () => {
  startCrossing(h);
  // A three-tile plow whose middle tile is the one the hop targets.
  poseLane(h, VEHICLE_ROW, "plow", [START_COL - 1]);
  h.debug.addCritter(START_COL, ROW);

  const posed = h.snapshot();
  assertEqual(
    posed.critter.col,
    START_COL,
    "the pose put the critter below it",
  );
  assertEqual(posed.critter.row, ROW, "the pose put it on the ice band");

  const after = await captureReplay(h, "refuse", async () => {
    await holdFor(h, keyFor("up"), 1);
    await h.advance(SETTLE_TICKS);
    return h.snapshot();
  });

  assertEqual(
    after.critter.row,
    ROW,
    "the row the critter stood on: a tile a vehicle covers refuses the hop (specs/hopping.md)",
  );
  assertEqual(after.critter.col, START_COL, "the column it stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(
    after.lives,
    START_LIVES,
    "the lives the run began with: a refused hop costs none (specs/hopping.md)",
  );
});
