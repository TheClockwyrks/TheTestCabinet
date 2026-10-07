// audio/music-bed — the bed plays under the game.
//
// `specs/assets.md`: the `music` cue plays "Looping under the whole game. A lonely,
// industrial descent bed." This is the first half, that it PLAYS: with the game
// standing at the camp and nothing happening — no key down, nothing cut, nothing
// hit, the tank full so no alarm — the `music` cue has to be sounding. It is read
// by name, so nothing else the camp does can stand in for it. That it keeps
// playing is `music-bed-loops`.
//
// The window is game time rather than real time. The engine announces a cue
// whether or not a device could sound it, so nothing here has to wait on a
// browser's audio clock.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
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

/** How long the game is left standing at the camp, in seconds and in frames. */
const WINDOW_SECONDS = 2;
const WINDOW_FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the music cue under an idle game", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "music", async () => ({
    audible: await audibleOver(
      h,
      log,
      CUES.music,
      WINDOW_SECONDS,
      WINDOW_FRAMES,
    ),
    snapshot: h.snapshot(),
  }));

  assertEqual(heard.snapshot.muted, false, "specs/ui.md");
  assertEqual(heard.audible, true, "specs/assets.md");
});
