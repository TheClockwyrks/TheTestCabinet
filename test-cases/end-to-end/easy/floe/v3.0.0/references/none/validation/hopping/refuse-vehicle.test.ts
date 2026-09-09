// hopping/refuse-vehicle — a hop onto a tile a vehicle covers is refused.
//
// `specs/hopping.md` refuses a hop whose target tile "is covered by a vehicle",
// citing `specs/ice.md` for when a vehicle covers a tile, and leaves "everything
// as it was: the critter stays where it stands ... no life is lost". This is the
// only refusal that is not geometry: the other four are fixed by the grid and the
// far shore, and this one is fixed by what happens to be on the strait, so a
// build can have all four and still hop straight into a plow.
//
// THE VEHICLE IS PARKED, AND IT IS ONE ROW UP. Its lane is held at rest, so the
// tile it covers is the tile it was posed on for the whole of the check and no
// reading depends on where a moving lane had got to. It never shares a row with
// the critter, so nothing here can be confused with the crush rule
// (`specs/ice.md`), which is about a vehicle's own motion reaching a critter:
// the target tile is occupied, the tile stood on is clear, and the only question
// is whether the hop is taken.
//
// The hop is taken up, into the middle of the plow's three-tile span rather than
// at either end of it, so a build whose covering rule is a tile short at one edge
// is still asked the plain question here; `ice.covers-every-tile` is the item
// that decides the span itself. The critter stands on plain solid ice with the
// rest of the strait emptied (`specs/strait.md`), and the drive runs on for a
// quarter of a second after the press so that a life taken a tick late is still
// seen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOP_KEY, START_COL, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The ice row the critter stands on, and the ice row the vehicle is parked on. */
const ROW = 15;
const VEHICLE_ROW = ROW - 1;

/** How long the drive runs on after the refused press. */
const SETTLE_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("refuses a hop onto a tile a parked vehicle covers and costs no life", async () => {
  await startCrossing(harness);
  // A three-tile plow whose middle tile is the one the hop targets.
  await poseLane(harness, VEHICLE_ROW, "plow", [START_COL - 1]);
  await harness.debug.addCritter(START_COL, ROW);

  const after = await captureReplay(harness, "refuse", async () => {
    await harness.tap(HOP_KEY.up);
    await harness.advance(SETTLE_TICKS);
    return harness.snapshot();
  });

  assertEqual(after.critter.row, ROW, "the row the critter stood on");
  assertEqual(after.critter.col, START_COL, "the column it stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(after.lives, START_LIVES, "the lives the run began with");
});
