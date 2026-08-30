// controls/key-upgrade-press — `KeyU` refines the press when the selection is not
// a combination tower.
//
// THE REQUIREMENT. `specs/controls.md` binds `upgrade` to `KeyU` and gives it two
// jobs: "Raises the selected combination tower's level, or refines the press when
// the selection is not a combination tower." This point decides the second, and it
// is a point precisely because the fallback is easy to leave out: a build that
// only ever upgrades a tower does nothing at all on the key for most of a run.
// `specs/scrap-press.md` fixes what refining costs — `REFINEMENT_COSTS`, `20` to
// reach `R1` — and that it is available in every phase.
//
// HOW IT IS DECIDED. Three selections that are not a combination tower are tried
// in turn, because "not a combination tower" is three different things on this
// yard: nothing selected at all, a base component selected, and a blocker
// selected. In each the key is pressed as a player presses it, a real browser key
// event through the build's own keyboard layer, and the refinement level and the
// bank are read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { keyFor, refinementCost } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  standComponent,
  type Harness,
} from "../harness";

/** Where the selected structure stands, clear of the chain. */
const ANCHOR = { col: 10, row: 0 };

/** Charge banked before the press: far past the `20` the first rung costs. */
const BANK = 5_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Refine once from `R0` with whatever this scenario left selected, and read it. */
async function refines(h: Harness, what: string): Promise<void> {
  await h.tap(keyFor("upgrade"));

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

it("refines the press with nothing selected", async () => {
  await openYard(h, { charge: BANK, refinement: 0 });
  await h.debug.clearSelection();
  await refines(h, "nothing selected");
  await captureStill(h, "refined");
});

it("refines the press with a base component selected", async () => {
  await openYard(h, { charge: BANK, refinement: 0 });
  const id = await standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);
  await refines(h, "a base component selected");
});

it("refines the press with a blocker selected", async () => {
  await openYard(h, { charge: BANK, refinement: 0 });
  const id = await standBlocker(h, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);
  await refines(h, "a blocker selected");
});
