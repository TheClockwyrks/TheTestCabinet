// economy/bounty-paid-on-a-kill — a kill pays the killed unit's bounty into the
// money.
//
// specs/economy.md's income table: the Bounty line pays "The killed unit's
// bounty", "On the frame a unit's hp reaches `0`". specs/surge.md's roster fixes
// the figure per type, which `SURGE_DEFS` restates: a Mote's bounty is `3` and a
// Core's is `90`.
//
// TWO TYPES, BECAUSE ONE FIGURE CANNOT TELL A TABLE FROM A CONSTANT. A build that
// pays a flat bounty on every death reads the same number for both, so the pair is
// what makes the reading a reading of the table. `3` and `90` are the two ends of
// the roster, thirty times apart, so no arithmetic a build could have put in place
// of the lookup — an hp-derived figure, a wave-scaled one, a flat one — lands on
// both.
//
// THE FLOOR HOLDS ONE GUN AND ONE MARK. The Arc's thermal model is off, so the
// heat that scales its damage cannot move and no trip can interrupt the drive
// (economy/payment.ts); the mark holds its tile with one hp, so it dies to the
// shot rather than walking out of range or reaching an exhaust and leaking, which
// pays a different figure entirely. Nothing else stands on the floor, so the only
// event that can move the money is the one death.
//
// THE PHASE IS `building`, WHICH IS WHAT KEEPS THIS ONE FIGURE ALONE. A wave
// clears only while the phase is `wave` (specs/waves.md), so a kill driven in a
// build phase cannot also pay a wave-clear bonus and this point reads the bounty
// and nothing else.
//
// WHAT EVERY WRONG MODEL READS. A build that pays a flat bounty reads one figure
// twice; one that pays the unit's maximum hp reads `1` for both, since the mark is
// posed at one hp; one that pays nothing reads `0`; one that pays the bounty into
// the score alone reads `0`. Each is a different pair from `(3, 90)`.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseGun, poseMark, runUntilGone } from "./payment";

/** What killing a Mote must add to the money. */
const MOTE_BOUNTY = SURGE_DEFS.mote.bounty;

/** What killing a Core must add to the money. */
const CORE_BOUNTY = SURGE_DEFS.core.bounty;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays 3 for a Mote and 90 for a Core, on the frame the hp reaches 0", async () => {
  startRun(h);
  poseGun(h);

  poseMark(h, "mote");
  const beforeMote = h.snapshot().money;
  const moteDied = await runUntilGone(h);
  const afterMote = h.snapshot().money;

  poseMark(h, "core");
  const beforeCore = afterMote;
  const coreDied = await runUntilGone(h);

  captureStill(h, "bounty");
  const afterCore = h.snapshot().money;

  assertTrue(moteDied, "precondition: the Arc's shot killed the Mote");
  assertTrue(coreDied, "precondition: the Arc's shot killed the Core");
  assertEqual(
    afterMote - beforeMote,
    MOTE_BOUNTY,
    "the money a killed Mote paid",
  );
  assertEqual(
    afterCore - beforeCore,
    CORE_BOUNTY,
    "the money a killed Core paid",
  );
});
