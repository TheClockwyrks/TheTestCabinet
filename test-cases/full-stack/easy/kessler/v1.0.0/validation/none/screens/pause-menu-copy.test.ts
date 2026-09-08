// screens/pause-menu-copy — the pause screen draws its menu.
//
// specs/screens.md, on `paused`: the pause menu's entries are `RESUME` and
// `QUIT`. The paused screen is reached through the surface —
// `setScreen('paused')` enters "exactly as `Escape` does during play"
// (specs/instrumentation.md) — because whether the keys pause is the pause
// items' point, and this one reads only what the paused frame draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import { PAUSE_MENU } from "../constants";
import {
  captureStill,
  openHarness,
  startFreshSession,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws RESUME and QUIT on the paused frame", async () => {
  await startFreshSession(h);
  await h.debug.setScreen("paused");

  const { calls } = await h.frameDraw();
  await captureStill(h, "pause");

  assertTrue(
    drewText(calls, PAUSE_MENU[0]),
    "the RESUME entry drawn on the paused frame",
  );
  assertTrue(
    drewText(calls, PAUSE_MENU[1]),
    "the QUIT entry drawn on the paused frame",
  );
});
