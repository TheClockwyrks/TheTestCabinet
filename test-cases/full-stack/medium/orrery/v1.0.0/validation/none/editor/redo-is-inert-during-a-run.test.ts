// editor/redo-is-inert-during-a-run — `redo` acts only while editing, so a live
// run swallows the key whatever its status.
//
// THE RULE. Undo and redo "both act ONLY WHILE EDITING and on the open challenge's
// machine alone" (`specs/editor.md`, Undo and redo), which `specs/controls.md`
// states from the other side twice over: `redo` is "Editor, while editing:
// re-applies the latest undone edit", and the table of what each screen reads
// gives the editor "while editing" `undo` and `redo` and gives the editor
// "`running` or `paused`" and "`faulted` or `complete`" neither. "An action a row
// omits does nothing on that screen." What must not move is `editor.parts` and
// `editor.redoDepth` (`specs/instrumentation.md`).
//
// ALL FOUR STATUSES ARE POSED, because the rule is about a run rather than about
// one status, and `specs/simulation.md` names four: "`sim.status` is one of
// `running`, `paused`, `faulted`, and `complete`."
//
//   - `running`  — an arm at rest, the run started through the surface.
//   - `paused`   — the same, then `setPaused(true)`.
//   - `faulted`  — a piston at `ARM_MIN_LEN` fetching `retract`, which
//                  `specs/simulation.md` names `overretracted`.
//   - `complete` — a challenge whose `target` is `1`, its set placed, the tally
//                  posed at the target, and one cycle run to the boundary where
//                  "if every set's tally has reached the challenge's `target`, the
//                  run completes".
//
// EACH SCENARIO CARRIES A REAL REDO SIDE, and the check reads that it does. Every
// scenario commits TWO edits and undoes one before its run starts, so "the latest
// undone edit" the key would re-apply is standing there waiting; a build that
// emptied the redo side at the start of a run would leave this item deciding
// nothing, so an empty redo side fails it. The second edit is chosen so that
// undoing it leaves the machine the scenario's status needs: the piston keeps its
// `retract`, and the set keeps its place.
//
// THE EDITS ARE MADE THROUGH THE KEYS, because `specs/instrumentation.md` says of
// the machine operations that "None pushes an undo entry, so `undoDepth` and
// `redoDepth` move under edits made through the pointer and the keys alone".
//
// THE FOUR SCENARIOS ARE DRIVEN BEFORE ANYTHING IS ASSERTED, so the evidence the
// item declares survives a failing check.
//
// THE VERDICT. In every status the press leaves `editor.parts` exactly as it stood
// and `editor.redoDepth` exactly where it stood.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import type { SimStatusName } from "../constants";
import { BARE, EAST, ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  holdCompletion,
  openChallengeDocument,
  pauseRun,
  placePart,
  placeSet,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Place an arm, turn it twice through the keys, and undo one of the turns: two
 * committed edits, one of them waiting on the redo side.
 */
async function armWithAnUndoneTurn(): Promise<void> {
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setFocus("field");
  await h.debug.setSelected(arm);
  await pressAction(h, "part-cw");
  await pressAction(h, "part-cw");
  await pressAction(h, "undo");
}

/** Pose a live run in each of the four statuses, over a machine with a redo side. */
const SCENARIOS: readonly {
  status: SimStatusName;
  pose: () => Promise<void>;
}[] = [
  {
    status: "running",
    pose: async () => {
      await openChallengeDocument(h, BARE);
      await armWithAnUndoneTurn();
      await holdCompletion(h);
      await h.debug.startRun();
    },
  },
  {
    status: "paused",
    pose: async () => {
      await openChallengeDocument(h, BARE);
      await armWithAnUndoneTurn();
      await holdCompletion(h);
      await h.debug.startRun();
      await pauseRun(h);
    },
  },
  {
    status: "faulted",
    pose: async () => {
      await openChallengeDocument(h, BARE);
      const piston = await placePart(h, "piston", ORIGIN);
      await h.debug.setFocus("tape");
      await h.debug.setCursor(piston, 0);
      await pressAction(h, "ins-retract");
      await pressAction(h, "ins-grab");
      await pressAction(h, "undo");
      await holdCompletion(h);
      await h.debug.startRun();
      await advanceCycles(h, 1);
    },
  },
  {
    status: "complete",
    pose: async () => {
      await openChallengeDocument(h, ONE_DELIVERY);
      await placeSet(h, 0, EAST);
      await armWithAnUndoneTurn();
      await allowCompletion(h);
      await h.debug.startRun();
      await h.debug.setTally(0, ONE_DELIVERY.target);
      await advanceCycles(h, 1);
    },
  },
];

it("leaves the machine and the redo depth as they stand in every run status", async () => {
  const readings: { before: OrrerySnapshot; after: OrrerySnapshot }[] = [];
  for (const scenario of SCENARIOS) {
    await scenario.pose();
    const before = await h.snapshot();
    await pressAction(h, "redo");
    readings.push({ before, after: await h.snapshot() });
  }

  await h.advance(1);
  await captureStill(h, "inert");

  for (const [index, scenario] of SCENARIOS.entries()) {
    const reading = readings[index];
    assertNotNull(reading, `the ${scenario.status} scenario was driven`);
    const before = reading?.before as OrrerySnapshot;
    const after = reading?.after as OrrerySnapshot;

    assertEqual(
      before.sim?.status,
      scenario.status,
      `the run stands at ${scenario.status} when the redo is pressed`,
    );
    assertGreaterThan(
      before.editor.redoDepth,
      0,
      `an undone edit is waiting on the redo side of the ${scenario.status} run`,
    );

    assertDeepEqual(
      after.editor.parts,
      before.editor.parts,
      `redo acts only while editing, so a ${scenario.status} run leaves editor.parts as it stands`,
    );
    assertEqual(
      after.editor.redoDepth,
      before.editor.redoDepth,
      `and leaves editor.redoDepth as it stands in a ${scenario.status} run`,
    );
  }
});
