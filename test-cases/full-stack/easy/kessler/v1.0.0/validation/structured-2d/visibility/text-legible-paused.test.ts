// visibility/text-legible-paused — every run of text the pause screen adds
// contrasts with what sits behind it.
//
// `specs/screens.md`: "Every piece of text a screen shows is legible against
// whatever sits behind it at the logical stage size of `1000 x 1000`", and the
// `paused` screen shows "the pause menu, over the field drawn exactly as the
// tick that paused it left it". Each of the six screens is its own point. How a
// run is found, how its contrast is read, and why an overlay screen is read on
// the runs it ADDS is `legible.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { isolate, openHarness, type Harness } from "../harness";
import { assertOverlayTextLegible } from "./legible";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the pause menu's text legibly", async () => {
  isolate(h);
  await assertOverlayTextLegible(h, "paused", "paused", () =>
    h.debug.setScreen("paused"),
  );
});
