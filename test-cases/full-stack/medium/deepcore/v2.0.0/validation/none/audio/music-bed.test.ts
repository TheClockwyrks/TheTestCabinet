// audio/music-bed — a bed plays under the game and keeps playing.
//
// `specs/assets.md`: the `music` cue plays "Looping under the whole game. A lonely,
// industrial descent bed." Two halves, and both are readable from outside:
//
//   1. IT PLAYS. With the game standing at the camp and nothing happening — no key
//      down, nothing cut, nothing hit, the tank full so no alarm — a sound has to
//      be coming out. Every other cue `specs/assets.md` names belongs to an event,
//      and none of them is happening, so what is sounding is the bed.
//   2. IT KEEPS PLAYING. A count of starts cannot separate a bed that loops from
//      one that played through and stopped, so what is counted instead is how many
//      sources are still RUNNING: started, less the ones that have announced they
//      ended. A build whose only sound was a blip at the unlock has nothing running
//      a few seconds later; a bed, however it is looped, does.
//
// The seconds pass in REAL time, through `runFor`, because audio runs on the
// browser's clock rather than the game's and a bed cannot be fast-forwarded. The
// game is handed back to its own loop for that stretch, which is also the truest
// picture of "under the whole game".

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

/** How long the game is left playing itself, in real milliseconds. */
const PLAYING_MS = 3000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a sound running under an idle game", async () => {
  await watchLiveSounds(h);
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtCamp(h);

  const heard = await captureReplay(h, "music", async () => {
    await h.runFor(PLAYING_MS);
    return { sounds: await liveSounds(h), snapshot: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.snapshot.muted, false, "specs/ui.md");
  assertGreaterThan(heard.sounds.started, 0, "specs/assets.md");
  assertGreaterThan(heard.sounds.live, 0, "specs/assets.md");
});
