// status-bar/paused-read — PAUSED shows while the in-place pause is engaged.
//
// `specs/hud.md`: "a clear `PAUSED` read shows while the game is paused in
// place", and `specs/ui.md` fixes the in-place pause as freezing the simulation
// on the `playing` screen with no menu over it. `setPaused` engages that pause
// directly, so the read is decided without pressing a key or opening a menu.
//
// Both directions are read, because a bar that draws PAUSED at all times would
// satisfy the requirement's first half and none of its point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BAR,
  captureStill,
  createHarness,
  drew,
  type Harness,
  openYard,
} from "../harness";
import { PAUSED_TEXT } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads PAUSED only while the in-place pause is engaged", async () => {
  await openYard(h);

  assertEqual(
    drew(await h.frameCalls(), BAR, PAUSED_TEXT),
    false,
    "whether the bar reads PAUSED while the game is running",
  );

  await h.debug.setPaused(true);
  const paused = await h.frameCalls();
  await captureStill(h, "paused");
  assertEqual(
    drew(paused, BAR, PAUSED_TEXT),
    true,
    "whether the bar reads PAUSED while the in-place pause is engaged",
  );
});
