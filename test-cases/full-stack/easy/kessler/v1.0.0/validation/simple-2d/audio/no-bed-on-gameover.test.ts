// audio/no-bed-on-gameover — the gameover screen runs no bed.
//
// specs/assets.md: "The game-over screen plays no bed, so the `game-over` cue
// rings out over silence."
//
// The screen is entered from `playing` — the screen a real session ends on —
// through the surface, which enters it exactly as losing the last life does,
// and both beds are read as not sounding once it stands. The one-shot
// game-over cue ringing on the real entry is its own item; what this point
// hears is the silence under it. A couple of ticks follow the entry, so a
// bed a build wrongly leaves running has every chance to be caught sounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BED_PLAY, BED_TITLE } from "../constants";
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

it("runs neither bed on the gameover screen", async () => {
  h.debug.setScreen("playing");
  await advanceTicks(h, 2);

  h.debug.setScreen("gameover");
  await advanceTicks(h, 2);
  captureStill(h, "gameover");

  assertEqual(h.looping(BED_PLAY), false, "the play bed sounding on gameover");
  assertEqual(
    h.looping(BED_TITLE),
    false,
    "the title bed sounding on gameover",
  );
});
