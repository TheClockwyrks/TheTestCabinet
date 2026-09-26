// progression/respawn-invulnerable — play resumes with the cursor briefly
// invulnerable.
//
// `specs/progression.md`, Losing a life: "When that timer runs out, the phase
// becomes `active`, the cursor is given `RESPAWN_INVULN` (`2.0` s) of spawn-in
// invulnerability". The figure is the specification's; what it is FOR — that a
// contact costs nothing while it runs — is `cursor/invulnerable-ignores-contact`,
// and what this point reads is the seconds the cursor reports it was given.
//
// The reading is taken on the frame play resumes, which is the moment the
// specification names, so the value read is the one the build granted rather
// than whatever is left of it later. Every wrong model reads as a different
// number: a build that grants no invulnerability answers `0`, one that grants
// the respawn's own `1.4` s answers `1.4`, and a correct build answers `2.0`.
//
// TOLERANCE. `RESPAWN_INVULN` is exact, and the only honest slack is the frame
// the grant lands on: the invulnerability counts down against the delta of each
// update (`specs/progression.md`'s phase timers run the same way), so a build
// that grants it and then runs one update's countdown over it on the same frame
// reports a whisker under `2.0`. `0.2` s is twenty frames of this suite's clock
// — room for a build a few frames out either way, and a fifth of the distance to
// the nearest wrong figure above.
//
// The sweep's own bound is NOT a tolerance on the respawn's length: it only has
// to reach the frame play resumes, and it is generous so that a build whose
// respawn runs a little long still has this point read what it granted.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { RESPAWN_INVULN, RESPAWN_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/** How far the reported grant may fall from `RESPAWN_INVULN`, in seconds. */
const GRANT_SLACK = 0.2;

/** How far the sweep to the resumption of play may run, in seconds. */
const SWEEP_LIMIT = RESPAWN_TIME + 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("resumes play with two seconds of invulnerability", async () => {
  await startPlaying(h);

  await contactCursor(h);
  const resumed = await h.until((snapshot) => snapshot.phase === "active", {
    maxFrames: framesFor(SWEEP_LIMIT),
    poll: 1,
  });

  await captureStill(h, "invulnerable");
  assertEqual(
    resumed.snapshot.phase,
    "active",
    `precondition: play resumed within ${SWEEP_LIMIT}s of the contact`,
  );
  assertBetween(
    resumed.snapshot.cursor.invulnerable,
    RESPAWN_INVULN - GRANT_SLACK,
    RESPAWN_INVULN + GRANT_SLACK,
    "the seconds of invulnerability the cursor was given",
  );
});
