// screens/opens-on-title — the game opens on the title screen.
//
// specs/screens.md: "The snapshot's `screen` field, fixed in
// specs/instrumentation.md, names the screen the game is in, and the game
// opens on `title`." And under Menus: "Entering a menu-bearing screen
// highlights entry `0`" — so a freshly loaded game stands on `title` with
// `menu.index` at `0`.
//
// Nothing is posed and no key is pressed: what is read is the state the build
// stands in when the harness opens on it, which specs/instrumentation.md fixes
// as "indistinguishable from a freshly started session".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("boots on title with the top menu entry highlighted", async () => {
  const boot = await h.snapshot();

  await h.settleFrame();
  await captureStill(h, "title-boot");

  assertEqual(boot.screen, "title", "the screen a freshly loaded game is on");
  assertEqual(boot.menu.index, 0, "the highlighted entry at boot");
});
