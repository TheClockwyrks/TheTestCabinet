// controls/key-upgrade-press-component-selected — `KeyU` refines the press with a
// base component selected.
//
// `specs/controls.md`: `upgrade` "raises the selected combination tower's level, or
// refines the press when the selection is not a combination tower". A base
// component is a structure the inspector offers `UPGRADE` on nothing for, so the
// key falls through to the press — and a build that reads "there is a selection"
// rather than "the selection is a tower" does nothing here while passing the
// no-selection case.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { ANCHOR, BANK, refines } from "./press-refine";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refines the press with a base component selected", async () => {
  await openYard(h, { charge: BANK, refinement: 0 });
  const id = await standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);

  await refines(h, "a base component selected");
  await captureStill(h, "refined");
});
