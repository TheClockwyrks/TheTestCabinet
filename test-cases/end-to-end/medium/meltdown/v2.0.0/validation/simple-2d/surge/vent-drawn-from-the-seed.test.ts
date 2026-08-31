// surge/vent-drawn-from-the-seed — the vent each unit enters at is drawn from the
// game's seeded generator, and the same seed draws the same sequence.
//
// THE RULE. specs/waves.md, The release: "Each unit's vent is drawn from the game's
// seeded generator, the two vents equally likely. That draw is the only randomness
// in the game, so a run replayed from the same seed releases the same sequence of
// vents." specs/instrumentation.md says where the seed comes from: `reset` takes
// "`options.seed`, a number defaulting to `DEFAULT_SEED` (`1`)", which "seeds all
// of the game's randomness", and the generator keeps "its whole generator state in
// that field, so reseeding and replaying the same calls reproduces the same result
// exactly".
//
// TWO CLAIMS, READ SEPARATELY. That both vents are actually drawn — a build that
// sends every unit through one vent has no draw at all — and that the sequence is
// reproducible from the seed. A build that draws from an unseeded source passes the
// first and fails the second; a build that returns a constant passes the second and
// fails the first.
//
// HOW TWO RUNS OF THE SAME SEED ARE REACHED. Every arrangement in this suite opens
// with `startRun`, which calls `reset` with no options — and `reset` with no options
// seeds from `DEFAULT_SEED`. So the second watch below is not merely another run: it
// is the SAME seed, restored, and the specification says its sequence must match the
// first exactly. Nothing between the two watches touches the seed, and the second
// run's wave, mode and difficulty are the first's.
//
// A WAVE OF FORTY, WHICH IS WHAT MAKES BOTH READINGS MEAN SOMETHING. Wave 4 of the
// 20-wave Containment run is a Swarm wave of `ceil(24 * 1.66)` — forty units
// (specs/waves.md) — so forty draws are read. Two vents equally likely over forty
// draws leaves a build that genuinely draws them essentially no chance of using only
// one, and forty entries is a sequence no coincidence reproduces: a build drawing
// from an unseeded source matches the first run's forty in one case out of `2^40`.
//
// WHAT IS NOT ASSERTED, AND WHY. Not that the draw is uniform, and not that it has
// any particular shape. "The two vents equally likely" is a statement about a
// distribution and no run of forty can decide it; what is decided here is what the
// specification's own sentence promises a reader — that both vents are used, and
// that the seed reproduces the order.
//
// THE LIVES ARE POSED OUT OF REACH (surge/release.ts): forty Swarms released against
// an empty floor leak most of themselves long before the fortieth is released, and
// lives running out would end the run and cut the sequence short.
//
// WHAT EVERY WRONG MODEL READS. A build that always enters at the left vent reads a
// sequence of forty `left`s and no `top`; one that alternates strictly is
// reproducible but is not a draw, and it is the vent-count reading that lets it
// through and the `single-type-waves` and `wave-size` points that do not care —
// this point catches the two defects the specification's sentence actually names;
// one that draws from `Math.random` reads two sequences that differ, in practice
// inside the first handful of units.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  poseWaveReady,
  sizeOfWave,
  watchRelease,
  watchSecondsFor,
  wavesIn,
  type Release,
} from "./release";

/** The wave the draws are read on: the 20-wave run's forty-unit Swarm wave. */
const WAVE = 4;

/**
 * The fewest draws a reading is taken across.
 *
 * A wave that released one unit has one draw, and neither "both vents were used"
 * nor "the sequence repeated" says anything about one draw. How many the wave
 * should have released is `wave-size`; this is only the precondition that there was
 * a sequence at all.
 */
const MIN_DRAWS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Release the wave and hand back the vent each unit entered at, in release order. */
async function ventsDrawn(h: Harness, seconds: number): Promise<string[]> {
  poseWaveReady(h, WAVE);
  const released: Release[] = await watchRelease(h, { seconds });
  return released.map((unit) => unit.vent);
}

it("uses both vents across a wave, and draws the same order twice from one seed", async () => {
  const waves = wavesIn();
  const watchSeconds = watchSecondsFor(sizeOfWave(WAVE, waves));

  const first = await ventsDrawn(h, watchSeconds);
  const second = await ventsDrawn(h, watchSeconds);

  captureStill(h, "vents");

  assertGreaterThanOrEqual(
    first.length,
    MIN_DRAWS,
    `precondition: the units wave ${WAVE} released, each of which is one draw`,
  );

  // Both vents were actually drawn.
  assertContains(first, "left", `the vents drawn across ${first.length} units`);
  assertContains(first, "top", `the vents drawn across ${first.length} units`);

  // And the seed reproduced the order, entry for entry.
  assertDeepEqual(
    second,
    first,
    `the vent order a second run of the same seed drew, against the first ` +
      `run's ${first.length} draws`,
  );
});
