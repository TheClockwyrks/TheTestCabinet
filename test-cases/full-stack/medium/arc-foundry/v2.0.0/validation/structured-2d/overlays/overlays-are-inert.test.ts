// overlays/overlays-are-inert — an open overlay changes nothing about the run.
//
// `specs/hud.md` says of the recipe book and of the damage leaderboard alike: "it
// does not pause or alter the game". `specs/controls.md` fixes what the
// simulation clock does instead — it advances by `dt * speed` on `playing` unless
// the game is paused — and names no overlay among the things that stop it.
//
// So ten seconds are run with the recipe book open and again with the
// leaderboard open, and each run has to keep going: the simulation clock advances
// by the ten seconds, and a released unit walks on along the chain at its roster
// speed. The unit is released travelling rather than held, because a held unit
// would still be where it started under an overlay that froze everything.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  compareAlongChain,
  createHarness,
  lastUnit,
  openYard,
  releaseUnit,
  type Harness,
} from "../harness";

/** The span specs/hud.md's point is stated over. */
const SPAN = 10;

/**
 * The frame the runs are stepped in: `10` Hz, a twelfth of this project's default.
 *
 * Nothing here is measured against a distance or a rate, and no projectile flies,
 * so the one step size this project has to respect does not arise. The ten
 * seconds `specs/hud.md`'s point is stated over are unchanged; only the frames
 * they are divided into are.
 */
const SPAN_HZ = 10;

/** Frames of that clock covering `s` seconds of simulation, rounded up. */
function spanFrames(seconds: number): number {
  return Math.ceil(seconds * SPAN_HZ);
}
/** A thousandth of a second: floating point, not a rule about the game. */
const DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: SPAN_HZ });
});

afterEach(() => {
  h.dispose();
});

/** Ten seconds of a run with `overlay` open, read off the released unit. */
async function tenSeconds(overlay: "combos" | "damage"): Promise<void> {
  openYard(h);
  h.debug.setOverlay(overlay, true);
  releaseUnit(h, "mote");
  const opened = h.snapshot();
  const released = lastUnit(opened);

  await h.advance(spanFrames(SPAN));
  const reached = h.snapshot();
  const what = overlay === "combos" ? "the recipe book" : "the damage leaderboard";

  assertCloseTo(
    reached.simTime - opened.simTime,
    SPAN,
    DIGITS,
    `the simulation clock over ten seconds with ${what} open (specs/hud.md)`,
  );
  const unit = lastUnit(reached);
  assertEqual(unit.id, released.id, `the released unit still on the yard`);
  assertEqual(
    unit.speed,
    unit.baseSpeed,
    `the unit's speed with ${what} open, against its roster speed`,
  );
  assertLessThan(
    compareAlongChain(unit, released),
    0,
    `the unit's place along the chain after ten seconds with ${what} open, ` +
      `against where it was released: it walked on`,
  );
}

it("runs ten seconds with either overlay open", async () => {
  await captureReplay(h, "inert", () => tenSeconds("combos"));
  await tenSeconds("damage");
});
