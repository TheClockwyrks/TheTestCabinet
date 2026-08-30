// panels/pause-closes-an-open-panel — pause shuts a panel instead of pausing.
//
// `specs/controls.md`: in the mine, `pause` opens the pause menu, or closes an
// open panel. `specs/ui.md` says the same from the panel's side — each panel
// closes back to the mine. So with a panel open the key must do the second thing
// and not the first: `panel` comes back `null` and the screen is still `in-mine`.
//
// The panel is posed open through the surface rather than opened by walking to a
// building and activating it, because a build with a broken activation and a
// correct pause has to pass this point and fail that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the open panel back to the mine", async () => {
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtCamp(h);
  await h.debug.setPanel("ore-market");
  const before = await h.snapshot();

  const after = await captureReplay(h, "close", async () => {
    await h.tap(ACTION_KEY.pause);
    await h.advance(2);
    return h.snapshot();
  });

  assertEqual(before.panel, "ore-market", "specs/ui.md");
  assertEqual(after.panel, null, "specs/controls.md");
  assertEqual(after.screen, "in-mine", "specs/controls.md");
});
