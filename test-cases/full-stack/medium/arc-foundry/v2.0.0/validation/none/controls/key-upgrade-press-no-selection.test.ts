// controls/key-upgrade-press-no-selection — `KeyU` refines the press with nothing
// selected.
//
// `specs/controls.md`: `upgrade` "raises the selected combination tower's level, or
// refines the press when the selection is not a combination tower". With nothing
// selected there is no tower, so the key refines — and this is the case a build is
// most likely to leave out, because a build that only ever upgrades a tower does
// nothing at all on the key for most of a run.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { BANK, refines } from "./press-refine";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refines the press with nothing selected", async () => {
  await openYard(h, { charge: BANK, refinement: 0 });
  await h.debug.clearSelection();

  await refines(h, "nothing selected");
  await captureStill(h, "refined");
});
