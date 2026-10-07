// waves/spawns-as-the-banner-ends — the wave the banner announced arrives as the
// banner runs out.
//
// `specs/progression.md`, The banner: "The banner runs for `WAVE_BANNER_TIME`
// (`1.5` seconds), and the rocks it announces are spawned as it ends."
//
// THE OTHER HALF OF THE BREATHER. `no-rock-during-the-banner` grades that nothing
// arrives EARLY; this grades that everything arrives ON TIME. A build that holds
// its rocks back and then forgets to put them up leaves the player on an empty
// field with nothing to shoot, and it passes every other item in this group: the
// banner went up, it ran for a second and a half, the wave number advanced, and no
// rock was on the field while it showed. Only this item catches it.
//
// AND "EVERY ROCK", NOT "A ROCK". The specification spawns the wave, not the first
// of it, so a build that trickles its rocks in over the second that follows has not
// spawned the wave as the banner ended. The whole roster is counted, against the
// `WAVE_BASE_ROCKS + N` the wave being announced calls for.
//
// ONE TICK OF LATITUDE, AND ONLY ONE. `specs/simulation.md` fixes the order of work
// inside a tick but not where a build runs its wave timer within it, so the roster
// may fill on the tick `waveBanner` reaches zero or on the one after. One tick out
// of the hundred and eighty a banner runs for cannot hide a build that spawns late,
// and it is exactly the latitude the stated tick order leaves.
//
// SAMPLED EVERY TICK ACROSS THE HANDOVER, so the reading really is taken at the
// banner's end rather than at some comfortable moment afterwards — a check that
// advanced half a second and then counted would pass the trickling build it exists
// to catch.
//
// THE CLEARED FIELD IS REACHED BY SHOOTING, never by `clearRocks`. See the note at
// the top of `scenario.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME } from "../constants";
import { assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import type { ShatterSnapshot } from "../surface";
import { ARRIVAL_TICKS, bannerUp, clearAWave, waveRockCount } from "./scenario";

/** The wave the run is posed at, and the wave clearing it announces. */
const POSED_WAVE = 2;
const ARRIVING_WAVE = POSED_WAVE + 1;
const ARRIVING_ROCKS = waveRockCount(ARRIVING_WAVE);

/**
 * Where the replay starts: with a quarter of a second of banner left.
 *
 * A capture point rather than a threshold. The handover is what a reviewer needs to
 * see, and thirty ticks either side of it is enough to see it; the second and a
 * quarter before it is an empty field under a banner, which the still on
 * `no-rock-during-the-banner` already shows.
 */
const REPLAY_FROM = 0.25;

/** How long the replay keeps running once the wave is up. */
const WITNESS_TICKS = ticksFor(0.25);

/**
 * How many ticks past the banner's end the roster is allowed to fill: one.
 *
 * The whole latitude `specs/simulation.md`'s tick order leaves for where a build
 * runs its wave timer within a tick, and no more.
 */
const ARRIVAL_GRACE_TICKS = 1;

/**
 * How long the roster is watched after the banner runs out, in ticks.
 *
 * Half a second. Nothing on this field can take a rock off it — `startPlaying`
 * leaves no ship near the wave, `specs/progression.md` has the star RECYCLE a rock
 * rather than remove one, and a wave spawns no closer than `WAVE_MIN_STAR_DIST`
 * and drifts at most `154` units per second, which is `77` units in half a second —
 * so over the window the roster can only GROW, and it grows only if the build put
 * more rocks up.
 */
const SETTLE_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts every rock of the announced wave up as the banner reaches zero", async () => {
  const cleared = await clearAWave(h, { wave: POSED_WAVE });
  const raised = await bannerUp(h, cleared);

  // The march to the handover, filmed by nothing.
  await h.until((snapshot) => snapshot.waveBanner <= REPLAY_FROM, {
    maxFrames: ARRIVAL_TICKS,
    poll: 1,
  });

  const seen = await captureReplay(h, "arrival", async () => {
    const ended = await h.until((snapshot) => snapshot.waveBanner <= 0, {
      maxFrames: ARRIVAL_TICKS,
      poll: 1,
    });
    let arrived: ShatterSnapshot = ended.snapshot;
    if (arrived.rocks.length < ARRIVING_ROCKS) {
      await h.advance(ARRIVAL_GRACE_TICKS);
      arrived = h.snapshot();
    }
    // The wave on the field for a moment, so the replay shows what arrived.
    await h.advance(WITNESS_TICKS);
    return { ended, arrived };
  });

  assertLength(
    seen.arrived.rocks,
    ARRIVING_ROCKS,
    `rocks on the field within ${ARRIVAL_GRACE_TICKS} tick of the banner ` +
      `reaching 0, which specs/progression.md spawns as it ends: the wave ` +
      `announced was ${ARRIVING_WAVE}, calling for WAVE_BASE_ROCKS + ` +
      `${ARRIVING_WAVE} (${ARRIVING_ROCKS}) rocks; the banner ran from ` +
      `${raised.waveBanner} down to ${seen.ended.snapshot.waveBanner} over ` +
      `${seen.ended.frames} ticks (WAVE_BANNER_TIME is ${WAVE_BANNER_TIME}) and ` +
      `the game reported wave ${seen.arrived.wave}`,
  );

  // WHOLE, AND IN ONE BEAT. The count above says the announced wave was up within
  // a tick of the banner ending; this says nothing followed it. A build that
  // trickles its wave in over the second after the banner has not spawned it "as
  // the banner ends", and the count alone cannot tell that build from a
  // conformant one, because it reads a roster that is on its way to being right.
  await h.advance(SETTLE_TICKS);
  const settled = h.snapshot();

  assertLength(
    settled.rocks,
    ARRIVING_ROCKS,
    `rocks on the field ${String(SETTLE_TICKS)} ticks after the banner ran ` +
      `out, against the ${String(ARRIVING_ROCKS)} that were up within a tick ` +
      `of it — nothing on this field can take a rock off it and the star ` +
      `recycles rather than removes, so a roster that grew is a build that ` +
      `spawned again, trickling the wave in rather than putting it up as the ` +
      `banner ends (specs/progression.md)`,
  );
});
