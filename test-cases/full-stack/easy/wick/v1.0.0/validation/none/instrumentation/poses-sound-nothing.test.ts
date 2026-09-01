// Wick — instrumentation/poses-sound-nothing: `setScreen("playing")`,
// `setHp(1)`, `spawnEnemy`, `spawnPickup("chest", ...)`, and `choose` each
// play no cue at the call, and the frame after `setScreen("playing")` has
// `music` looping exactly as a run started from the menu would one frame
// later.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md): "A pose changes
// the state alone and sounds nothing; the cues a scenario hears come from the
// ticks and frames run after it. The two looping cues are reconciled from the
// state by the next frame, so a run posed through `setScreen("playing")`
// sounds exactly as one started from the menu one frame later."
// specs/ui.md: "`music` is looping on every frame exactly when `screen` is
// `playing` ...". `setScreen`: "No cue sounds at the call."; `choose`:
// "Sounds nothing."
//
// WHY THE WORLD IS POSED AS IT IS. The probe logs every sound the build emits,
// so each pose is bracketed by a read of its log taken inside the page, in the
// same evaluation as the call: the same document leaves the build's own loop
// running in real time while the clock is held, and a frame of that loop
// reconciles the loops, so a read taken across two crossings would hear the
// frame after the pose as well as the pose. The level-up overlay is reached by
// `setScreen("levelup")` (itself a pose) so `choose` can be made, and the two
// routes into play are compared on the loop they leave running.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  bracket,
  captureStill,
  createHarness,
  isLooping,
  startRunFromTitle,
  type Harness,
  type WickDebugApi,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await h.armAudio();
});

afterEach(async () => {
  await h.dispose();
});

/** Make the call, and read the sounds emitted at it and nowhere else. */
async function requireSilent(
  name: string,
  op: keyof WickDebugApi,
  ...args: readonly unknown[]
): Promise<void> {
  const { sounds } = await bracket(h, op, args);
  assertLength(sounds, 0, `sounds played at ${name}`);
}

it("plays no cue at a pose, and reconciles the loops on the next frame", async () => {
  await h.debug.reset();
  await requireSilent("setScreen('playing')", "setScreen", "playing");
  await requireSilent("setHp(1)", "setHp", 1);
  await requireSilent(
    "spawnEnemy('moth', 300, 0)",
    "spawnEnemy",
    "moth",
    300,
    0,
  );
  await requireSilent(
    "spawnPickup('chest', 0, 0)",
    "spawnPickup",
    "chest",
    0,
    0,
  );
  await h.debug.setPendingLevelUps(1);
  await requireSilent("setScreen('levelup')", "setScreen", "levelup");
  assertEqual(
    (await h.snapshot()).screen,
    "levelup",
    "the overlay choose is made on",
  );
  await requireSilent("choose(0)", "choose", 0);

  // The posed route: music is looping one frame after `setScreen("playing")`.
  await h.debug.reset();
  await h.step(1);
  assertEqual(await isLooping(h, "music"), false, "music on the title");
  await h.debug.setScreen("playing");
  await h.step(1);
  await captureStill(h, "silent");
  assertEqual(
    await isLooping(h, "music"),
    true,
    "music one frame after setScreen('playing')",
  );

  // The played route: the same one frame later.
  await startRunFromTitle(h);
  assertEqual(
    await isLooping(h, "music"),
    true,
    "music one frame after LIGHT THE LAMP",
  );
});
