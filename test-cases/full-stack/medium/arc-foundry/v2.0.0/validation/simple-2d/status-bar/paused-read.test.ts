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
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { BAR, drew } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads PAUSED only while the in-place pause is engaged", async () => {
  openYard(h);

  assertEqual(
    drew(await h.frameCalls(), BAR, "PAUSED"),
    false,
    "whether the bar reads PAUSED while the game is running",
  );

  h.debug.setPaused(true);
  const paused = await h.frameCalls();
  captureStill(h, "paused");
  assertEqual(
    drew(paused, BAR, "PAUSED"),
    true,
    "whether the bar reads PAUSED while the in-place pause is engaged",
  );
});
