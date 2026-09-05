// overlays/overlays-are-inert — an open overlay changes nothing about the run.
//
// `specs/hud.md` says of the recipe book and of the damage leaderboard alike: "it
// does not pause or alter the game". `specs/controls.md` fixes what the
// simulation clock does instead — it advances by `dt * speed` on `playing` unless
// the game is paused — and names no overlay among the things that stop it.
//
// So the same ten seconds are run three times from the same seed, with both
// overlays closed, with the recipe book open, and with the leaderboard open, and
// the run has to arrive at the same place each time: the same simulation clock,
// and the same unit at the same point of the same leg of the chain. The unit is
// released travelling rather than held, because a held unit would still be where
// it started under an overlay that froze everything.
//
// `openYard` resets between the three, and `reset` seeds every random draw from
// `DEFAULT_SEED`, so the three runs are the same run.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  lastUnit,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";

/** The span specs/hud.md's point is stated over. */
const SPAN = 10;

/**
 * The frame all three runs are stepped in: `20` Hz, a sixth of this project's
 * default.
 *
 * THE STEP CANCELS OUT, BECAUSE THE CLAIM IS THAT THE THREE RUNS AGREE. What is
 * compared is one run against another, and all three take the same clock from the
 * same seed, so whatever a coarser frame does to where a Mote stands after ten
 * seconds it does identically three times. Nothing here is measured against a
 * figure the specs state — no speed, no distance, no rate — and no projectile
 * flies, so the one step size this project has to respect does not arise.
 *
 * `specs/instrumentation.md` fixes no frame size and guarantees that an interval
 * of simulation time reaches the same state however it was divided into frames,
 * which `instrumentation/frame-division-movement` and
 * `instrumentation/frame-division-projectile` are the two items that decide. The
 * ten seconds `specs/hud.md`'s point is stated over are unchanged; only the frames
 * they are divided into are.
 */
const SPAN_HZ = 20;

/** Frames of that clock covering `s` seconds of simulation, rounded up. */
function spanFrames(seconds: number): number {
  return Math.ceil(seconds * SPAN_HZ);
}
/** A thousandth of a unit: floating point, not a rule about the game. */
const DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / SPAN_HZ) });
});

afterEach(() => {
  h.dispose();
});

interface Reached {
  simTime: number;
  x: number;
  y: number;
  waypointIndex: number;
  progress: number;
}

/** Ten seconds of the same run, with `overlay` open, or with neither. */
async function tenSeconds(
  overlay: "combos" | "damage" | null,
): Promise<Reached> {
  openYard(h);
  if (overlay !== null) h.debug.setOverlay(overlay, true);
  releaseUnit(h, "mote");
  await h.advance(spanFrames(SPAN));
  const snapshot = h.snapshot();
  const unit = lastUnit(snapshot);
  return {
    simTime: snapshot.simTime,
    x: unit.x,
    y: unit.y,
    waypointIndex: unit.waypointIndex,
    progress: unit.progress,
  };
}

it("runs the same ten seconds with either overlay open as with neither", async () => {
  const closed = await tenSeconds(null);
  assertCloseTo(
    closed.simTime,
    SPAN,
    DIGITS,
    "the simulation clock after ten seconds with both overlays closed",
  );

  const withBook = await captureReplay(h, "inert", () => tenSeconds("combos"));
  const withBoard = await tenSeconds("damage");

  for (const [what, reached] of [
    ["the recipe book", withBook],
    ["the damage leaderboard", withBoard],
  ] as const) {
    assertCloseTo(
      reached.simTime,
      closed.simTime,
      DIGITS,
      `the simulation clock after ten seconds with ${what} open`,
    );
    assertEqual(
      reached.waypointIndex,
      closed.waypointIndex,
      `the checkpoint the unit is heading for with ${what} open`,
    );
    assertCloseTo(
      reached.progress,
      closed.progress,
      DIGITS,
      `the route the unit has left with ${what} open`,
    );
    assertCloseTo(
      reached.x,
      closed.x,
      DIGITS,
      `where the unit stands with ${what} open`,
    );
    assertCloseTo(
      reached.y,
      closed.y,
      DIGITS,
      `where the unit stands with ${what} open`,
    );
  }
});
