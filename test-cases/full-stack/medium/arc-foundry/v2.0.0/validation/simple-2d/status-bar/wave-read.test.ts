// status-bar/wave-read — WAVE n / N during a wave, BUILD during a build phase.
//
// `specs/hud.md` fixes the bar's wave element as "`WAVE n / N`, with the current
// wave's progress during a wave and a `BUILD` read during a build phase". So the
// build phase has to carry the word BUILD, and the live wave has to carry the
// wave number and the run's total and no longer carry BUILD.
//
// The wave is reached through the surface's own driver rather than by committing
// a harvest: `spawnUnit` "puts the run into a live wave"
// (`specs/instrumentation.md`), which is the direct route to the phase this point
// is about and leaves the harvest, the press, and the panel out of it. The unit
// released is held, so the wave cannot clear while the bar is being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWaveOpen,
  openYard,
  type Harness,
} from "../harness";
import { BAR, drew, figures } from "./reading";

const WAVE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads BUILD in a build phase and the wave number during a wave", async () => {
  openYard(h, { wave: WAVE });

  const building = await h.frameCalls();
  assertEqual(
    drew(building, BAR, "BUILD"),
    true,
    "whether the bar reads BUILD during a build phase",
  );

  holdWaveOpen(h);
  const live = h.snapshot();
  assertEqual(
    live.phase,
    "wave",
    "the phase a released unit puts the run into (specs/instrumentation.md)",
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
    drew(running, BAR, "BUILD"),
    false,
    "whether the bar still reads BUILD during a live wave",
  );
});
