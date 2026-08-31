// Meltdown — surge/vent-drawn-from-the-seed: the vents come off the seed.
//
// THE RULE. `specs/waves.md`, The release: "Each unit's vent is drawn from the
// game's seeded generator, the two vents equally likely. That draw is the only
// randomness in the game, so a run replayed from the same seed releases the same
// sequence of vents." Two claims, and this point reads both: the draw REACHES both
// vents, and it is REPRODUCIBLE from the seed.
//
// WHY FORTY UNITS. A short wave could use both vents by accident, and a long one
// makes an all-one-vent build unmistakable: forty fair draws land on one side only
// once in five hundred billion times. Forty is also long enough that a build whose
// sequence differs between two runs — a generator seeded off the clock, say —
// differs somewhere inside the comparison rather than by luck agreeing.
//
// WHY THE TWO RUNS ARE THE SAME RUN TWICE. `specs/instrumentation.md` gives
// `reset()` a fixed default seed, `DEFAULT_SEED`, and `startRun` opens with one, so
// two runs opened this way are two runs at one seed and their sequences must agree
// exactly. Nothing is posed between the reset and the release that could feed the
// generator, so the only draws taken are the forty this point asked for.
//
// WHY EACH ARRIVAL IS HELD WHERE IT ARRIVED. Forty units at the stated cadence take
// nearly twenty-five seconds of game time, comfortably longer than a Mote takes to
// cross the floor, so a wave left to walk would be leaking before it had finished
// arriving — and `specs/waves.md` ends a run the moment the lives reach `0`, which
// would stop the release halfway through and leave this point reading a truncated
// sequence. `setUnitMotion(id, false)` holds each unit on the tile it entered on
// and leaves everything else about it alone (`specs/instrumentation.md`), so all
// forty draws happen. What this point measures is the draw, not the walk.
//
// WHAT THIS DOES NOT DECIDE. That the two vents are drawn EQUALLY often is a
// distributional claim a single seed cannot settle, and asserting a split on one
// fixed sequence would fail a perfectly fair generator that happened to land
// twenty-six to fourteen. This point holds a build to what the item states: both
// vents are used, and the sequence repeats.
//
// WHAT EVERY WRONG MODEL READS. A build that enters every unit at one vent reads
// forty of the same name; one that drew from `Math.random` rather than from the
// game's seeded generator reads two different sequences; one that reseeded the
// generator on every draw reads one repeated name; one that seeded off the wall
// clock reads two different sequences. Each failure names the draw it happened on.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
  type VentName,
} from "../harness";
import { poseWavePhase, watchReleases } from "./scenario";

/** How many draws the sequence is read over (the item's own figure). */
const DRAWS = 40;

/** The wave the units are released for; its type is nothing to do with this point. */
const WAVE = 1;

/**
 * Seconds of game time a run is watched for: twenty-eight.
 *
 * Geometry rather than a tolerance. Forty units at `specs/waves.md`'s `0.6`-second
 * cadence are all out inside twenty-five seconds; twenty-eight leaves room for a
 * build whose release clock runs a little slow without this point depending on the
 * cadence at all, which `surge/spawn-cadence` decides.
 */
const WATCH_TICKS = ticksFor(28);

/** Frames between two samples: a twentieth of a second, well inside one interval. */
const POLL_FRAMES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Release a wave of `DRAWS` units and hand back the vent each entered at. */
async function sequence(): Promise<VentName[]> {
  poseWavePhase(h, WAVE, DRAWS, "containment", "medium");
  const watch = await watchReleases(h, WATCH_TICKS, {
    poll: POLL_FRAMES,
    // Held where it arrived, so all forty draws happen: a wave left to walk would
    // be leaking before it had finished arriving, and a run whose lives ran out
    // would stop releasing (specs/waves.md).
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  return watch.releases.map((release) => release.vent);
}

it("uses both vents across forty units and draws the same sequence twice", async () => {
  const first = await sequence();
  captureStill(h, "vents");
  const second = await sequence();

  assertLength(first, DRAWS, "the units the first run released");
  assertLength(second, DRAWS, "the units the second run released");

  // Both vents are used.
  assertContains(
    first,
    "left",
    `the vents drawn over ${DRAWS} units; specs/waves.md draws from both`,
  );
  assertContains(
    first,
    "top",
    `the vents drawn over ${DRAWS} units; specs/waves.md draws from both`,
  );

  // And the sequence is the seed's, not the moment's.
  for (let index = 0; index < DRAWS; index += 1) {
    assertEqual(
      second[index],
      first[index],
      `draw ${index + 1} of ${DRAWS} on the second run at the same seed, ` +
        `against the ${first[index]} the first run drew (specs/waves.md)`,
    );
  }
});
