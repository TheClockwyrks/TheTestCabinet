// controls/key-upgrade-press-component-selected — `KeyU` refines the press with a
// base component selected.
//
// `specs/controls.md`: `upgrade` "raises the selected combination tower's level, or
// refines the press when the selection is not a combination tower". A base
// component is not a combination tower, so the key refines the press rather than
// doing nothing — and a build that read "the selection has an upgrade" rather than
// "the selection is a tower" fails here while passing with nothing selected.

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

afterEach(() => {
  h.dispose();
});

it("refines the press with a base component selected", async () => {
  openYard(h, { charge: BANK, refinement: 0 });
  const id = standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);
  await refines(h, "a base component selected");
  captureStill(h, "refined");
});
