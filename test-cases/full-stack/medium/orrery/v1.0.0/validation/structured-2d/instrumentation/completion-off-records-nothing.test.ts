// instrumentation/completion-off-records-nothing — a run carried past its target
// with the switch off leaves progress exactly where it stood.
//
// THE RULE. `specs/instrumentation.md`'s switch table, while the switch is OFF:
// "The completion check does not fire. The run carries on past a satisfied target,
// and nothing is recorded, solved, or unlocked." The four things that would
// otherwise happen are the ON column's, which is `specs/simulation.md`'s completion:
// "the status becomes `complete` and the metrics are recorded ... Completing a
// challenge marks it solved, unlocks what its mode unlocks, and updates the
// challenge's records."
//
// THE CHALLENGE IS A CAMPAIGN CHALLENGE, because the campaign is where all four
// consequences are visible: `specs/modes/campaign.md` says "Completing challenge
// `n` unlocks challenge `n + 1` when the course holds one", while
// `specs/modes/extras.md`'s shelf "is open from the start" and unlocks nothing at
// all. So a run that wrongly completed here would move the unlocked count, and this
// is the check that would see it.
//
// THE MACHINE IS THE BUILD'S OWN REFERENCE SOLUTION for that challenge, which
// `specs/modes/campaign.md` requires one of per challenge and
// `specs/instrumentation.md` makes reachable: "`referenceSolution(mode, index)` — A
// pure read: the build's own reference solution for that challenge". It is a legal
// machine holding a set for every product, which is what the completion check needs
// to have anything to read. Every tape on it is then blanked — the gate
// `specs/instrumentation.md` names for a part's motion, "leaving its tape cell for
// the cycle blank, which every part rests on" — and the field is emptied, so the
// cycle under test carries nothing, collides with nothing and faults at nothing:
// the only thing that could end it is the completion check.
//
// THE TARGET IS SATISFIED WITH `setTally`, on every product the challenge names,
// so the boundary the run then crosses is a boundary at which "every set's tally
// has reached the challenge's `target`" — the boundary the ON column completes at,
// and the boundary the OFF column must leave alone.
//
// THE RECORDS ARE POSED BEFORE THE RUN, rather than left empty, so "its records as
// they stood" is read as the figures that stood there rather than as an absence: a
// build that completed and wrote a better record over them fails here even though
// an empty record would also have been written.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { METRICS } from "../constants";
import {
  advanceCycles,
  captureStill,
  createHarness,
  holdMotion,
  partIds,
  progressOf,
  referenceSolution,
  type Harness,
} from "../harness";

/** The first challenge of the course, which is the one that is open from the start. */
const CHALLENGE = 0;

/** A record posed on that challenge before the run, in every metric. */
const POSED_RECORD = { cost: 7, cycles: 7, area: 7 };

/** How many campaign challenges are posed as open, so a wrong unlock would show. */
const POSED_UNLOCKED = 3;

/** Boundaries crossed past the satisfied target. */
const PAST = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records, solves and unlocks nothing while the switch is held off", async () => {
  await h.debug.reset();
  await h.debug.setUnlockedCount(POSED_UNLOCKED);
  for (const metric of METRICS) {
    await h.debug.setRecord(
      "campaign",
      CHALLENGE,
      metric,
      POSED_RECORD[metric],
    );
  }
  await h.debug.openChallenge("campaign", CHALLENGE);
  await h.debug.loadSolution(await referenceSolution(h, "campaign", CHALLENGE));

  const posed = await h.snapshot();
  assertNotNull(
    posed.challenge,
    "the campaign challenge is open in the editor",
  );
  assertGreaterThan(
    posed.editor.parts.length,
    0,
    "the build's own reference solution for it is a machine",
  );
  const target = posed.challenge?.target ?? 0;
  const products = posed.challenge?.products.length ?? 0;
  assertGreaterThan(
    target,
    0,
    "a challenge asks for at least one constellation",
  );
  assertGreaterThan(products, 0, "and names at least one product");

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  for (const part of await partIds(h)) await holdMotion(h, part);
  for (let product = 0; product < products; product += 1) {
    await h.debug.setTally(product, target);
  }

  const satisfied = await h.snapshot();
  assertEqual(
    satisfied.completion,
    false,
    "the completion switch is held off for the whole run",
  );
  assertDeepEqual(
    satisfied.sim?.tallies,
    Array.from({ length: products }, () => target),
    "every set's tally has reached the challenge's target",
  );

  await advanceCycles(h, PAST);
  await captureStill(h, "untouched");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the run carried on past the satisfied target",
  );
  assertGreaterThan(
    after.sim?.cycle ?? -1,
    0,
    "over boundaries the completion check would have ended it at",
  );
  assertNull(after.sim?.metrics ?? null, "sim.metrics is left null");
  assertDeepEqual(
    progressOf(after, "campaign").solved,
    [],
    "the challenge is left unsolved",
  );
  assertDeepEqual(
    progressOf(after, "campaign").records[CHALLENGE],
    POSED_RECORD,
    "and its records stand exactly as they stood",
  );
  assertEqual(
    progressOf(after, "campaign").unlockedCount,
    POSED_UNLOCKED,
    "and the unlocked count is unchanged",
  );
});
