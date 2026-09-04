// waves/send-starts-wave-1 — the send control begins Wave 1 from the opening
// phase.
//
// `specs/waves.md`, The opening phase: it "never starts a wave on its own however
// long it runs. Sending is what begins Wave 1." `specs/controls.md` binds `send`
// to `Space` and gives it the effect "Sends the next wave, or begins Wave 1 from
// the opening phase". `specs/waves.md`'s release rule then fixes what beginning a
// wave means: "A wave releases its units one at a time ... the first on the frame
// the wave begins."
//
// SO THIS POINT READS BOTH HALVES OF ONE EVENT, and they are one requirement:
// the phase moved to `wave`, and the spawner actually began. A build that moves
// the phase and releases nothing has not begun Wave 1, and neither has one that
// releases a unit while sitting in `opening`.
//
// THE RUN'S OWN RELEASE OF SURGE IS LEFT ON. `specs/instrumentation.md`'s world
// gate holds "the spawner's release of the units counted by `wavePending`", so a
// scenario that had shut it could not see a release at all. `poseOpening` reaches
// the opening phase through `reset`, which restores the gate to on, and empties
// both rosters first, so the unit read here can only have come from the send.
//
// THE PRESS IS THE REAL KEY, delivered through Chromium to the keyboard layer the
// build wrote, because `send` is a player's action and `specs/instrumentation.md`
// carries no operation that sends a wave. WHICH key `send` is bound to is
// `controls.*`'s requirement; what this point needs is that the action reached
// the game at all, and a press that produced neither half of the event says so
// as plainly as one that produced the wrong half.
//
// A SECOND OF GAME TIME IS THE WINDOW THE RELEASE IS LOOKED FOR IN. Units arrive
// one every `WAVE_SPAWN_INTERVAL` (`0.6`) seconds, so a second holds the first
// one comfortably even for a build that misses the "on the frame the wave begins"
// clause and waits a whole interval before its first release — a different
// requirement, `surge.spawn-cadence`'s, which this point deliberately does not
// grade.
//
// WHAT EVERY WRONG MODEL READS. A build whose send does nothing stays in
// `opening` with an empty floor; one that moves the phase but never starts its
// spawner reads `wave` with an empty floor; one that starts the wave but on the
// wrong number reads a `wave` other than `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  tapAction,
  type Harness,
} from "../harness";
import { poseOpening } from "./run";

/**
 * How long the release is looked for: one second of game time.
 *
 * Geometry rather than a tolerance. It is more than one `WAVE_SPAWN_INTERVAL`
 * (`0.6` s), so a build that releases its first unit a whole interval into the
 * wave rather than on the frame it begins still shows a release here.
 */
const RELEASE_FRAMES = framesFor(1);

/** The wave a send from the opening phase begins (`specs/waves.md`). */
const FIRST_WAVE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the phase to wave and starts the spawner", async () => {
  await poseOpening(h);
  const before = await h.snapshot();

  await tapAction(h, "send");
  const sent = await h.snapshot();
  await h.advance(RELEASE_FRAMES);
  const released = await h.snapshot();

  await captureStill(h, "sent");

  assertEqual(
    before.phase,
    "opening",
    "precondition: the run stood in its opening phase before the send",
  );
  assertEqual(sent.phase, "wave", "the phase the send moved the run to");
  assertEqual(sent.wave, FIRST_WAVE, "the wave the send began");
  assertGreaterThanOrEqual(
    released.surge.length,
    1,
    `units on the floor ${WAVE_SPAWN_INTERVAL} seconds and more after the send began Wave ${FIRST_WAVE}`,
  );
});
