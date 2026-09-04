// press/dismantle-returns-nothing — dismantling refunds no Charge and no stamp,
// for any structure including a candidate placed the same phase.
//
// THE CANDIDATE IS THE CASE THAT MATTERS. `specs/scrap-press.md` says
// dismantling returns nothing, and `specs/economy.md` says there is no selling
// and nothing placed is ever refunded — but a build that refunds the STAMP has
// invented an unlimited reroll: drop a rock, dislike the roll, dismantle, drop
// again, all level long, and the five-per-level allowance and the whole
// refinement track stop meaning anything.
//
// So both resources are read either side of dismantling a candidate placed this
// phase and a standing component, which are the two things a player would most
// want back.

import { afterEach, beforeEach, it } from "vitest";

import { STAMPS_PER_LEVEL } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  standComponent,
  type Harness,
} from "../harness";

/** Charge in the bank, so a refund would be plain to see. */
const CHARGE = 100;

/** Where the candidate and the component stand. */
const CANDIDATE_AT = { col: 20, row: 10 };
const COMPONENT_AT = { col: 24, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns neither Charge nor a stamp for a candidate or a component", async () => {
  openYard(h, { charge: CHARGE });

  const candidate = standCandidate(
    h,
    "discharge",
    3,
    CANDIDATE_AT.col,
    CANDIDATE_AT.row,
  );
  const component = standComponent(
    h,
    "capacitor",
    5,
    COMPONENT_AT.col,
    COMPONENT_AT.row,
  );

  const before = h.snapshot();
  assertEqual(before.charge, CHARGE, "the Charge before any dismantle");
  assertEqual(
    before.stampsLeft,
    STAMPS_PER_LEVEL - 1,
    "the stamps left with one rock on the yard",
  );

  h.debug.dismantle(candidate);
  const withoutCandidate = h.snapshot();
  assertEqual(
    withoutCandidate.charge,
    before.charge,
    "the Charge after dismantling a candidate placed this phase",
  );
  assertEqual(
    withoutCandidate.stampsLeft,
    before.stampsLeft,
    "the stamps left after dismantling a candidate placed this phase, which " +
      "returns none: a roll cannot be reclaimed and re-rolled",
  );

  h.debug.dismantle(component);
  const empty = h.snapshot();
  await h.advance(1);
  captureStill(h, "hud");

  assertEqual(
    empty.charge,
    before.charge,
    "the Charge after dismantling a standing component",
  );
  assertEqual(
    empty.stampsLeft,
    before.stampsLeft,
    "the stamps left after dismantling a standing component",
  );
  assertLength(empty.structures, 0, "the structures left on the yard");
});
