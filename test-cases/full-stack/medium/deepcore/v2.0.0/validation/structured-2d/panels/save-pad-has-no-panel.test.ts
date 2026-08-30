// panels/save-pad-has-no-panel — the Save Pad saves and opens nothing.
//
// `specs/ui.md`: the Save Pad has no panel and activating it saves directly.
// `specs/gameplay.md`: activating the pad writes the save on the spot. So the
// reading is both halves of the one sentence — the save exists afterwards, and
// `panel` never left `null`.
//
// The harness is given a save slot, because Node has none and the sentence under
// test is about what a save DOES; a host that refuses storage is `specs/modes.md`'s
// own requirement and its own point. The slot is cleared first, so `hasSave`
// turning true is this activation's doing rather than something the host arrived
// with. No Core Sample is live, because `specs/gameplay.md` refuses a save while
// one is, and that refusal is its own point elsewhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("saves at the pad without opening a panel", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  h.debug.clearSave();
  standAtBuilding(h, "save-pad");

  await h.tap(ACTION_KEY.activate);
  const after = h.snapshot();
  captureStill(h, "pad");

  assertEqual(after.hasSave, true, "specs/gameplay.md");
  assertEqual(after.panel, null, "specs/ui.md");
});
