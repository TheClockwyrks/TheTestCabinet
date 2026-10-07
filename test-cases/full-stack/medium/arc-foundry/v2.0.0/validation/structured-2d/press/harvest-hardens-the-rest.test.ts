// press/harvest-hardens-the-rest — committing the harvest turns every other
// candidate into a blocker, for the rest of the run.
//
// IT IS WHY A LEVEL YIELDS ONE STRUCTURE. `specs/scrap-press.md` resolves a
// harvest in three steps — the harvest becomes a component, every remaining
// candidate hardens, the wave begins — and the middle step is what stops the
// player banking five rolls a level and harvesting them at leisure. The rocks
// that were not taken are still walls, which is the whole reason to place them.
//
// A HARDENED CANDIDATE IS A BLOCKER IN FULL, not a candidate that stopped
// offering KEEP: `specs/scrap-press.md` gives a blocker no type, no quality, no
// range and no head, and `specs/instrumentation.md` has it report exactly that.
// So every field is read, and a harvest is then attempted on one of them to show
// the hardening is for the rest of the run rather than for the frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  structureById,
  type Harness,
} from "../harness";

/** A whole allowance of candidates: one is kept and four have to harden. */
const ANCHORS = [10, 14, 18, 22, 26].map((col) => ({ col, row: 10 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Take an action the game is entitled to refuse.
 *
 * `specs/instrumentation.md` leaves an operation two conformant answers when its
 * subject is not in the condition it states: refuse and do nothing, or fail
 * loudly. What the point decides is the yard either answer leaves behind, so both
 * are allowed to happen here and neither is asserted: the yard is read back after
 * the call, and the reading is what decides.
 */
function attempt(act: () => void): void {
  try {
    act();
  } catch {
    // The loud refusal, which is the other conformant answer.
  }
}

it("hardens every candidate the harvest did not take", async () => {
  openYard(h);

  const candidates = ANCHORS.map((anchor) =>
    standCandidate(h, "capacitor", 2, anchor.col, anchor.row),
  );

  const kept = candidates[0]!;
  const rest = candidates.slice(1);
  h.debug.select(kept);
  h.debug.keep(kept);

  const harvested = h.snapshot();
  await h.advance(1);
  captureStill(h, "settled");

  assertEqual(
    structureById(harvested, kept).kind,
    "component",
    "what the harvested candidate became",
  );

  for (const id of rest) {
    const hardened = structureById(harvested, id);
    const where = `the candidate #${id} the harvest did not take`;
    assertEqual(hardened.kind, "blocker", `${where}: what it became`);
    assertNull(hardened.type, `${where}: its type`);
    assertNull(hardened.quality, `${where}: its quality`);
    assertNull(hardened.targeting, `${where}: its targeting priority`);
    assertEqual(hardened.damage, 0, `${where}: its damage`);
    assertEqual(hardened.range, 0, `${where}: its range`);
  }

  // And the hardening lasts: a harvest attempted on one of them takes nothing.
  const target = rest[0]!;
  attempt(() => h.debug.select(target));
  attempt(() => h.debug.keep(target));
  assertEqual(
    structureById(h.snapshot(), target).kind,
    "blocker",
    `the blocker #${target} after a harvest was attempted on it: a hardened ` +
      `candidate stays a blocker for the rest of the run`,
  );
});
