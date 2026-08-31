// waves/no-rock-during-the-banner — the field stays empty for the whole of the
// banner.
//
// THE RULE. `specs/progression.md`, "The banner": "No rock is on the field at any
// point while the banner is showing."
//
// WHAT IS MEASURED. The rock roster at EVERY TICK of the banner a real clear
// raised. Every tick rather than a sample, because the rule is about every point:
// a build that spawns its wave halfway through the banner and a build that spawns
// it as the banner ends leave the same field at both ends of the window, and only
// a per-tick reading tells them apart.
//
// WHAT THIS ITEM DOES NOT DECIDE, AND WHICH ONE DOES. That the rocks eventually
// ARRIVE. A build whose wave loop raises a banner and then spawns nothing at all
// passes this check and fails `spawns-as-the-banner-ends`, which is the item for
// the arrival. Splitting them that way is what makes a failure here name the
// defect it is for: rocks were on the field while the banner was showing.
//
// THE ONE-TICK GRACE AT THE END. `specs/progression.md` says the rocks the banner
// announces "are spawned as it ends", so the spawn and the banner's last tick are
// the same beat. A build whose spawn runs before the tick's decrement takes the
// banner to zero reports, for exactly one tick, rocks on the field and a banner
// showing a fraction of a tick. Samples whose banner is within one `TICK_DT` of
// zero are therefore not held to the rule — that is the tick the specification
// hands to the arrival. Everything earlier is.
//
// THE POSE. `openWaveAt` leaves an empty quiet field with the wave loop on and
// nothing else; the only rock in the scenario is the one the check destroys to
// raise the banner, and destroying a `small` leaves nothing behind
// (`specs/rocks.md`). So any rock seen under the banner is one the build put
// there.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT, WAVE_BANNER_TIME } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  sampleEvery,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";
import { clearTheWave, openWaveAt } from "./scene";

/** The wave the field is posed at. Any wave raises the same banner. */
const WAVE = 3;

/**
 * How long the banner is watched: `WAVE_BANNER_TIME` and a tenth of a second.
 *
 * The extra tenth carries the window past the end of a conformant build's banner,
 * so the samples the rule is applied to cover the whole of it rather than
 * stopping a tick short of the moment a late spawn would show.
 */
const WATCH_TICKS = ticksFor(WAVE_BANNER_TIME + 0.1);

/**
 * The banner reading below which a sample is the arrival's own tick rather than
 * the banner's.
 *
 * One `TICK_DT`. `specs/progression.md` spawns the wave "as it ends", so the last
 * tick of the banner and the first tick of the wave are one beat, and which side
 * of that tick's decrement a build spawns on is not something the specification
 * fixes.
 */
const ENDING = TICK_DT;

/** Where the still is taken: halfway through a conformant build's banner. */
const HALFWAY_TICKS = ticksFor(WAVE_BANNER_TIME / 2);

/** What each tick of the window is read down to. */
interface Sample {
  banner: number;
  rocks: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the field empty at every tick the banner is showing", async () => {
  openWaveAt(h, WAVE);
  await clearTheWave(h);

  const read = (s: ShatterSnapshot): Sample => ({
    banner: s.waveBanner,
    rocks: s.rocks.length,
  });

  // Watched in two halves so the still lands MID-BANNER, on the empty field the
  // item is named for, rather than at the end of the window where a conformant
  // build's wave has already arrived.
  const first = await sampleEvery(h, HALFWAY_TICKS, 1, read);
  // The empty field behind the running banner.
  captureStill(h, "banner");
  const rest = await sampleEvery(h, WATCH_TICKS - HALFWAY_TICKS, 1, read);
  // `sampleEvery` reads before it advances, so its first entry repeats the last
  // entry of the half before it.
  const watch = [...first, ...rest.slice(1)];

  const showing = watch.filter((sample) => sample.banner > ENDING);
  // The window has to have contained a banner, or the rule below is vacuous.
  // That a banner rises at all is `clears-on-last-rock`'s item.
  assertGreaterThan(
    showing.length,
    0,
    "a banner showing for at least one tick of the window, since this item is " +
      "about what the field holds while it shows (specs/progression.md); a " +
      "build that raises no banner is decided by waves/clears-on-last-rock",
  );

  const crowded = showing.reduce((a, b) => (b.rocks > a.rocks ? b : a));
  assertEqual(
    crowded.rocks,
    0,
    `no rock on the field at any of the ${String(showing.length)} ticks the ` +
      `banner was showing — no rock is on the field at any point while the ` +
      `banner is showing, and the rocks it announces are spawned as it ends ` +
      `(specs/progression.md); the sample with the most rocks had ` +
      `${crowded.banner.toFixed(3)} s left on the banner`,
  );
});
