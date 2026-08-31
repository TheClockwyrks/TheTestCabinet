// economy/money-never-negative — the balance never falls below zero.
//
// `specs/economy.md`: "Money never falls below `0`: a purchase the money on hand
// cannot cover does not happen at all, and nothing about the floor or the run
// changes when one is refused." This is the invariant the two overspend points
// state one purchase at a time, read across a session that spends, upgrades and
// sells right at the edge of what it can afford.
//
// WHY THIS ONE IS AN INTEGRATION READING. `economy.cannot-overspend-on-a-build`
// and `economy.cannot-overspend-on-an-upgrade` each decide one refusal in
// isolation. What neither can see is a build that guards the two purchases it was
// told to guard and lets the balance go under somewhere in between — a refund
// banked twice, a cost taken before its check, a sale of a tower a purchase had
// already been charged for. So this point plays a scripted session of twelve
// moves, all of them acts a player really makes, and reads the balance after
// every one. The session replays to a known place: nothing in it is random,
// nothing waits on the clock, and every move is the debug surface's own version
// of a press.
//
// WHY THE PURSE OPENS AT `47`. It is three Arcs at `15` (`specs/towers.md`) with
// `2` left over, so the session's third purchase leaves the balance two units
// above zero and the fourth cannot be afforded at all. Everything after that
// happens at the edge: an upgrade that cannot be paid for, a sale that funds one
// that can, a second upgrade that cannot, a sale that funds a purchase. A purse
// that opened round would have left the session buying comfortably and reading
// nothing.
//
// WHAT IS ASSERTED, AND IN ONE DIRECTION ONLY. That the balance is never
// negative, after every one of the twelve moves. Not what any move charged, not
// what any sale refunded, not whether a particular move was refused — those are
// the `building` group's figures, and a point that asserted them would fail a
// build whose refund rate is off while its floor at zero holds perfectly. The one
// further reading is a PRECONDITION rather than a verdict: the session must
// actually have reached the edge, which is to say the balance must at some point
// have fallen below the cheapest thing on the floor. Without it a build that
// simply refused every purchase would sail through on an untouched purse.
//
// WHAT EVERY WRONG MODEL READS. A build that charges before it checks reads a
// negative balance on the fourth move; one that charges an unaffordable upgrade
// reads one on the fifth; one that refunds a tower it never removed drifts
// upward instead and fails the precondition rather than the invariant.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import { TOWER_DEFS, type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  lastTower,
  startRun,
  type Harness,
} from "../harness";

/** The cheapest thing the shop sells, which is the Arc (`specs/towers.md`). */
const CHEAPEST = Math.min(...Object.values(TOWER_DEFS).map((def) => def.cost));

/** Three Arcs and two units of change: a purse that runs out mid-session. */
const PURSE = 3 * TOWER_DEFS.arc.cost + 2;

/** The floor a balance may never fall below (`specs/economy.md`). */
const FLOOR = 0;

/** The four 2x2 anchors the session's Arcs are aimed at, all on open floor. */
const ARC_SPOTS = [
  { col: 10, row: 10 },
  { col: 13, row: 10 },
  { col: 16, row: 10 },
  { col: 19, row: 10 },
] as const;

/** Where the session aims its one unaffordable Bloom, and its last Arc. */
const LATE_SPOT = { col: 25, row: 10 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("keeps the balance at or above zero across a session spent at the edge", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  /** Every balance the session left behind, in the order the moves were made. */
  const balances: { move: string; money: number }[] = [];

  /** Read the balance after a move, under the name the failure will carry. */
  const record = async (move: string): Promise<void> => {
    balances.push({ move, money: (await h.snapshot()).money });
  };

  /** Arm a type over a footprint and press the floor, as a player does. */
  const buy = async (
    type: TowerType,
    spot: { col: number; row: number },
    move: string,
  ): Promise<number | null> => {
    await h.debug.setArmed(type);
    await h.debug.setPreview(spot.col, spot.row);
    await h.debug.place();
    const built = lastTower(await h.snapshot());
    await record(move);
    return built === undefined ? null : built.id;
  };

  const first = await buy("arc", ARC_SPOTS[0], "the first Arc bought");
  const second = await buy("arc", ARC_SPOTS[1], "the second Arc bought");
  const third = await buy("arc", ARC_SPOTS[2], "the third Arc bought");
  await buy("arc", ARC_SPOTS[3], "a fourth Arc the purse cannot cover");

  if (first !== null) await h.debug.upgradeTower(first);
  await record("an upgrade the purse cannot cover");

  if (third !== null) await h.debug.sellTower(third);
  await record("the third Arc sold");

  if (first !== null) await h.debug.upgradeTower(first);
  await record("an upgrade the sale paid for");

  if (first !== null) await h.debug.upgradeTower(first);
  await record("a second upgrade the purse cannot cover");

  if (first !== null) await h.debug.sellTower(first);
  await record("the upgraded Arc sold");

  await buy("bloom", LATE_SPOT, "a Bloom the purse cannot cover");

  if (second !== null) await h.debug.sellTower(second);
  await record("the last standing Arc sold");

  await buy("arc", LATE_SPOT, "one more Arc bought with the proceeds");

  await h.advance(1);
  await captureStill(h, "floor");

  for (const { move, money } of balances) {
    assertGreaterThanOrEqual(money, FLOOR, `the balance after ${move}`);
  }
  assertLessThan(
    Math.min(...balances.map((entry) => entry.money)),
    CHEAPEST,
    "precondition: the session spent down to the edge of affordability",
  );
});
