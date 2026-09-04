// runs/custom-challenge-completion-touches-no-progress — a challenge that belongs
// to no course cannot advance one.
//
// THE RULE. "Completing a challenge whose source is `"custom"` touches no
// progress and no record" (`specs/instrumentation.md`, The challenge), which is
// the exception to `specs/simulation.md`'s "Completing a challenge marks it
// solved, unlocks what its mode unlocks, and updates the challenge's records".
// `specs/ui.md` says the same of the panel it puts up: "A challenge loaded
// directly through the surface of `specs/instrumentation.md` belongs to no
// course, so its panel never offers `NEXT CHALLENGE`, and `BACK TO SELECT` goes
// to the current `state.mode`'s select screen with every progress figure and
// record untouched."
//
// THE CONFIGURATION starts from progress that is NOT the resting state, because
// "nothing changed" is worth nothing when everything is already empty: after a
// `reset`, the check opens some campaign challenges, marks one solved in each
// mode and gives each a record of its own. Then it loads a challenge document
// through the surface — `target` `1`, so one delivery finishes it — places its
// set, and completes it in a single cycle. The challenge's `source` is read back
// as `"custom"` before the run, so what completes really is a challenge of no
// course.
//
// THE VERDICT. Both modes' solved sets, both modes' records and the campaign's
// unlocked count are exactly what they were before the run, while the run itself
// is `complete` with its metrics recorded — so the completion happened, and it
// reached nothing outside the run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { setPart, solution } from "../formats";
import { ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  progressOf,
  spawnMote,
  tallyOf,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The whole machine: one set for the loaded challenge's only product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/**
 * How many campaign challenges the check opens before loading its own, clamped
 * to the course the build actually ships: `setUnlockedCount` takes `1` to the
 * shipped course length, and how long that course is belongs to another point.
 */
const UNLOCKED = 3;

/** The index marked solved in each mode: the second row, which every course has. */
const SOLVED_ROW = 1;

/** The three progress figures the rule names, for both modes. */
function progress(snapshot: OrrerySnapshot): unknown {
  return {
    campaign: {
      unlockedCount: progressOf(snapshot, "campaign").unlockedCount,
      solved: progressOf(snapshot, "campaign").solved,
      records: progressOf(snapshot, "campaign").records,
    },
    extras: {
      solved: progressOf(snapshot, "extras").solved,
      records: progressOf(snapshot, "extras").records,
    },
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves both modes' solved sets, records and unlocked count exactly as they stood", async () => {
  await h.debug.reset();

  // Progress that is not the resting state, so "untouched" says something.
  const opened = await h.snapshot();
  const unlocked = Math.min(UNLOCKED, progressOf(opened, "campaign").count);
  await h.debug.setUnlockedCount(unlocked);
  await h.debug.setSolved("campaign", SOLVED_ROW, true);
  await h.debug.setRecord("campaign", SOLVED_ROW, "cost", 120);
  await h.debug.setSolved("extras", SOLVED_ROW, true);
  await h.debug.setRecord("extras", SOLVED_ROW, "cycles", 9);

  await openChallengeDocument(h, ONE_DELIVERY);
  await loadMachine(h, ONE_SET);

  const before = await h.snapshot();
  assertEqual(
    before.challenge?.source,
    "custom",
    "the challenge was loaded through the surface, so it belongs to no course",
  );
  assertEqual(
    before.challenge?.index,
    null,
    "a custom challenge carries no index into a mode's list",
  );
  assertEqual(
    progressOf(before, "campaign").unlockedCount,
    unlocked,
    "the campaign really is opened past its first challenge",
  );
  assertDeepEqual(
    progressOf(before, "campaign").solved,
    [SOLVED_ROW],
    "the campaign really carries a solved challenge",
  );
  assertDeepEqual(
    progressOf(before, "extras").solved,
    [SOLVED_ROW],
    "the extras really carry a solved challenge",
  );
  const stood = progress(before);

  await h.debug.startRun();
  await spawnMote(h, ORIGIN, "sol");
  await advanceCycles(h, 1);
  await captureStill(h, "untouched");

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still reported once it has completed");
  assertEqual(
    after.sim?.status,
    "complete",
    "the loaded challenge really was completed, so the rule has something to hold over",
  );
  assertEqual(
    tallyOf(after, 0),
    1,
    "the delivery reached the loaded challenge's target of 1",
  );
  assertNotNull(
    after.sim?.metrics ?? null,
    "the run's own metrics are recorded: what is untouched is the challenge's records",
  );
  assertDeepEqual(
    progress(after),
    stood,
    "completing a loaded challenge touches neither mode's solved set, records or unlocked count",
  );
});
