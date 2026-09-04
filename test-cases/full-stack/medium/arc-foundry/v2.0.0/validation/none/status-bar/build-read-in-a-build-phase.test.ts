// status-bar/build-read-in-a-build-phase — the bar reads BUILD during a build phase.
//
// `specs/hud.md` fixes the bar's wave element as "`WAVE n / N`, with the current
// wave's progress during a wave and a `BUILD` read during a build phase". That is
// two reads on two phases, and a build can carry one and not the other: a bar that
// draws WAVE n / N correctly and never shows BUILD leaves the player unable to
// tell a build phase from a wave. So `build-read-in-a-build-phase` decides the
// first and `wave-read-during-a-wave` decides the second.

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
import { BUILD_TEXT } from "../constants";

const WAVE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads BUILD during a build phase", async () => {
  await openYard(h, { wave: WAVE });

  const building = await h.frameCalls();
  await captureStill(h, "bar");
  assertEqual(
    drew(building, BAR, BUILD_TEXT),
    true,
    "whether the bar reads BUILD during a build phase (specs/hud.md)",
  );
});
