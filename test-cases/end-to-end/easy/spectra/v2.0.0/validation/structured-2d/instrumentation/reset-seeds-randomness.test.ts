// instrumentation/reset-seeds-randomness — `reset({ seed })` seeds all of the
// game's randomness, so the same seed builds the same wave and a different seed
// builds a different one.
//
// specs/instrumentation.md rests the surface on it, under A deterministic core:
// "Any randomness the game uses runs off a generator seeded from the state's
// generator field, and it keeps its whole generator state in that field, so
// reseeding and replaying the same calls reproduces the same result exactly. The
// wave's layout, the choice of which drone dives next, the gap before the next
// dive, a Flux's starting phase, and each burst's scatter are all drawn from it."
// `options.seed`, it adds, "a number defaulting to `DEFAULT_SEED` (`1`), seeds all
// of the game's randomness". specs/simulation.md says the same thing from the
// other side: "Given the same seed and the same sequence of calls and elapsed game
// time, the game reaches the same state every time."
//
// THE WAVE THE GAME BUILDS IS THE WITNESS BECAUSE IT IS DRAWN ALL AT ONCE. It is
// laid out in the single moment the stage-intro hold gives way (specs/stages.md),
// and two of the five draws that specification names land in it: "The wave's
// layout" and "a Flux's starting phase". So the wave is read as both — the kind,
// the slot and the stored band of every drone on it, and how far into its band
// window each Flux began — and two runs that agree on all of that agree on the
// generator. The dive order, the dive gap and a burst's scatter run off the same
// generator and would each need a scenario of their own to reach.
//
// THE TWO HALVES ASK FOR DIFFERENT THINGS, AND DELIBERATELY SO. The same seed must
// reproduce the wave EXACTLY — every field of it, which is what "reproduces the
// same result exactly" means and what every replayed scenario in this suite rests
// on. Two different seeds must differ SOMEWHERE in it, which is all the
// specification supports: specs/swarm.md leaves which slots a wave fills to the
// build ("Which slots a wave fills is yours, subject to three rules"), so a build
// whose block is a fixed shape and whose Fluxes start at drawn phases is
// conformant, and a build that draws the block as well is conformant too. What
// neither may be is a wave with no draw in it at all.
//
// THE WAVE IS OPENED THE ONLY WAY A WAVE IS OPENED. Nothing on the surface builds
// one: `setStage` "spawns nothing and clears nothing" (specs/instrumentation.md),
// so the stage's intro is posed with no hold left and the build's own transition
// is what lays the wave out. That is what `startStage` does, and it is called
// straight after the reset, where the three world gates stand as the specification
// leaves them.
//
// WHAT IS COMPARED, AND WHY IT IS THE FAIR COMPARISON. Each drone's kind, the slot
// it was given, the band it carries, and a Flux's band clock — sorted, so two
// waves are compared as WAVES rather than as roster orders, which the
// specification never fixes. Positions are deliberately not compared: the drones
// are already flying their entrances by the time the roster is read, and the path
// each takes is the build's. Both runs of a seed reach the reading over the same
// number of frames, so a band clock that has advanced has advanced by the same
// amount in each.
//
// WHAT THIS DOES NOT DECIDE. Nothing about the layout itself: that it is
// mirror-symmetric, that it holds both bands, and what a standard wave is made of
// are `swarm.formation-symmetric`, `swarm.both-bands` and
// `swarm.wave-composition`. This point reads only whether two waves are the same
// wave.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_INTRO_HOLD } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startStage,
  ticksFor,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The seed two runs share, and the one a third run is given instead. */
const SEED = 7;
const OTHER_SEED = 8;

/**
 * How long the wave is given to appear after the intro is posed out, in seconds.
 *
 * `STAGE_INTRO_HOLD` (`2.0` s) is the whole hold specs/ui.md gives the intro, and
 * the hold is posed to zero before the frames below run, so this is many times the
 * figure — a build that opens its wave a frame or two later than another still
 * lays it inside this window. It is far short of a Flux's stage-1 band window
 * (`fluxWindow(1)` is `2.0` s) only by a hair, and the sweep stops at the first
 * frame that reports a drone, so no Flux can have flipped its stored band by the
 * time the layout is read.
 */
const OPEN_SECONDS = STAGE_INTRO_HOLD;

/**
 * The wave as one comparable string: every drone's kind, slot, stored band and
 * band clock, in a fixed order.
 *
 * The order the snapshot reports the drones in is not what this point is about,
 * so the entries are sorted here rather than compared where they lie.
 */
function waveOf(snapshot: SpectraSnapshot): string {
  return snapshot.drones
    .map(
      (drone) =>
        `${drone.kind}@${drone.slotX},${drone.slotY}:${drone.band}` +
        `+${drone.bandClock}`,
    )
    .sort()
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds the same stage-1 wave for one seed and a different one for another", async () => {
  /** Seed the generator, open stage 1, and read the wave the build laid out. */
  const waveFor = async (seed: number): Promise<string> => {
    resetTo(h, seed);
    await startStage(h, 1);
    const opened = await h.until((s) => s.drones.length > 0, {
      maxFrames: ticksFor(OPEN_SECONDS),
    });
    assertGreaterThan(
      opened.snapshot.drones.length,
      0,
      `the drones the stage-1 wave held within ${OPEN_SECONDS} s of its intro ` +
        `being posed out after reset({ seed: ${seed} }) — the roster holds ` +
        `every drone of the wave from the moment it is built ` +
        `(specs/swarm.md), and an empty one leaves nothing to compare`,
    );
    return waveOf(opened.snapshot);
  };

  const first = await waveFor(SEED);
  // Before the assertions, so a failing seed still leaves the picture of the
  // wave the first run built.
  captureStill(h, "seeded");

  const again = await waveFor(SEED);
  assertEqual(
    again,
    first,
    `the stage-1 wave a second run built after reset({ seed: ${SEED} }), ` +
      `against the wave the first one built — the same seed replays the same ` +
      `draws exactly (specs/instrumentation.md)`,
  );

  const other = await waveFor(OTHER_SEED);
  assertNotEqual(
    other,
    first,
    `the stage-1 wave a run built after reset({ seed: ${OTHER_SEED} }), ` +
      `against the wave seed ${SEED} built — the wave's layout and each Flux's ` +
      `starting phase are drawn from the seeded generator ` +
      `(specs/instrumentation.md), so two seeds do not build the same wave`,
  );
});
