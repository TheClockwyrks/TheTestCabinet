// controls/key-upgrade-press-blocker-selected — `KeyU` refines the press with a
// blocker selected.
//
// `specs/controls.md`: `upgrade` "raises the selected combination tower's level, or
// refines the press when the selection is not a combination tower". A blocker is
// not a combination tower — `specs/hud.md` gives it `DISMANTLE` alone — so the key
// refines the press rather than doing nothing, and a build that treats an
// inert selection as "no upgrade to make" fails here.

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

afterEach(() => {
  h.dispose();
});

it("refines the press with a blocker selected", async () => {
  openYard(h, { charge: BANK, refinement: 0 });
  const id = standBlocker(h, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);
  await refines(h, "a blocker selected");
  captureStill(h, "refined");
});
