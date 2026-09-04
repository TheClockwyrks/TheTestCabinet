// instrumentation/leaving-the-editor-stops-the-run — a `setScreen` out of the
// editor ends a live run, and ends it the way leaving in play ends one.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress: "A call to
// `setScreen` that leaves the editor leaves it exactly as leaving it in play does:
// a live run is stopped, the open challenge's machine is stashed as
// `specs/editor.md` states, and the challenge is closed, so `challenge` and `sim`
// both report `null` afterwards." What "stopped" means is `specs/simulation.md`'s
// run-stop sequence, which the surface's own `stopRun` row also names: it "clears
// the run and every runtime pose and returns to editing with the machine exactly
// as it was placed".
//
// THE CONFIGURATION. A shipped Extras challenge — every one of them is open from
// the start (`specs/modes/extras.md`), so the machine can be visited again by the
// player's own route afterwards — with one arm whose tape turns it, one mote posed
// into its hold, and a whole cycle driven, so the run really is live and the arm's
// LIVE rotation has left its rest rotation behind. Then one `setScreen("title")`.
//
// THE VERDICT. `sim` reports `null` at once; further game time drives nothing back
// into it, so the run is stopped rather than merely hidden; and the machine, read
// back on the next visit, is exactly the machine that was placed — the rest
// rotation the arm was given, not the rotation the run had carried it to.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openChallenge,
  partById,
  partIds,
  poseOf,
  pressAction,
  readMachine,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The Extras row this check visits; every Extras row is open from the start. */
const ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the run, and returns the machine as it was placed", async () => {
  await h.debug.reset();
  await h.debug.setMode("extras");
  await openChallenge(h, "extras", ROW);
  await h.debug.clearMachine();
  await h.debug.placePart("arm", -2, 0, 0);
  const arm = (await partIds(h))[0] ?? -1;
  await h.debug.setTapeCell(arm, 0, "rotate-cw");
  const placed = await readMachine(h);

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  const carried = await spawnMote(h, at(-1, 0), "dust");
  await takeGrip(h, arm, 0, carried);
  await advanceCycles(h, 1);

  const running = await h.snapshot();
  assertNotNull(running.sim, "a run is live before the screen is left");
  assertEqual(running.sim?.cycle, 1, "the run has a cycle behind it");
  assertNotEqual(
    poseOf(running, arm)?.rotation,
    partById(running, arm)?.rotation,
    "the run has carried the arm off its rest rotation",
  );

  await captureReplay(h, "stopped", async () => {
    await h.debug.setScreen("title");
    await h.advance(2);
  });

  const left = await h.snapshot();
  assertEqual(left.screen, "title", "the session left the editor");
  assertNull(left.sim, "sim reports null: the live run was stopped");
  assertNull(left.challenge, "the open challenge was closed");

  await advanceCycles(h, 2);
  assertNull(
    (await h.snapshot()).sim,
    "further game time drives nothing back into the run: it is stopped, not hidden",
  );

  // The player's own route back in, which restores the challenge's machine
  // (`specs/editor.md`, Entering and leaving).
  await h.debug.setScreen("select");
  await h.debug.setSelectIndex(ROW);
  await pressAction(h, "confirm");

  const revisited = await h.snapshot();
  assertEqual(revisited.screen, "editor", "the challenge opens again");
  assertNull(revisited.sim, "the visit opens with no run");
  assertDeepEqual(
    await readMachine(h),
    placed,
    "the machine returns to the editor exactly as it was placed, with its rest rotation",
  );
});
