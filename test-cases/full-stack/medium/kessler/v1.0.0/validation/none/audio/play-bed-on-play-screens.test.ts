// audio/play-bed-on-play-screens — the music-play bed loops on the playing,
// waveclear, and paused screens.
//
// specs/assets.md, the beds table: the play bed `assets/audio/music-play.wav`
// "loops on" `playing`, `waveclear`, and `paused`, run "through looping
// sources". What is read on each screen is whether that bed is sounding as a
// loop while the screen stands — the probe's reading of what is looping NOW.
//
// Each screen is entered through the surface, which enters it exactly as the
// real transition does — a fresh session for `playing`, the pause overlay
// over it, the interstitial for the standing wave — so a build whose
// transitions are broken fails the screens category rather than this point.
// A couple of driven ticks and a settled frame follow each entry, because
// audio belongs to the ticks (specs/instrumentation.md) and the bed may start
// on the build's own next frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { MUSIC_PLAY } from "../constants";
import {
  advanceTicks,
  captureStill,
  openHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("loops the play bed on playing, paused, and waveclear", async () => {
  await h.armAudio();

  await h.debug.setScreen("playing");
  await advanceTicks(h, 2);
  await h.settleFrame();
  await captureStill(h, "playing");
  assertTrue(
    await h.looping(MUSIC_PLAY),
    "the play bed sounding as a loop on playing",
  );

  await h.debug.setScreen("paused");
  await advanceTicks(h, 2);
  await h.settleFrame();
  await captureStill(h, "paused");
  assertTrue(
    await h.looping(MUSIC_PLAY),
    "the play bed sounding as a loop on paused",
  );

  await h.debug.setScreen("waveclear");
  await advanceTicks(h, 2);
  await h.settleFrame();
  await captureStill(h, "waveclear");
  assertTrue(
    await h.looping(MUSIC_PLAY),
    "the play bed sounding as a loop on waveclear",
  );
});
