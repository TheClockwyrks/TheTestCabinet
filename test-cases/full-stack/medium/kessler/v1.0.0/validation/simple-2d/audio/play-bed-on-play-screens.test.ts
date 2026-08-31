// audio/play-bed-on-play-screens — the music-play bed loops on the playing,
// waveclear, and paused screens.
//
// specs/assets.md, the beds table: the play bed `assets/audio/music-play.wav`
// "loops on" `playing`, `waveclear`, and `paused`, run through the engine's
// looping cue play. What is read on each screen is whether that bed is
// sounding as a loop while the screen stands — the reading the harness keeps
// between the cue bus's looped and stopped announcements.
//
// Each screen is entered through the surface, which enters it exactly as the
// real transition does — a fresh session for `playing`, the pause overlay
// over it, the interstitial for the standing wave — so a build whose
// transitions are broken fails the screens category rather than this point.
// A couple of ticks follow each entry, because audio belongs to the ticks
// (specs/instrumentation.md) and the bed may start on the build's own next
// frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { BED_PLAY } from "../constants";
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

afterEach(() => {
  h?.dispose();
});

it("loops the play bed on playing, paused, and waveclear", async () => {
  h.debug.setScreen("playing");
  await advanceTicks(h, 2);
  captureStill(h, "playing");
  assertTrue(h.looping(BED_PLAY), "the play bed sounding as a loop on playing");

  h.debug.setScreen("paused");
  await advanceTicks(h, 2);
  captureStill(h, "paused");
  assertTrue(h.looping(BED_PLAY), "the play bed sounding as a loop on paused");

  h.debug.setScreen("waveclear");
  await advanceTicks(h, 2);
  captureStill(h, "waveclear");
  assertTrue(
    h.looping(BED_PLAY),
    "the play bed sounding as a loop on waveclear",
  );
});
