// progression/respawn-invulnerable — play resumes with RESPAWN_INVULN seconds of
// spawn-in invulnerability running.
//
// specs/progression.md, Losing a life: when the respawn timer runs out, the
// phase becomes `active` AND the cursor is given `RESPAWN_INVULN` (`2.0` s) of
// spawn-in invulnerability. The grant belongs to that moment and to no other,
// which is the whole point of reading it there: a build that hands the
// invulnerability out at the instant of the contact instead has spent
// `RESPAWN_TIME` (`1.4` s) of it by the time play resumes and reads back `0.6`,
// well outside the tolerance below.
//
// THE RESPAWN IS POSED, NOT DRIVEN. The requirement is what the END of a respawn
// hands the cursor, so the respawn itself is posed with the two atomic
// operations that name it — `setPhase("respawn")` and
// `setPhaseTimer(RESPAWN_TIME)` — on the empty, quiet board `startPlaying`
// leaves behind. Nothing about the contact rule, the sweep, or the lives count
// can then bear on this verdict; those are `life-lost-decrements` and the two
// `respawn-clears-*` points.

import { afterEach, beforeEach, it } from "vitest";
import { RESPAWN_INVULN, RESPAWN_TIME } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How far the reading may be from `RESPAWN_INVULN`, in seconds.
 *
 * `0.2` s. The grant lands on a frame boundary and a build is free to spend that
 * frame's own delta on it straight away, which at any sane frame rate is a few
 * milliseconds; `0.2` s is far above that and far below the `1.4` s that
 * separates this reading from a build that granted the invulnerability at the
 * contact instead.
 */
const INVULN_TOLERANCE = 0.2;

/**
 * How long past `RESPAWN_TIME` the respawn is given to end, in seconds. Half a
 * second — thirty-odd frames of slack on a `1.4` s timer, so a build integrating
 * the countdown slightly differently is not failed for the last frame of it.
 */
const RESPAWN_GRACE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("hands the cursor RESPAWN_INVULN seconds as play resumes", async () => {
  startPlaying(h);
  h.debug.setCursorInvulnerable(0);
  h.debug.setPhase("respawn");
  h.debug.setPhaseTimer(RESPAWN_TIME);

  const resumed = await h.until((snapshot) => snapshot.phase === "active", {
    maxFrames: ticksFor(RESPAWN_TIME + RESPAWN_GRACE),
  });
  captureStill(h, "invulnerable");

  assertEqual(
    resumed.hit,
    true,
    `the respawn giving way to active play within ` +
      `${RESPAWN_TIME + RESPAWN_GRACE} s — the moment this point reads`,
  );
  assertBetween(
    resumed.snapshot.cursor.invulnerable,
    RESPAWN_INVULN - INVULN_TOLERANCE,
    RESPAWN_INVULN + INVULN_TOLERANCE,
    "the invulnerability left as play resumes",
  );
});
