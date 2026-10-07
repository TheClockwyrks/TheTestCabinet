// runs/play-refuses-an-unplaced-rise — `play` with one of the challenge's rises
// still in the tray starts nothing, however complete the rest of the machine is.
//
// THE RULE. "The `play` action starts a run when every rise and every set is
// placed; otherwise it does nothing and the heading states which are missing"
// (`specs/editor.md`, Running the machine). The condition is a conjunction, so a
// machine holding EVERY set and one rise short fails it exactly as one short of a
// set does. "It does nothing" is read on the two things a started run would
// change: `sim` — "The whole of a run, and `null` while editing"
// (`specs/state.md`) — and the machine, which "The editor's parts are locked for
// the whole run" (`specs/simulation.md`) would have frozen.
//
// THE CONFIGURATION. `TWO_AND_TWO`, whose two reagents and two products give the
// challenge TWO rises and TWO sets, so the condition is posed on ANY rise rather
// than on the only one: BOTH sets are placed, the rise for reagent `0` is placed,
// and the rise for reagent `1` is left in the tray. One arm is placed as well, so
// there is a part to edit afterwards. Nothing else is on the field.
//
// THE PRESS IS THE PLAYER'S. It goes through the key `specs/controls.md` binds to
// `play`, never through `startRun`, of which `specs/instrumentation.md` says "the
// readiness condition the `play` action applies is not applied".
//
// THE VERDICT. `sim` is `null` after the press, exactly as it was before it. And
// the editor is still an editor rather than a locked run: `part-cw`, which
// `specs/editor.md` gives the field focus to turn the selected part with, turns
// it — an action a live run would swallow, because "While a run is active, in any
// status ... the editor reads the run controls above and `mute` and nothing else."

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { armPart, risePart, setPart, solution } from "../formats";
import { ORIGIN, TWO_AND_TWO } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  playAction,
  pressAction,
  type Harness,
} from "../harness";

/** Both sets, the rise for reagent `0`, and one arm: the rise for reagent `1` is missing. */
const MISSING_A_RISE = solution([
  risePart(0, -3, 0),
  setPart(0, 3, 0),
  setPart(1, 3, -3),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

/** Where the arm sits in `MISSING_A_RISE`'s placement order. */
const ARM_INDEX = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no run while one of the challenge's rises is unplaced, every set placed", async () => {
  await openChallengeDocument(h, TWO_AND_TWO);
  await loadMachine(h, MISSING_A_RISE);
  const arm = (await partIds(h))[ARM_INDEX] ?? -1;

  const editing = await h.snapshot();

  await playAction(h);
  await captureStill(h, "refused");

  const refused = await h.snapshot();
  assertNull(
    editing.sim,
    "no run is live before the press, so the press is what would have started one",
  );
  assertNull(
    refused.sim,
    "play does nothing while any of the challenge's rises is unplaced, so sim stays null",
  );
  assertEqual(
    refused.screen,
    "editor",
    "a refused play leaves the game where it was, in the editor over the same challenge",
  );

  await h.debug.setSelected(arm);
  await pressAction(h, "part-cw");

  const edited = await h.snapshot();
  assertNotNull(
    partById(edited, arm),
    "the arm the press turned is still on the machine",
  );
  assertEqual(
    partById(edited, arm)?.rotation,
    1,
    "the editor stays editable: part-cw turns the selected part, which a live run would swallow",
  );
  assertNull(
    edited.sim,
    "the edit is made while editing, so no run was started by it either",
  );
});
