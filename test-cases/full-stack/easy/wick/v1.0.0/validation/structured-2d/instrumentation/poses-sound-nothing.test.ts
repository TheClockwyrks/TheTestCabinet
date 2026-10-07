// Wick — instrumentation/poses-sound-nothing: `setScreen('playing')`,
// `setHp(1)`, `spawnEnemy`, `spawnPickup('chest', ...)`, and `choose` each
// play no cue at the call, and the frame after `setScreen('playing')` has
// music looping exactly as a run started from the menu would one frame later.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`: "A
// pose changes the state alone and sounds nothing; the cues a scenario hears
// come from the ticks and frames run after it. The two looping cues are
// reconciled from the state by the next frame, so a run posed through
// `setScreen("playing")` sounds exactly as one started from the menu one
// frame later." `specs/ui.md`, "The loops": music "starts on the frame a
// fresh run starts".
//
// THE DRIVE. Cue collectors opened after each arrangement and read at the
// call, so what they hold is what the call itself sounded. `choose` needs an
// open overlay, which the real tick opens (sounding `level-up`), so its
// collector opens after that tick. The loop: the `playing` screen posed
// through the surface and one frame, against a run confirmed with a real key
// and one frame, both read off the engine's bus. The loop rule is keyed on the
// SCREEN — "exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused`" (`specs/ui.md`) — so the two arrive at the same reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  onCue,
  openLevelUp,
  startPlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sounds nothing at any pose, and the loop reconciles a frame later", async () => {
  h.reset();
  const atPoses = onCue(h);
  h.debug.setScreen("playing");
  h.debug.setHp(1);
  h.debug.spawnEnemy("moth", 300, 0);
  h.debug.spawnPickup("chest", 300, 300);
  assertEqual(atPoses.length, 0, "cues played at the four poses");

  isolate(h);
  await openLevelUp(h, 1);
  const atChoose = onCue(h);
  h.debug.choose(0);
  assertEqual(atChoose.length, 0, "cues played at the choose call");

  h.reset();
  // The loop the run above left stops on the frame after the reset
  // (`reset`: "Any looping cue stops on the next tick"), so one frame first,
  // and the pose is read against a silent bus.
  await h.advance(1);
  assertEqual(
    h.looping(CUES.music),
    false,
    "music looping on the title before the pose",
  );
  h.debug.setScreen("playing");
  assertEqual(
    h.looping(CUES.music),
    false,
    "music looping at the setScreen('playing') call",
  );
  await h.frameDraw();
  captureStill(h, "silent");
  const posedLoop = h.looping(CUES.music);

  await startPlay(h);
  const playedLoop = h.looping(CUES.music);
  assertEqual(
    posedLoop,
    true,
    "music looping a frame after setScreen('playing')",
  );
  assertEqual(playedLoop, true, "music looping a frame after LIGHT THE LAMP");
  assertEqual(
    posedLoop,
    playedLoop,
    "the posed run's loop against the played run's",
  );
});
