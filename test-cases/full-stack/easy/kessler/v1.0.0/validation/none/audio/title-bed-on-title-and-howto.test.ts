// audio/title-bed-on-title-and-howto — the music-title bed loops on the title
// and howto screens.
//
// specs/assets.md, the beds table: the title bed `assets/audio/music-title.wav`
// "loops on" `title` and `howto`, run "through looping sources". What is read
// here is whether that bed is sounding as a loop while each of the two screens
// stands — the probe's reading of what is looping NOW, not a record of what
// was once asked for.
//
// The game boots on `title`; `howto` is entered through the surface, which
// enters a screen exactly as the real transition does, so a build whose menu
// cannot open the screen fails the screens category rather than this point.
// A couple of driven ticks and a settled frame follow each entry, because
// audio belongs to the ticks (specs/instrumentation.md) and the bed may start
// on the build's own next frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { MUSIC_TITLE } from "../constants";
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

it("loops the title bed on title and on howto", async () => {
  await h.armAudio();
  await advanceTicks(h, 2);
  await h.settleFrame();
  await captureStill(h, "title");
  assertTrue(
    await h.looping(MUSIC_TITLE),
    "the title bed sounding as a loop on title",
  );

  await h.debug.setScreen("howto");
  await advanceTicks(h, 2);
  await h.settleFrame();
  await captureStill(h, "howto");
  assertTrue(
    await h.looping(MUSIC_TITLE),
    "the title bed sounding as a loop on howto",
  );
});
