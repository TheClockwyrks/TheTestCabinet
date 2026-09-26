// editor/undo-is-inert-during-a-run — `undo` acts only while editing, so a live
// run swallows the key whatever its status.
//
// THE RULE. Undo and redo "both act ONLY WHILE EDITING and on the open challenge's
// machine alone" (`specs/editor.md`, Undo and redo), which `specs/controls.md`
// states from the other side twice over: `undo` is "Editor, while editing:
// reverts the latest edit", and the table of what each screen reads gives the
// editor "while editing" `undo` and `redo` and gives the editor "`running` or
// `paused`" and "`faulted` or `complete`" neither. "An action a row omits does
// nothing on that screen." What must not move is `editor.parts` and
// `editor.undoDepth` (`specs/instrumentation.md`).
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
// EACH SCENARIO CARRIES A REAL HISTORY, and the check reads that it does. "The
// history holds every edit of the visit" (`specs/editor.md`), and a run is inside
// the visit, so the entries a scenario committed before starting its run are still
// there; a build that emptied the history at the start of a run would leave this
// item deciding nothing, so an empty undo side fails it. The edits are made
// through the keys because `specs/instrumentation.md` says of the machine
// operations that "None pushes an undo entry".
//
// THE FOUR SCENARIOS ARE DRIVEN BEFORE ANYTHING IS ASSERTED, so the evidence the
// item declares survives a failing check.
//
// THE VERDICT. In every status the press leaves `editor.parts` exactly as it stood
// and `editor.undoDepth` exactly where it stood.

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

/** Place an arm and turn it once through the keys: one committed edit. */
async function editedArm(): Promise<void> {
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setFocus("field");
  await h.debug.setSelected(arm);
  await pressAction(h, "part-cw");
}

/** Pose a live run in each of the four statuses, over a machine with a history. */
const SCENARIOS: readonly {
  status: SimStatusName;
  pose: () => Promise<void>;
}[] = [
  {
    status: "running",
    pose: async () => {
      await openChallengeDocument(h, BARE);
      await editedArm();
      await holdCompletion(h);
      await h.debug.startRun();
    },
  },
  {
    status: "paused",
    pose: async () => {
      await openChallengeDocument(h, BARE);
      await editedArm();
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
      await editedArm();
      await allowCompletion(h);
      await h.debug.startRun();
      await h.debug.setTally(0, ONE_DELIVERY.target);
      await advanceCycles(h, 1);
    },
  },
];

it("leaves the machine and the undo depth as they stand in every run status", async () => {
  const readings: { before: OrrerySnapshot; after: OrrerySnapshot }[] = [];
  for (const scenario of SCENARIOS) {
    await scenario.pose();
    const before = await h.snapshot();
    await pressAction(h, "undo");
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
      `the run stands at ${scenario.status} when the undo is pressed`,
    );
    assertGreaterThan(
      before.editor.undoDepth,
      0,
      `the history holds every edit of the visit, so the ${scenario.status} run still has one to take`,
    );

    assertDeepEqual(
      after.editor.parts,
      before.editor.parts,
      `undo acts only while editing, so a ${scenario.status} run leaves editor.parts as it stands`,
    );
    assertEqual(
      after.editor.undoDepth,
      before.editor.undoDepth,
      `and leaves editor.undoDepth as it stands in a ${scenario.status} run`,
    );
  }
});
