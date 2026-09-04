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
import { type Harness, pressAction } from "../harness";
import { keyFor, refinementCost } from "../constants";

/** Charge banked before the press: far past the `20` the first rung costs. */
export const BANK = 5_000;

/** Where a selected structure stands, clear of the chain. */
export const ANCHOR = { col: 10, row: 0 };

/**
 * Press the key as a player presses it and read the refinement and the bank back.
 *
 * Under this engine the surface carries no key operation, so this is a REAL key
 * event dispatched at the engine's own surface (`specs/instrumentation.md`).
 */
export async function refines(h: Harness, what: string): Promise<void> {
  await pressAction(h, "upgrade");

  const after = h.snapshot();
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
