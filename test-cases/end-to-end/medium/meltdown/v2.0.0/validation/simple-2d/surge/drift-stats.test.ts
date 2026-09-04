// surge/drift-stats — the Drift's row of the roster: HP 60, speed 80, slowable,
// FLIES, bounty 6, leak 1.
//
// THE RULE. specs/surge.md's table of the six types gives the Drift `60` hp, a
// speed of `80` logical units per second, `yes` to slowable, `yes` to flies, a
// bounty of `6` and a leak of `1`. Those six columns are this point, and they are
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
// THE FLIES COLUMN IS THIS ROW'S OWN. The Drift is the one type specs/surge.md
// marks `yes` under Flies — "the flyer, and it ignores the maze entirely" — so
// `flying` true is a reading no other row can give, and the five other `*-stats`
// points each read it false. What flight DOES is specs/mazing.md's, and the
// `mazing` group decides it; this point reads only that the unit carries the flag
// its row gives it.
//
// A FLYER IS AN ORDINARY TARGET. specs/combat.md: "Every emitter targets ground
// units and flyers alike, except the Flak", so the Arc that reads this row's
// bounty and the Rime that reads its slowability both take it under the ordinary
// rule, and neither reading needs anything of the air.
//
// WHY THE HP READING IS TAKEN ON WAVE 1. specs/waves.md scales a unit's maximum hp
// by `1 + 0.62 * (w - 1)`, which is `1` on Wave 1 and only there, so a Wave 1
// arrival is the one place the base figure can be read without the scaling on top
// of it. `hp-scales-with-the-wave` is the point that reads the scaling.
//
// WHAT EVERY WRONG MODEL READS. A build with no flyer at all reads `flying` false;
// one that made the flyer immune to slowing along with the boss reads `slowed`
// false with the Rime's shot demonstrably landed; one that paid a flat bounty
// reads something other than `6`. Each is a different reading from the row.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { SURGE_DEFS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { bountyPaidFor, livesLostTo, readArrival, slowTouches } from "./roster";

/** The type this point is the row of. */
const TYPE = "drift";

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

it("carries 60 hp, speed 80, flies, is slowable, pays 6 and costs a life", async () => {
  const arrived = await readArrival(h, TYPE);
  captureStill(h, "drift");

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

  assertTrue(bounty.killed, "precondition: the Arc's shot killed the Drift");
  assertEqual(bounty.paid, ROW.bounty, "the money killing it paid");

  assertTrue(leak.leaked, "precondition: the Drift reached its exhaust");
  assertTrue(leak.gone, "it left the roster on reaching its exhaust");
  assertEqual(leak.lost, ROW.leak, "the lives leaking it cost");

  assertTrue(slow.struck, "precondition: the Rime's shot landed on the Drift");
  assertEqual(slow.slowed, ROW.slowable, "whether a Rime's slow touched it");
});
