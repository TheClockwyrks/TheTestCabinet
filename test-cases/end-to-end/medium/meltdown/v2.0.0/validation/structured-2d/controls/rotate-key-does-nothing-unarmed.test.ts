// Meltdown — controls/rotate-key-does-nothing-unarmed: R with nothing held
// changes nothing.
//
// THE RULE. "With nothing held, rotating changes nothing at all"
// (specs/building.md, Rotating the preview), which specs/controls.md restates as
// "`rotate` ... With nothing held it changes nothing". The failure this exists to
// catch is a build that answers `rotate` by arming something, by turning a placed
// tower, or by advancing a rotation it keeps outside the preview.
//
// HOW "CHANGES NOTHING" IS DECIDED. By reading the WHOLE snapshot either side of
// the press and comparing it field for field, rather than by naming the few
// fields a wrong build might touch. Naming them would be a list of guesses; the
// snapshot is every field an operation can set (specs/instrumentation.md,
// Snapshot shape), so comparing all of it decides the requirement as stated.
//
// WHY THE SCENARIO IS AN OPENING PHASE OVER AN EMPTY, QUIET FLOOR. One frame of
// game time passes to deliver the press, so the comparison is only honest where
// nothing else in the game is moving. The opening phase "carries no countdown,
// reports a `buildTimer` of `0`, and never starts a wave on its own however long
// it runs" (specs/waves.md, The opening phase); both rosters are empty, so no
// tower heats and no unit walks; and the world gate is off, so nothing is
// released. The one field that must still move is `simTime`, which "accumulates
// the game time the simulation advanced by" (specs/instrumentation.md) — every
// frame of every screen gains it, so it is compared apart rather than expected to
// hold still.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/**
 * The snapshot without the one field a frame of game time is entitled to move.
 *
 * Not a tolerance: `simTime` is excluded because specs/waves.md makes its gain
 * the definition of a frame having happened, and the press cannot be delivered
 * without one.
 */
function apartFromTheClock(snapshot: MeltdownSnapshot): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...snapshot };
  delete fields.simTime;
  return fields;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every field of the snapshot as it was", async () => {
  startRun(h);
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);
  h.debug.setArmed(null);
  // One settled frame first, so what is read below is a floor already standing
  // still rather than one the pose is still landing on.
  await h.advance(1);

  const before = h.snapshot();
  await h.tap("KeyR");
  captureStill(h, "unarmed");
  const after = h.snapshot();

  assertNull(after.build, "nothing held after R");
  assertDeepEqual(
    apartFromTheClock(after),
    apartFromTheClock(before),
    "the snapshot either side of R with nothing held",
  );
  // The press really was delivered into a running game: a frame that advanced no
  // game time would make the comparison above pass on a dead build.
  assertGreaterThan(after.simTime, before.simTime, "simTime over the press");
});
