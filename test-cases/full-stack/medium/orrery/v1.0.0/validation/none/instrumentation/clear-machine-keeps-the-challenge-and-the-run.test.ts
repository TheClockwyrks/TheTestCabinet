// instrumentation/clear-machine-keeps-the-challenge-and-the-run — `clearMachine`
// leaves the challenge and any live run standing.
//
// THE RULE. "`clearMachine()` — Removes every placed part, empties both
// histories, and clears the selection, the cursor, and any live drag. The open
// challenge and any live run stand" (`specs/instrumentation.md`, The machine).
// It is a pose like every other: "Each pose sets one thing and leaves the rest of
// the game as it stands."
//
// WHAT STANDS. The open challenge, which the snapshot reports with its name,
// reagents, products, permitted list and target — and its TRAY with it, because
// the tray is "derived from the challenge" rather than held beside it. And the
// run: `sim` is not `null`, its `status` is what it was, and its `cycle` is what
// it was, the run carrying on from there rather than restarting at `0`.
//
// THE MOTES. "a part one of them removes takes its live pose, its grips, and its
// fixtures off the field with it" — so what comes off with a part is its pose,
// its grips and its fixtures. A mote attached to none of that is attached to
// nothing that was removed, and `specs/simulation.md` rests a mote on its hex
// until something moves it, so it is still resting where it stood.
//
// THE CONFIGURATION. A bare run on `BARE` with the completion switch held off,
// one arm at the origin with an empty tape — which "is a rest on every part ...
// and never faults" — and one mote spawned well clear of it, on a hex no gripper
// of a length-`1` arm at the origin reaches. Two cycles are run before the clear
// so the cycle counter is off `0` and a restart would show. The clear and the
// cycle after it are recorded as this item's replay.
//
// THE VERDICT. After the clear the challenge is the same challenge, the run is
// still live and still `running` at the cycle it had reached, and the mote is
// still resting on the hex it stood on. A further cycle advances the run, so what
// stands is a live run rather than a frozen one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
} from "../assert";
import { BARE, NORTH, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  placePart,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the challenge, the live run and the resting motes across the clear", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "arm", ORIGIN, 0);
  const mote = await spawnMote(h, NORTH, "dust");
  await advanceCycles(h, 2);

  const before = await h.snapshot();
  assertNotNull(before.challenge, "a challenge is open to be kept");
  assertNotNull(before.sim, "and a run is live to be kept");
  assertEqual(before.sim?.status, "running", "the run is running");
  assertEqual(
    before.sim?.cycle,
    2,
    "two whole cycles have run, so a restart would read as 0",
  );
  assertEqual(
    before.editor.parts.length,
    1,
    "one part stands, so the clear has something to remove",
  );
  assertDeepEqual(
    [moteById(before, mote)?.q, moteById(before, mote)?.r],
    [NORTH.q, NORTH.r],
    "and the mote rests on the hex it was spawned on",
  );

  const after = await captureReplay(h, "standing", async () => {
    await h.debug.clearMachine();
    await advanceCycles(h, 1);
    return h.snapshot();
  });

  assertDeepEqual(
    after.editor.parts,
    [],
    "the clear removed the part it was called on",
  );
  assertEqual(
    after.challenge?.name,
    before.challenge?.name,
    "the open challenge stands",
  );
  assertEqual(
    after.challenge?.target,
    before.challenge?.target,
    "with its own target, which the tray and the completion test read",
  );
  assertEqual(
    after.challenge?.reagents.length,
    before.challenge?.reagents.length,
    "and its own reagents, which the tray derives its rises from",
  );
  assertEqual(
    after.challenge?.products.length,
    before.challenge?.products.length,
    "and its own products, which the tray derives its sets from",
  );
  assertNotNull(after.sim, "the run is still live over the cleared machine");
  assertEqual(after.sim?.status, "running", "and still running");
  assertEqual(
    after.sim?.cycle,
    3,
    "carrying on from the cycle it had reached rather than restarting",
  );
  assertDeepEqual(
    [moteById(after, mote)?.q, moteById(after, mote)?.r],
    [NORTH.q, NORTH.r],
    "and the mote attached to no removed part still rests where it stood",
  );
});
