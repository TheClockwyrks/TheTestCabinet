// Wick — instrumentation/reset-stops-loops: with `music` and `hum` both
// looping, `reset()` followed by one frame leaves neither looping.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `reset(options)`: "Any looping cue stops on the next tick of the game mode,
// since the state it restores holds no run." `specs/ui.md`, "The loops":
// "`music` is looping on every frame exactly when `screen` is `playing`,
// `levelup`, `chest`, or `paused`" and "`hum` is looping on every frame
// exactly when `screen` is `playing` and a held weapon is `halo` or `corona`";
// "Both loops are reconciled from the state on every frame".
//
// THE POSE. A fresh run with Halo held, one frame so both loops are running
// (read off the engine's bus, `world.audio.looping`), then `reset` and one
// frame: the state holds no run, so the reconciliation stops both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  freshRun,
  holdWeapon,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stops music and hum by the frame after reset", async () => {
  freshRun(h);
  holdWeapon(h, "halo");
  await h.advance(1);
  assertEqual(h.looping(CUES.music), true, "music looping before reset");
  assertEqual(h.looping(CUES.hum), true, "hum looping before reset");

  h.reset();
  await h.frameDraw();
  captureStill(h, "silenced");

  assertEqual(
    h.looping(CUES.music),
    false,
    "music looping a frame after reset",
  );
  assertEqual(h.looping(CUES.hum), false, "hum looping a frame after reset");
});
