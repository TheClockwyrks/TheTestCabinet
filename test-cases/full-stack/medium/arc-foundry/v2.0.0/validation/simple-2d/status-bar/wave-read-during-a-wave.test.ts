// status-bar/wave-read-during-a-wave — the bar reads WAVE n / N during a live wave.
//
// `specs/hud.md` fixes the bar's wave element as "`WAVE n / N`, with the current
// wave's progress during a wave and a `BUILD` read during a build phase". That is
// two reads on two phases, and a build can carry one and not the other: a bar that
// draws WAVE n / N correctly and never shows BUILD leaves the player unable to
// tell a build phase from a wave. So `build-read-in-a-build-phase` decides the
// first and `wave-read-during-a-wave` decides the second.
//
// THE WAVE IS REACHED THROUGH THE SURFACE'S OWN DRIVER rather than by committing a
// harvest, which is the direct route to the phase this point is about and leaves
// the harvest, the press, and the panel out of it. The wave's clear-and-pay
// resolution is held, so it cannot end while the bar is being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  BAR,
  captureStill,
  createHarness,
  drew,
  figures,
  type Harness,
  openHeldWave,
  openYard,
} from "../harness";
import { BUILD_TEXT } from "../constants";

const WAVE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the wave number and the run's total during a live wave", async () => {
  openYard(h, { wave: WAVE });
  openHeldWave(h);
  const live = h.snapshot();
  assertEqual(
    live.phase,
    "wave",
    "the phase the run was posed into (specs/instrumentation.md)",
  );

  const running = await h.frameCalls();
  captureStill(h, "bar");
  const drawn = figures(running, BAR);
  assertContains(drawn, live.wave, "the status bar's figures during a wave");
  assertContains(
    drawn,
    live.totalWaves,
    "the status bar's figures during a wave",
  );
  assertEqual(
    drew(running, BAR, BUILD_TEXT),
    false,
    "whether the bar still reads BUILD during a live wave (specs/hud.md)",
  );
});
