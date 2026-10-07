// waves/wave-number-increments — the wave the banner announces is one more than the
// wave just cleared.
//
// `specs/progression.md`, The banner: "On the tick a wave clears, the wave number
// advances by one and a `WAVE N` banner appears, naming the wave about to start."
//
// THE NUMBER ALONE. `clears-on-last-rock` grades that the banner goes up at all,
// and `banner-runs-for-1p5s` grades how long it stays; this grades what it says. A
// build that turns waves over faultlessly but numbers them wrongly loses one point
// here rather than three across the group.
//
// POSED AT SIX, SO EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. Clearing wave 6
// must give wave 7. A build that never advances the number reads 6; one that
// restarts the count reads 1; one that advances by two reads 8; one that sets the
// number from the rocks it is about to spawn reads 10. None of those is 7, and none
// of them is any of the others, so the failure names which wrong model the build
// implemented rather than merely saying "not seven". Posing at wave 1 would have
// collapsed three of those four onto the same reading.
//
// READ WHILE THE BANNER IS SHOWING, not at some later moment, because the
// specification ties the advance to the tick the banner appears: the number and the
// banner are one event. The one tick of latitude `specs/simulation.md`'s tick order
// leaves for that event is taken through `bannerUp`, and nothing more.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bannerUp, clearAWave } from "./scenario";

/**
 * The wave the run is posed at, and the wave clearing it must announce.
 *
 * Six, chosen so that "one more", "unchanged", "restarted", "two more" and "the
 * count of the rocks about to arrive" are five different numbers.
 */
const POSED_WAVE = 6;
const ANNOUNCED_WAVE = POSED_WAVE + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("announces wave 7 when wave 6 is cleared", async () => {
  const cleared = await clearAWave(h, { wave: POSED_WAVE });

  assertEqual(
    cleared.before.wave,
    POSED_WAVE,
    "the wave the game reported with the last rock still standing, which " +
      "specs/instrumentation.md has setWave pose and nothing but a clear change",
  );

  const raised = await bannerUp(h, cleared);
  captureStill(h, "banner");

  assertEqual(
    raised.wave,
    ANNOUNCED_WAVE,
    `the wave the game reports while the banner raised by clearing wave ` +
      `${POSED_WAVE} is showing, which specs/progression.md advances by one on ` +
      `the tick the wave clears (waveBanner was ${raised.waveBanner})`,
  );
});
