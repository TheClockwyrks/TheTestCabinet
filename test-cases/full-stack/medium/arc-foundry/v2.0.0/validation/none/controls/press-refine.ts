// Arc Foundry — refining the press from the keyboard. CASE-PROVIDED, LOCAL TO THIS
// CATEGORY.
//
// `specs/controls.md` binds `upgrade` to `KeyU` and gives it two jobs: "Raises the
// selected combination tower's level, or refines the press when the selection is
// not a combination tower." The three suites beside this file decide the second,
// each for one of the three things "not a combination tower" is on this yard —
// nothing selected at all, a base component selected, and a blocker selected — and
// each reads the same two figures back.
//
// `specs/scrap-press.md` fixes what refining costs (`REFINEMENT_COSTS`, `20` to
// reach `R1`) and that it is available in every phase.

import { assertEqual } from "../assert";
import { keyFor, refinementCost } from "../constants";
import { pressAction, type Harness } from "../harness";

/** Charge banked before the press: far past the `20` the first rung costs. */
export const BANK = 5_000;

/** Where a selected structure stands, clear of the chain. */
export const ANCHOR = { col: 10, row: 0 };

/**
 * Press the key as a player presses it and read the refinement and the bank back.
 *
 * The key goes in through the surface's own input operations, which
 * `specs/instrumentation.md` says "feed the same input path the runtime layer
 * feeds, so a posed press and a player's press are the same event to the game".
 */
export async function refines(h: Harness, what: string): Promise<void> {
  await pressAction(h, "upgrade");

  const after = await h.snapshot();
  assertEqual(
    after.refinement,
    1,
    `pressing ${keyFor("upgrade")} with ${what} to refine the press one level ` +
      "(specs/controls.md)",
  );
  assertEqual(
    after.charge,
    BANK - refinementCost(1),
    `the Charge left after refining to R1, which costs ${refinementCost(1)} ` +
      "(specs/scrap-press.md)",
  );
}
