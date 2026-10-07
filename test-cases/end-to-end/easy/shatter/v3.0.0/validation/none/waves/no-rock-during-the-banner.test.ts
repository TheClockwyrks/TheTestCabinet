// waves/no-rock-during-the-banner — the field stays empty for as long as the banner
// runs.
//
// `specs/progression.md`, The banner: "The banner runs for `WAVE_BANNER_TIME`
// (`1.5` seconds), and the rocks it announces are spawned as it ends. No rock is on
// the field at any point while the banner is showing."
//
// THE BANNER IS A BREATHER, AND THIS IS THE HALF OF IT THE PLAYER FEELS. The ship
// keeps flying and a saucer keeps hunting — `the-ship-flies-during-the-banner` and
// `the-saucer-hunts-during-the-banner` grade those — but the rocks are held back,
// and a build that spawns its wave the instant it clears hands the player a denser
// field with no pause at all. That is the mistake this item names.
//
// SAMPLED EVERY TICK, because the requirement is "at any point". A stride of even a
// few ticks would let a build spawn a wave, have it drift, and be read only after
// the banner had ended, and the check would report a field that was empty every
// time it looked. Every tick of the banner is looked at, and the first tick that
// holds a rock ends the sweep.
//
// AND IT IS THE ONLY THING READ. The sweep stops on a rock or on the banner
// reaching zero, whichever comes first, and the verdict is which of the two it was.
// A build that never spawns the wave at all passes here and loses
// `spawns-as-the-banner-ends`; a build whose banner is the wrong length passes here
// and loses `banner-runs-for-1p5s`. This item decides one thing: that no rock
// arrived early.
//
// THE TICK THE BANNER ENDS IS THE WAVE'S OWN. The specification spawns the rocks
// "as it ends", so a roster that fills on the tick `waveBanner` reaches zero is the
// wave arriving exactly on time — which is why the sweep's stop condition puts the
// two on the same tick and reads the banner to tell them apart.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { WAVE_BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type UntilResult,
} from "../harness";
import { ARRIVAL_TICKS, bannerUp, clearAWave } from "./scenario";

/** The wave the run is posed at. Nothing here reads the number; it only needs one. */
const POSED_WAVE = 3;

/**
 * Where the picture is taken: with half the banner left to run.
 *
 * A capture point rather than a threshold — the sweep asserts the same thing on
 * both sides of it — chosen so the evidence shows the banner well under way over a
 * field that is still empty, rather than the wave arriving underneath it.
 */
const STILL_AT = WAVE_BANNER_TIME / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds every rock back for as long as the banner is showing", async () => {
  const cleared = await clearAWave(h, { wave: POSED_WAVE });
  const raised = await bannerUp(h, cleared);

  /** Sweep until a rock appears or the banner has run down to `floor`. */
  const sweepTo = (floor: number): Promise<UntilResult> =>
    h.until(
      (snapshot) => snapshot.rocks.length > 0 || snapshot.waveBanner <= floor,
      { maxTicks: ARRIVAL_TICKS, poll: 1 },
    );

  // The requirement, applied wherever a leg of the sweep stopped: while the banner
  // is showing the field holds nothing. A leg that stopped with the banner already
  // over stopped on the wave arriving on time, which is what should happen.
  const noRocksWhileShowing = (leg: UntilResult): void => {
    const { snapshot } = leg;
    if (snapshot.waveBanner <= 0) return;
    assertLength(
      snapshot.rocks,
      0,
      `rocks on the field ${leg.ticks} ticks after the banner went up, with ` +
        `${snapshot.waveBanner.toFixed(3)} of its ${WAVE_BANNER_TIME} seconds ` +
        `still to run: specs/progression.md puts no rock on the field at any ` +
        `point while the banner is showing, and spawns the wave it announces ` +
        `as it ends (the banner stood at ${raised.waveBanner} when it went up)`,
    );
  };

  const firstLeg = await sweepTo(STILL_AT);
  // An empty field behind a banner half run down, which is what the item is about.
  await captureStill(h, "banner");
  noRocksWhileShowing(firstLeg);

  noRocksWhileShowing(await sweepTo(0));
});
