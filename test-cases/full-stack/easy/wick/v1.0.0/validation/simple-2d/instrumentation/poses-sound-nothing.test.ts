// instrumentation/poses-sound-nothing — `setScreen('playing')`, `setHp(1)`,
// `spawnEnemy`, `spawnPickup('chest', ...)`, and `choose` each play no cue at
// the call, and the frame after `setScreen('playing')` has music looping
// exactly as a run started from the menu would one frame later.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md: "A pose changes the
// state alone and sounds nothing; the cues a scenario hears come from the
// ticks and frames run after it. The two looping cues are reconciled from the
// state by the next frame, so a run posed through `setScreen("playing")`
// sounds exactly as one started from the menu one frame later"; `setScreen`:
// "No cue sounds at the call"; `choose`: "Sounds nothing". specs/ui.md, "The
// loops": `music` "starts on the frame a fresh run starts".
//
// THE READ. The engine's cue bus announces every play and every loop start,
// and the harness records them; the list is watched across each pose with no
// frame between, so anything recorded is the pose's. Then the loops looping
// one frame after the posed run are compared with the loops looping one frame
// after a run started by a real `confirm` on LIGHT THE LAMP.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
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
  h?.dispose();
});

it("plays no cue at any pose, and the loops reconcile on the next frame", async () => {
  h.reset();
  await h.tick(1);
  const cues = onCue(h);

  h.debug.setScreen("playing");
  assertLength(cues, 0, "cues at setScreen('playing')");
  h.debug.setHp(1);
  assertLength(cues, 0, "cues at setHp(1)");
  h.debug.spawnEnemy("moth", 300, 0);
  assertLength(cues, 0, "cues at spawnEnemy");
  h.debug.spawnPickup("chest", 300, 300);
  assertLength(cues, 0, "cues at spawnPickup('chest', ...)");

  isolate(h);
  await openLevelUp(h, 1);
  const atChoose = onCue(h);
  h.debug.choose(0);
  assertLength(atChoose, 0, "cues at choose");

  h.reset();
  h.debug.setScreen("playing");
  await h.tick(1);
  captureStill(h, "silent");
  const posedLoops = h.loopingCues();
  assertEqual(
    posedLoops.includes("music"),
    true,
    "music looping a frame after the posed run",
  );

  await startPlay(h);
  assertDeepEqual(
    h.loopingCues(),
    posedLoops,
    "the loops after a run started from the menu",
  );
});
