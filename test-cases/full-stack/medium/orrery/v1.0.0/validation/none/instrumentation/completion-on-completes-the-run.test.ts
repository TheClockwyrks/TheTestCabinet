// instrumentation/completion-on-completes-the-run — with the switch on, a boundary
// that reaches the target ends the run and books everything completing a challenge
// books.
//
// THE RULE. `specs/instrumentation.md`'s switch table, while the switch is ON: "A
// boundary at which every set's tally has reached the challenge's `target`
// completes the run, records the metrics, marks the challenge solved, and unlocks
// what its mode unlocks, as `specs/simulation.md` states." That is the state the
// game is played in — "The switch is on when the game is played, `reset` restores
// it" — and `specs/simulation.md` spells the consequences out: "After the rises, if
// every set's tally has reached the challenge's `target`, the run completes: the
// status becomes `complete` and the metrics are recorded", with `cost` "the
// machine's cost", `cycles` "`sim.cycle + 1` at the completing boundary" and `area`
// "the size of the area bank"; then "Completing a challenge marks it solved,
// unlocks what its mode unlocks, and updates the challenge's records."
//
// TWO POSED WORLDS, BECAUSE THE TWO MODES UNLOCK DIFFERENTLY.
//
//   First, `First Light` — Extra 1 of `specs/challenges.md`, one `sol` in, the same
//   `sol` out, `target` `6` — with a machine of ONE SET, so the completing boundary
//   is reached by one constellation delivered onto that set and by nothing else,
//   and every figure the metrics carry is one this check can compute from the
//   specification: the cost of the machine by `specs/parts.md`, `sim.cycle + 1`,
//   and the area bank the snapshot reports. `specs/modes/extras.md` unlocks
//   nothing — "Every challenge is unlocked from the start" — so what the Extras
//   unlock is nothing, and the unlocked count must not move.
//
//   Then the first CAMPAIGN challenge, on the build's own reference solution, where
//   `specs/modes/campaign.md` does unlock something: "Completing challenge `n`
//   unlocks challenge `n + 1` when the course holds one." That is what "unlocks
//   what its mode unlocks" comes to on a course, and the count moving from one to
//   two is the reading.
//
// EVERY TAPE IS BLANKED AND THE FIELD EMPTIED in the campaign world — the gate
// `specs/instrumentation.md` names for a part's motion — so the cycle that completes
// carries nothing and faults at nothing, and the completion check is the only thing
// that can end it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { EAST } from "../fixtures";
import { machineCost } from "../parts";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  holdMotion,
  partIds,
  partsOf,
  placeSet,
  progressOf,
  readMachine,
  referenceSolution,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** `First Light` is Extra 1, whose one product is a lone `sol`. */
const EXTRA_INDEX = 0;

/** The first challenge of the course, the one that is open from the start. */
const CHALLENGE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("completes, records, solves and unlocks at the boundary that reaches the target", async () => {
  // A shipped Extra, completed by one delivery onto one set.
  await h.debug.reset();
  await h.debug.openChallenge("extras", EXTRA_INDEX);
  await h.debug.clearMachine();
  await placeSet(h, 0, EAST);
  await h.debug.startRun();
  await h.debug.clearMotes();

  const opened = await h.snapshot();
  assertEqual(
    opened.completion,
    true,
    "the completion switch is on, which is how the game is played",
  );
  assertEqual(
    opened.challenge?.target,
    CONSTELLATION_TARGET,
    "First Light asks for CONSTELLATION_TARGET constellations",
  );
  const cost = machineCost(partsOf(await readMachine(h)));

  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);
  await spawnMote(h, EAST, "sol");
  await captureReplay(h, "completed", () => advanceCycles(h, 1));

  const completed = await h.snapshot();
  assertNotNull(completed.sim, "the run is still reported at the boundary");
  assertEqual(
    tallyOf(completed, 0),
    CONSTELLATION_TARGET,
    "the boundary delivered the constellation that reached the target",
  );
  assertEqual(
    completed.sim?.status,
    "complete",
    "and the completion check fired: the run completed",
  );
  const metrics = completed.sim?.metrics ?? null;
  assertNotNull(metrics, "and the metrics were recorded");
  assertEqual(metrics?.cost, cost, "cost is the machine's cost");
  assertEqual(
    metrics?.cycles,
    (completed.sim?.cycle ?? -1) + 1,
    "cycles is sim.cycle + 1 at the completing boundary",
  );
  assertEqual(
    metrics?.area,
    completed.sim?.area,
    "area is the size of the area bank the boundary left",
  );
  assertContains(
    progressOf(completed, "extras").solved,
    EXTRA_INDEX,
    "the challenge is marked solved",
  );
  assertDeepEqual(
    progressOf(completed, "extras").records[EXTRA_INDEX],
    metrics,
    "and its records were updated with what the run recorded",
  );
  assertEqual(
    progressOf(completed, "campaign").unlockedCount,
    1,
    "and the Extras unlock nothing, so the course is as it was",
  );

  // A campaign challenge, where completing unlocks the next one.
  await h.debug.reset();
  await h.debug.openChallenge("campaign", CHALLENGE);
  await h.debug.loadSolution(await referenceSolution(h, "campaign", CHALLENGE));
  const course = await h.snapshot();
  assertGreaterThan(
    course.campaign.count,
    1,
    "the course holds a challenge after the first for completing it to unlock",
  );
  assertEqual(
    course.campaign.unlockedCount,
    1,
    "and only the first of them is open before the run",
  );
  const target = course.challenge?.target ?? 0;
  const products = course.challenge?.products.length ?? 0;

  await h.debug.startRun();
  await h.debug.clearMotes();
  for (const part of await partIds(h)) await holdMotion(h, part);
  for (let product = 0; product < products; product += 1) {
    await h.debug.setTally(product, target);
  }
  await advanceCycles(h, 1);

  const solved = await h.snapshot();
  assertEqual(
    solved.sim?.status,
    "complete",
    "the boundary at which every set's tally has reached the target completes the run",
  );
  assertContains(
    progressOf(solved, "campaign").solved,
    CHALLENGE,
    "marking the campaign challenge solved",
  );
  assertEqual(
    progressOf(solved, "campaign").unlockedCount,
    2,
    "and unlocking what its mode unlocks: completing challenge n opens challenge n + 1",
  );
});
