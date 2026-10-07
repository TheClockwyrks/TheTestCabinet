// hazards/gas-knockback — the blast throws the miner clear.
//
// `specs/hazards.md` fixes the shove: "The miner is shoved directly away from
// the pocket at `GAS_KNOCKBACK`" (700 units per second). The miner cuts a pocket
// out from under its own feet, so it stands directly above the pocket's centre
// and "directly away" is straight up; the velocity is read on the frame the cell
// broke, which is the frame the detonation resolved on.
//
// Travel is NOT gated here, and it is the one hazard point where it is not:
// `specs/instrumentation.md` says a gated body is moved nowhere by knockback, so
// a check about the shove has to give the miner the faculty the shove acts on.
// Everything else is still isolated — the mine is empty but for the pocket, so
// nothing else can be pushing the miner.
//
// The tolerance is 30 units per second, which is a little over two frames of
// `GRAVITY` at the harness's cadence: the shove and the frame's own fall are
// resolved in the same update, and which order a build resolves them in is not
// something the specification fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThan } from "../assert";
import { GAS_KNOCKBACK } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  openScene,
  standOn,
  type Harness,
} from "../harness";
import { armHull, bandRow, FAST_DRILL_TIER, HAZARD_COL } from "./scene";

/** The tier whose hull survives a rockbed detonation. */
const HULL_TIER = 5;

/** How far the measured speed may sit from GAS_KNOCKBACK. */
const TOLERANCE = 30;

/** How much of the shove may be sideways: the miner is directly above it. */
const SIDEWAYS_MAX = 60;

/** Frames of the flight kept in the clip after the reading is taken. */
const FLIGHT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("throws the miner away from the pocket at GAS_KNOCKBACK", async () => {
  openScene(h);
  h.debug.setTier("drill", FAST_DRILL_TIER);
  armHull(h, HULL_TIER);
  const row = bandRow(h.snapshot(), "rockbed");
  h.debug.setTile(HAZARD_COL, row, "gas");
  standOn(h, HAZARD_COL, row);

  const blast = await captureReplay(h, "shove", async () => {
    const cut = await driveCut(h, "down", { col: HAZARD_COL, row });
    // A few frames of the flight, so the clip shows the miner leaving rather
    // than only the instant it was hit. The reading above is already taken.
    await h.advance(FLIGHT_FRAMES);
    return cut;
  });

  assertEqual(blast.broke, true, "specs/hazards.md");
  const { vx, vy } = blast.snapshot.miner;
  assertBetween(
    Math.hypot(vx, vy),
    GAS_KNOCKBACK - TOLERANCE,
    GAS_KNOCKBACK + TOLERANCE,
    "specs/hazards.md",
  );
  // Directly away from a pocket the miner stands on top of is straight up, and
  // specs/world.md has y increasing downward.
  assertLessThan(vy, 0, "specs/hazards.md, shoved away from the pocket");
  assertLessThan(Math.abs(vx), SIDEWAYS_MAX, "specs/hazards.md");
});
