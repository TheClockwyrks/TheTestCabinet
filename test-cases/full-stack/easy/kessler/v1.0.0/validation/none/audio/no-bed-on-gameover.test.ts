// audio/no-bed-on-gameover — the gameover screen runs no bed.
//
// specs/assets.md: "The game-over screen plays no bed, so the `game-over` cue
// rings out over silence."
//
// The screen is entered from `playing` — the screen a real session ends on —
// through the surface, which enters it exactly as losing the last life does,
// and both beds are read as not sounding once it stands. The one-shot
// game-over cue ringing on the real entry is its own item; what this point
// hears is the silence under it. A couple of driven ticks and a settled frame
// follow the entry, so a bed a build wrongly leaves running has every chance
// to be caught sounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MUSIC_PLAY, MUSIC_TITLE } from "../constants";
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

it("runs neither bed on the gameover screen", async () => {
  await h.armAudio();
  await h.debug.setScreen("playing");
  await advanceTicks(h, 2);

  await h.debug.setScreen("gameover");
  await advanceTicks(h, 2);
  await h.settleFrame();
  await captureStill(h, "gameover");

  assertEqual(
    await h.looping(MUSIC_PLAY),
    false,
    "the play bed sounding on gameover",
  );
  assertEqual(
    await h.looping(MUSIC_TITLE),
    false,
    "the title bed sounding on gameover",
  );
});
