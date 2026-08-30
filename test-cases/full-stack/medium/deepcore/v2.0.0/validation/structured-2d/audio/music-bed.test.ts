// audio/music-bed — the bed plays under the game and keeps playing.
//
// `specs/assets.md`: the `music` cue plays "Looping under the whole game. A lonely,
// industrial descent bed." Two halves, and the engine's bus makes both readable:
//
//   1. IT PLAYS. With the game standing at the camp and nothing happening — no key
//      down, nothing cut, nothing hit, the tank full so no alarm — the `music` cue
//      has to be sounding. It is read by name, so nothing else the camp does can
//      stand in for it.
//   2. IT KEEPS PLAYING. A single start cannot be told from a bed that played
//      through and stopped, so what is read is whether the name was audible over
//      EVERY part of a long stretch of play: the span is cut into equal windows and
//      each is asked separately. A loop started once and never stopped is audible
//      in all of them (`engine/audio.md` has `cue:looped` on the start and
//      `cue:stopped` on the end, so a loop still running spans every window it
//      opened before); a cue re-triggered as it runs out lands a play in each; a
//      build whose only sound was a blip at the start is audible in the first and
//      silent in the rest.
//
// The span is game time rather than real time. The engine announces a cue whether
// or not a device could sound it, so nothing here has to wait on a browser's audio
// clock, and the game is driven over the same stretch of play a listener would
// have sat through.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";
import { audibleOver, watchAudio } from "./cues";

/** How long the game is left playing, in seconds, cut into equal windows. */
const WINDOWS = 5;
const WINDOW_SECONDS = 2;
const WINDOW_FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the music cue sounding across an idle game", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "music", async () => {
    const silent: number[] = [];
    for (let window = 0; window < WINDOWS; window += 1) {
      const audible = await audibleOver(
        h,
        log,
        CUES.music,
        WINDOW_SECONDS,
        WINDOW_FRAMES,
      );
      if (!audible) silent.push(window);
    }
    return { silent, snapshot: h.snapshot() };
  });

  assertEqual(heard.snapshot.muted, false, "specs/ui.md");
  assertEqual(heard.silent.join(", "), "", "specs/assets.md");
});
