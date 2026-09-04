// instrumentation/run-ops-throw-without-a-run — with no run live, every operation
// of the run group but `startRun` throws, and changes nothing.
//
// THE RULE, in the specification's own words, closing the run group of
// `specs/instrumentation.md`: "`startRun` throws with no challenge open. Every
// other operation of this group requires a live run and throws an `Error` without
// one." The group is the table above that sentence, and its other fifteen rows are
// `stopRun`, `setPaused`, `setSpeed`, `setCycle`, `setTally`, `clearMotes`,
// `spawnMote`, `removeMote`, `linkMotes`, `unlinkMotes`, `setGrip`, `releaseGrip`,
// `setPoseRotation`, `setPoseLength` and `setPoseCell` — the fifteen this check
// calls, and no others.
//
// THE POSE IS THE EDITOR WITH NO RUN. `reset`, then `loadChallenge` so a challenge
// is open, then `clearMachine`, then one arm placed so the four part-naming rows
// have a real part to name. `startRun` is never called, so `sim` is `null` — which
// the check reads back before it calls anything, because "with no run live" is the
// whole of the condition under test.
//
// FOUR ROWS NAME A MOTE, AND NO MOTE CAN EXIST HERE. `sim.motes` lives inside a
// run, so `removeMote`, `linkMotes`, `unlinkMotes` and `setGrip` are handed ids
// that name nothing — which is not a weakness of the pose but its point: without a
// live run there is no mote for them to name, and the row's own requirement is
// that the call fails rather than inventing one.
//
// THE VERDICT IS BOTH HALVES. Each call throws an `Error` rather than returning,
// and the whole snapshot after the call deep-equals the whole snapshot before it —
// the build's own reading compared with itself, so a build that threw but half
// applied the call is caught wherever it put the change. No frame is advanced
// between the two reads, so nothing but a refused call could move the snapshot at
// all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import { ARM_MIN_LEN, DEFAULT_SPEED_INDEX } from "../constants";
import { BARE, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The call throws an `Error` and returns nothing, and the game is where it was.
 *
 * Both halves of the row's requirement in one place, so a build that throws but
 * half applies the call, and a build that applies nothing but returns quietly,
 * each fail on the half they broke.
 */
async function refused(
  call: () => Promise<unknown>,
  doing: string,
): Promise<void> {
  const before = await h.snapshot();
  let thrown: unknown = null;
  let returned = false;
  try {
    await call();
    returned = true;
  } catch (error) {
    thrown = error;
  }
  assertEqual(
    returned,
    false,
    `${doing} requires a live run, so it fails rather than returning without one`,
  );
  assertTrue(
    thrown instanceof Error,
    `${doing} refuses by throwing an Error, as the run group requires`,
  );
  assertDeepEqual(
    await h.snapshot(),
    before,
    `${doing} changes nothing when it is refused`,
  );
}

it("refuses every run operation but startRun while sim is null", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await h.advance(1);
  await captureStill(h, "refused");

  const opened = await h.snapshot();
  assertNull(
    opened.sim,
    "the pose is the editor with a challenge open and no run started",
  );
  assertEqual(
    opened.editor.parts.length,
    1,
    "one arm is placed, so the rows that name a part have a real part to name",
  );

  await refused(() => h.debug.stopRun(), "stopRun()");
  await refused(() => h.debug.setPaused(true), "setPaused(true)");
  await refused(
    () => h.debug.setSpeed(DEFAULT_SPEED_INDEX),
    `setSpeed(${DEFAULT_SPEED_INDEX})`,
  );
  await refused(() => h.debug.setCycle(0), "setCycle(0)");
  await refused(() => h.debug.setTally(0, 0), "setTally(0, 0)");
  await refused(() => h.debug.clearMotes(), "clearMotes()");
  await refused(
    () => h.debug.spawnMote(WEST.q, WEST.r, "dust"),
    'spawnMote(q, r, "dust")',
  );
  await refused(() => h.debug.removeMote(1), "removeMote(mote)");
  await refused(() => h.debug.linkMotes(1, 2, 1), "linkMotes(a, b, 1)");
  await refused(() => h.debug.unlinkMotes(1, 2), "unlinkMotes(a, b)");
  await refused(() => h.debug.setGrip(arm, 0, 1), "setGrip(part, 0, mote)");
  await refused(() => h.debug.releaseGrip(arm, 0), "releaseGrip(part, 0)");
  await refused(
    () => h.debug.setPoseRotation(arm, 0),
    "setPoseRotation(part, 0)",
  );
  await refused(
    () => h.debug.setPoseLength(arm, ARM_MIN_LEN),
    `setPoseLength(part, ${ARM_MIN_LEN})`,
  );
  await refused(
    () => h.debug.setPoseCell(arm, ORIGIN.q, ORIGIN.r),
    "setPoseCell(part, q, r)",
  );

  const closed = await h.snapshot();
  assertNull(
    closed.sim,
    "fifteen refused calls left the game with no run, exactly as they found it",
  );
  assertNotNull(
    closed.challenge,
    "and with the challenge they were refused over still open",
  );
  assertTrue(
    closed.editor.parts.length === 1,
    "and with the machine they were refused over still standing",
  );
});
