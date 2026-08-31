// bays/fish-is-alone — however long the cadence runs, there is never more than
// one bonus catch on the strait.
//
// specs/bays.md: "At most one is on the strait at a time." specs/instrumentation.md
// gives the snapshot one field for it — `fishBay: <number> | null`, "the bay
// holding the bonus catch, or null" — so a build that had two catches out would
// have to report it as something other than one bay index or `null`: an array, a
// list of bays, a second field's worth of state leaking into this one. That is
// what is read below, sample by sample, alongside the index being one of the five
// bays `specs/strait.md` gives the far shore.
//
// A MINUTE OF LIVE CROSSING, not a posed still. The review item names sixty
// seconds because the cadence's whole cycle is thirteen (`FISH_LINGER` plus
// `FISH_INTERVAL`), so a minute carries four or five appearances and four or five
// departures — enough that a build which forgets to take the old catch off before
// putting the next one out has to show it. Nothing is posed onto the strait at
// all: the catches this point watches are the ones the build's own cadence made,
// which is why `setFishCadence` goes back on and `setFishBay` is never called.
//
// At least one appearance is required, so a build whose cadence never runs fails
// here rather than passing on sixty seconds of `null`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { BAY_COUNT, TICK_HZ } from "../../src/constants";
import {
  captureStill,
  createHarness,
  seconds,
  startCrossing,
  type Harness,
} from "../harness";

/** The span the review item names, in seconds of game time. */
const WATCH_SECONDS = 60;

/** How many frames separate two samples: a quarter of a second. */
const SAMPLE_FRAMES = Math.round(0.25 * TICK_HZ);

/** How many samples that comes to across the span. */
const SAMPLES = Math.round((WATCH_SECONDS * TICK_HZ) / SAMPLE_FRAMES);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("never reports more than one bonus catch across a minute of cadence", async () => {
  startCrossing(h);
  h.debug.setFishCadence(true);

  let appearances = 0;
  let previous: number | null = null;
  let pictured = false;

  for (let sample = 1; sample <= SAMPLES; sample += 1) {
    await h.advance(SAMPLE_FRAMES);
    const at = seconds(sample * SAMPLE_FRAMES).toFixed(2);
    const { fishBay } = h.snapshot();

    if (fishBay !== null) {
      assertEqual(
        typeof fishBay,
        "number",
        `t=${at}s: one bay index, or null, and nothing else`,
      );
      assertEqual(
        Number.isInteger(fishBay),
        true,
        `t=${at}s: a whole bay index`,
      );
      assertBetween(
        fishBay,
        0,
        BAY_COUNT - 1,
        `t=${at}s: a bay the far shore has`,
      );
      if (previous === null) {
        appearances += 1;
        if (!pictured) {
          captureStill(h, "fish");
          pictured = true;
        }
      }
    }
    previous = fishBay;
  }

  // A minute that produced no catch at all still leaves a picture of the strait
  // it was watched on, so the failure below is read beside what was on screen.
  if (!pictured) captureStill(h, "fish");

  assertGreaterThanOrEqual(
    appearances,
    1,
    `bonus catches across ${WATCH_SECONDS} s of cadence`,
  );
});
