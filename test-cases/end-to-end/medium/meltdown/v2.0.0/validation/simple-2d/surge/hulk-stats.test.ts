// surge/hulk-stats — the Hulk's row of the roster: HP 220, speed 38, slowable,
// walks, bounty 7, leak 2.
//
// THE RULE. specs/surge.md's table of the six types gives the Hulk `220` hp, a
// speed of `38` logical units per second, `yes` to slowable, `no` to flies, a
// bounty of `7` and a leak of `2`. Those six columns are this point, and they are
// read one column at a time, each with the column's name on its failure.
//
// WHY THE SIX SPLIT INTO TWO KINDS OF READING. Three columns the unit reports
// itself and are read off the snapshot the vent's arrival produced: `maxHp`,
// `baseSpeed`, `flying`. The other three are BEHAVIOUR that no field carries — a
// bounty is money paid on the frame hp reaches `0` (specs/economy.md), a leak
// value is lives taken on the frame a unit reaches its exhaust (specs/surge.md),
// and slowable is whether a Rime's slow touches it at all (specs/combat.md) — so
// each is reached the way the game reaches it, on a floor of its own, by
// `surge/roster.ts`.
//
// THE HULK IS ONE OF THE TWO ROWS THAT LEAK MORE THAN A LIFE, and its `2` is the
// figure that tells a build reading the table from one that took every leak to
// cost one. `hulk-leaks-two-lives` is the point that says so on its own; this one
// reads it as one column of the row, so a build whose Hulk is right in every other
// column and wrong in that one is graded on both.
//
// WHY THE HP READING IS TAKEN ON WAVE 1. specs/waves.md scales a unit's maximum hp
// by `1 + 0.62 * (w - 1)`, which is `1` on Wave 1 and only there, so a Wave 1
// arrival is the one place the base figure can be read without the scaling on top
// of it. `hp-scales-with-the-wave` is the point that reads the scaling.
//
// WHAT EVERY WRONG MODEL READS. A build that took every leak to cost one life
// reads `1` where this row says `2`; one that paid a flat bounty reads the Mote's
// `3` where this row says `7`; one that gave every ground unit one speed reads
// `60` where this row says `38`. Each is a different reading from the row.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../constants";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bountyPaidFor, livesLostTo, readArrival, slowTouches } from "./roster";

/** The type this point is the row of. */
const TYPE = "hulk";

/** The row specs/surge.md gives it, as the case seeded it. */
const ROW = SURGE_DEFS[TYPE];

/**
 * The decimal places an hp or a speed reading is compared to: six.
 *
 * Both figures are whole numbers in the table and the Wave 1 scaling is exactly
 * `1`, so nothing but floating-point arithmetic can separate a correct build's
 * reading from the figure. Six places is a tolerance of `5e-7`, which is far below
 * any difference between two rows of the table and far above the error of
 * multiplying by one.
 */
const FIGURE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries 220 hp, speed 38, walks, is slowable, pays 7 and costs two lives", async () => {
  const arrived = await readArrival(h, TYPE);
  captureStill(h, "hulk");

  const bounty = await bountyPaidFor(h, TYPE);
  const leak = await livesLostTo(h, TYPE);
  const slow = await slowTouches(h, TYPE);

  assertEqual(arrived.type, TYPE, "the type the vent released");
  assertCloseTo(
    arrived.maxHp,
    ROW.hp,
    FIGURE_DIGITS,
    "its maximum hp on wave 1",
  );
  assertCloseTo(arrived.hp, arrived.maxHp, FIGURE_DIGITS, "its hp on arrival");
  assertCloseTo(
    arrived.baseSpeed,
    ROW.speed,
    FIGURE_DIGITS,
    "its unslowed speed",
  );
  assertCloseTo(
    arrived.speed,
    ROW.speed,
    FIGURE_DIGITS,
    "its current speed, with nothing slowing it",
  );
  assertEqual(arrived.flying, ROW.flies, "whether it flies");

  assertTrue(bounty.killed, "precondition: the Arc's shot killed the Hulk");
  assertEqual(bounty.paid, ROW.bounty, "the money killing it paid");

  assertTrue(leak.leaked, "precondition: the Hulk reached its exhaust");
  assertTrue(leak.gone, "it left the roster on reaching its exhaust");
  assertEqual(leak.lost, ROW.leak, "the lives leaking it cost");

  assertTrue(slow.struck, "precondition: the Rime's shot landed on the Hulk");
  assertEqual(slow.slowed, ROW.slowable, "whether a Rime's slow touched it");
});
