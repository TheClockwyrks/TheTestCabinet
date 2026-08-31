// waves/spawns-as-the-banner-ends — the announced wave arrives, whole, on the
// tick the banner runs out.
//
// THE RULE. `specs/progression.md`, "The banner": "The banner runs for
// `WAVE_BANNER_TIME` (`1.5` seconds), and the rocks it announces are spawned as
// it ends."
//
// WHAT IS MEASURED, over the ticks around the banner reaching `0`:
//
//   ARRIVED — the field holds rocks on the tick the banner ends, or the tick
//     after it;
//   WHOLE — the field holds no MORE rocks at any tick over the half second that
//     follows than it did on that tick, so the wave came up in one beat rather
//     than in dribs and drabs.
//
// THE TIMING ALONE, AND NOT THE COUNT. How many rocks a wave holds is
// `wave-one-spawns-four`'s and `wave-n-spawns-three-plus-n`'s point, and this
// check deliberately never names a number: it compares the roster at the arrival
// against the roster half a second later, so a build whose waves are the wrong
// SIZE passes here and loses those two points rather than three. Where the rocks
// stand is `spawns-clear-of-the-ship`'s and `spawns-clear-of-the-star`'s, and that
// the field was empty until then is `no-rock-during-the-banner`'s.
//
// THE COMPARISON IS SOUND BECAUSE NOTHING CAN TAKE A ROCK OFF THE FIELD HERE. The
// field is quiet — no round is fired, the ship's lethal contact is off, and
// `specs/progression.md` has the star RECYCLE a rock rather than remove one — so
// over the window the roster can only grow, and it grows only if the build put
// more rocks up. A rock cannot reach the core inside the window in any case: a
// wave spawns no closer than `WAVE_MIN_STAR_DIST` (`200`) and drifts at most
// `154` units per second, which is `77` units in half a second.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that spawns
// nothing at all reads `0` at the arrival. A build that spawns half a second after
// the banner reads `0` at the arrival and a full roster later. A build that
// trickles its wave in over the following second reads a small roster at the
// arrival and a larger one after it. A build that spawns at the MOMENT OF THE
// CLEAR rather than at the end of the banner passes this check — its rocks are up
// and settled long before the banner ends — and is decided by
// `no-rock-during-the-banner`; the pair names which of the two a build is.
//
// THE ONE-TICK ALLOWANCE. "As it ends" is one beat, and `specs/simulation.md` does
// not fix where a spawn sits among a tick's six steps, so a build that decrements
// the banner to zero and spawns on the next tick is inside the rule. Two ticks is
// not.
//
// THE CLEAR IS A REAL KILL, through `./scene.ts`, never `clearRocks`.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  sampleEvery,
  seconds,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";
import { clearTheWave, openWaveAt } from "./scene";

/**
 * The wave the field is posed at.
 *
 * Four, so the wave that arrives is a big one: a build that trickles its rocks in
 * has eight of them to trickle, which shows in the roster rather than resting on
 * one rock landing a tick late.
 */
const WAVE = 4;

/** How long after the arrival the roster is watched for late arrivals. */
const SETTLE_SECONDS = 0.5;

/**
 * How long the banner itself is waited out before the check gives up.
 *
 * A BOUND ON THE SCENARIO, NOT A THRESHOLD ON THE BUILD: three times
 * `WAVE_BANNER_TIME` and a half second, so a build whose banner is too LONG — a
 * defect `banner-runs-for-1p5s` already charges it for — is still measured on the
 * rule this item is about. A conformant build's banner ends at `1.5` s and never
 * comes near it.
 */
const BANNER_WINDOW_TICKS = ticksFor(3 * WAVE_BANNER_TIME + 0.5);

/**
 * How long the roster is watched after the banner ends: the tick of grace the
 * arrival is allowed, and then the half second late arrivals would show in.
 *
 * The tail is also what keeps the recording honest: it ends on the wave standing
 * on the field and beginning to drift, rather than cutting on the frame the
 * measurement was taken.
 */
const SETTLE_TICKS = ticksFor(SETTLE_SECONDS);

/**
 * How many ticks after the banner reaches zero the wave may arrive.
 *
 * ONE. "As it ends" is one beat, and `specs/simulation.md` fixes the order of the
 * six steps inside a tick without saying where a spawn sits among them.
 */
const ARRIVAL_LATE_TICKS = 1;

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

it("puts the announced wave up whole as the banner reaches zero", async () => {
  openWaveAt(h, WAVE);

  const read = (s: ShatterSnapshot): Sample => ({
    banner: s.waveBanner,
    rocks: s.rocks.length,
  });

  const watch = await captureReplay(h, "arrival", async () => {
    await clearTheWave(h);

    // The banner, tick by tick, until it runs out — however long the build runs
    // it for. Stopping at a conformant build's 1.5 s would fail this item for a
    // banner that is merely too long, which is another item's defect.
    const samples: Sample[] = [];
    let seen = false;
    for (let ticks = 0; ticks < BANNER_WINDOW_TICKS; ticks += 1) {
      const sample = read(h.snapshot());
      samples.push(sample);
      if (sample.banner > 0) seen = true;
      // The first tick with no banner AFTER one that had it: the end the arrival
      // is timed against. Stop there, with the clock exactly on that sample.
      else if (seen) break;
      await h.advance(1);
    }
    // The tick of grace the arrival is allowed, and the settle window after it.
    const after = await sampleEvery(h, SETTLE_TICKS, 1, read);
    // `sampleEvery` reads before it advances, so its first entry repeats the last.
    return [...samples, ...after.slice(1)];
  });

  // The window has to have held a running banner that then ran out, or there is
  // no "as it ends" to read the arrival against.
  const raised = watch.findIndex((sample) => sample.banner > 0);
  assertGreaterThan(
    raised,
    -1,
    "a banner raised by the clear, whose end this item times the arrival " +
      "against (specs/progression.md); a build that raises none is decided by " +
      "waves/clears-on-last-rock",
  );

  const ended = watch.findIndex(
    (sample, index) => index > raised && sample.banner <= 0,
  );
  assertGreaterThan(
    ended,
    -1,
    `the banner running out within ` +
      `${seconds(BANNER_WINDOW_TICKS).toFixed(2)} s of the clear, which is ` +
      `three times the WAVE_BANNER_TIME (${String(WAVE_BANNER_TIME)} s) it is ` +
      `specified to run for (specs/progression.md) — the arrival cannot be ` +
      `timed against an end that never comes; a banner of the wrong LENGTH is ` +
      `decided by waves/banner-runs-for-1p5s`,
  );

  // ARRIVED: the tick the banner ended on, or the tick after it.
  const arrival = watch
    .slice(ended, ended + 1 + ARRIVAL_LATE_TICKS)
    .reduce((most, sample) => Math.max(most, sample.rocks), 0);

  assertGreaterThan(
    arrival,
    0,
    `the announced wave on the field within a tick of the banner reaching 0 — ` +
      `the rocks the banner announces are spawned as it ends ` +
      `(specs/progression.md); the field was still empty ` +
      `${String(ARRIVAL_LATE_TICKS)} tick(s) after the banner ran out. How ` +
      `many rocks the wave holds is waves/wave-n-spawns-three-plus-n's point, ` +
      `not this one`,
  );

  // WHOLE: nothing arrived afterwards. Nothing on this quiet field can take a
  // rock off it, and the star recycles rather than removes, so the roster can
  // only grow — and it grows only if the build spawned again.
  const settled = watch
    .slice(ended)
    .reduce((most, sample) => Math.max(most, sample.rocks), 0);

  assertEqual(
    settled,
    arrival,
    `the whole wave up in one beat: no more rocks on the field over the ` +
      `${String(SETTLE_SECONDS)} s after the banner ran out than there were ` +
      `within a tick of it running out — the rocks the banner announces are ` +
      `spawned as it ends, not trickled in afterwards (specs/progression.md); ` +
      `${String(arrival)} rock(s) arrived with the banner and the field later ` +
      `held ${String(settled)}`,
  );
});
