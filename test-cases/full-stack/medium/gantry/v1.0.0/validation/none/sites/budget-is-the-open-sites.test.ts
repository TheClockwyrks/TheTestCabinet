// sites/budget-is-the-open-sites — the budget an edit is measured against is the
// open site's, not one ceiling for the whole game.
//
// specs/structure.md § Cost and the budget: "Each site fixes a budget, and the
// cost never exceeds it: an edit that would take the cost past the budget is
// refused." specs/sites.md gives Site 1 — First Lift `Budget | 3000` and Site 6
// — Heavy Haul `Budget | 6000`, and § The site table has `SITES` carry all six
// "exactly as this file states them".
//
// THIS IS THE POINT A SINGLE HARD-CODED BUDGET FAILS, and nothing else catches:
// a build that measured every site against one figure reports six correct
// budgets on six build screens and still refuses — or still accepts — the same
// crane everywhere. So the requirement is decided the only way it can be: the
// SAME sequence of edits, in the same order, is run out on both sites and the
// two structures are read back.
//
// THE SEQUENCE IS TWENTY-EIGHT RAILS, chosen so the ceiling falls inside it.
// Each is six units long — `RAIL_MAX_LEN` — at `RAIL_COST_PER_UNIT` (`18`), so
// each costs `108` and the twenty-eighth takes the running cost from `2916` to
// `3024`: past First Lift's `3000` and well inside Heavy Haul's `6000`. Every
// node lies in the box the two sites share (`x -8..12`, `y 0..16`, `z -8..8`),
// so the envelope refuses nothing on either; every rail is horizontal, which is
// the one rail rule specs/structure.md enforces at placement time; no two rails
// share a node pair; and with no ring placed there is no arm and no top flange,
// so the rule against joining the arm to the tower cannot bite. The budget is
// therefore the only rule left that can decide any of the twenty-eight edits.
//
// A REFUSAL IS SILENT (specs/structure.md: "a refused edit changes nothing"), so
// what First Lift reports is the twenty-seven members it kept and the `2916`
// they cost — the structure stands part-built rather than erroring — while Heavy
// Haul carries all twenty-eight.
//
// NOTHING IS BUILT TO RUN HERE, so the structure needs no ring, no track and no
// tape: this point is decided by the editor's ceiling and by nothing downstream
// of it. `clearAll` empties both sites first, so each sequence starts from zero
// spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual, assertNear } from "../assert";
import { RAIL_COST_PER_UNIT, RAIL_MAX_LEN } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Heavy Haul, `Budget | 6000`: the site the whole sequence fits inside. */
const RICH_SITE = 5;

/** First Lift, `Budget | 3000`: the site the sequence outgrows. */
const POOR_SITE = 0;

/** First Lift's budget, the ceiling the sequence crosses. */
const POOR_BUDGET = 3000;

/** One rail at its maximum length: `6 * 18`. */
const RAIL_COST = RAIL_MAX_LEN * RAIL_COST_PER_UNIT;

/**
 * The rails, in the order both sites are given them: one six-unit run of rail
 * from `x -8` to `x -2` per `(y, z)`, all inside the box the two sites share.
 */
const RAILS: readonly { y: number; z: number }[] = [0, 2, 4, 6].flatMap((y) =>
  [-8, -6, -4, -2, 0, 2, 4, 6, 8].map((z) => ({ y, z })),
);

/** The first edit whose cost passes First Lift's budget is the 28th. */
const COUNT = 28;

/** What the sequence costs in full, and what it costs one edit short. */
const FULL_COST = COUNT * RAIL_COST;
const SHORT_COST = (COUNT - 1) * RAIL_COST;

/** Place the sequence, in order, on the site that is open. */
async function poseRails(harness: Harness): Promise<void> {
  for (const { y, z } of RAILS.slice(0, COUNT)) {
    await harness.debug.addMember(-8, y, z, -2, y, z, "rail");
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("builds the whole sequence under the richer site's budget and refuses it part-built under the poorer site's", async () => {
  await openSite(h, RICH_SITE);
  await clearAll(h);
  await poseRails(h);
  const rich = (await h.snapshot()).structure;

  await openSite(h, POOR_SITE);
  await clearAll(h);
  await poseRails(h);
  const poor = (await h.snapshot()).structure;

  // The still is First Lift, where the sequence stopped short: the cost and the
  // budget the editor always shows (specs/ui.md), with the members the refused
  // edit left standing.
  await h.advance(1);
  await h.capture(
    "budgets",
    "The same build sequence run out against two budgets",
  );

  assertLength(
    rich.members,
    COUNT,
    `the members Site 6 takes, all ${COUNT} inside its budget of 6000 ` +
      "(specs/sites.md § Site 6 — Heavy Haul)",
  );
  assertNear(
    rich.cost,
    FULL_COST,
    0.01,
    "what the whole sequence costs on Site 6 (specs/structure.md)",
  );

  assertLength(
    poor.members,
    COUNT - 1,
    "the members Site 1 keeps: the edit that would take the cost past its " +
      "budget of 3000 is refused and the ones before it stand " +
      "(specs/structure.md)",
  );
  assertNear(
    poor.cost,
    SHORT_COST,
    0.01,
    "what Site 1 spent before the refusal (specs/structure.md)",
  );
  assertLessThanOrEqual(
    poor.cost,
    POOR_BUDGET,
    "Site 1's cost, which never exceeds its budget (specs/structure.md)",
  );
});
