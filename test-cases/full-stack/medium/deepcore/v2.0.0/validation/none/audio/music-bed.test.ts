// audio/music-bed — a bed plays under the game.
//
// `specs/assets.md`: the `music` cue plays "Looping under the whole game. A lonely,
// industrial descent bed." What is readable from outside an engineless build is
// that it PLAYS: with the game standing at the camp and nothing happening — no key
// down, nothing cut, nothing hit, the tank full so no alarm — a sound has to be
// coming out. Every other cue `specs/assets.md` names belongs to an event, and
// none of them is happening, so what is sounding is the bed.
//
// WHAT IS COUNTED. Not just how many sounds started but how many are still
// RUNNING: started, less the ones that have announced they ended. A build whose
// only sound was a blip at the unlock has nothing running once the scene is
// posed; a bed does. Whether the bed then keeps playing across the whole game is
// a question only real time can answer, since audio runs on the browser's clock
// rather than the game's, so under this engine it is the reviewer's ear that
// decides it and `music-bed-loops` is scoped to the engines whose bus announces a
// cue's start and end on the game's own frames.
//
// The scene runs on the game's clock, over driven frames, so nothing here waits on
// a duration.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";
import { armAudio, liveSounds, watchLiveSounds } from "./probe";

/** How long the game is left standing at the camp, in seconds and in frames. */
const WINDOW_SECONDS = 2;
const WINDOW_FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has a sound running under an idle game", async () => {
  await watchLiveSounds(h);
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtCamp(h);

  const heard = await captureReplay(h, "music", async () => {
    await h.advanceSeconds(WINDOW_SECONDS, WINDOW_FRAMES);
    return { sounds: await liveSounds(h), snapshot: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.snapshot.muted, false, "specs/ui.md");
  assertGreaterThan(heard.sounds.started, 0, "specs/assets.md");
  assertGreaterThan(heard.sounds.live, 0, "specs/assets.md");
});
