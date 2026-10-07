// controls/key-upgrade-press-blocker-selected — `KeyU` refines the press with a
// blocker selected.
//
// `specs/controls.md`: `upgrade` "raises the selected combination tower's level, or
// refines the press when the selection is not a combination tower". A blocker is
// inert — `specs/hud.md` gives it `DISMANTLE` alone — so it is the selection least
// like a tower there is, and the key still has to reach the press.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
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

it("refines the press with a blocker selected", async () => {
  await openYard(h, { charge: BANK, refinement: 0 });
  const id = await standBlocker(h, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);

  await refines(h, "a blocker selected");
  await captureStill(h, "refined");
});
