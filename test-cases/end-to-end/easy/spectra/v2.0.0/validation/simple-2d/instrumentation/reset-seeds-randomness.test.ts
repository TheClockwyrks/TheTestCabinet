// instrumentation/reset-seeds-randomness — the seed a reset carries decides the
// wave the game builds for itself.
//
// specs/instrumentation.md: "`options.seed`, a number defaulting to
// `DEFAULT_SEED` (`1`), seeds all of the game's randomness", over a core in which
// "Any randomness the game uses runs off a generator seeded from the state's
// generator field, and it keeps its whole generator state in that field, so
// reseeding and replaying the same calls reproduces the same result exactly. The
// wave's layout ... a Flux's starting phase ... are all drawn from it." And:
// "Given the same seed and the same sequence of calls and elapsed game time, the
// game reaches the same state every time."
//
// THE THING UNDER TEST IS THE WAVE THE GAME BUILDS FOR ITSELF, so this is one of
// the few points on the checklist that lets the wave's own entry run. Nothing
// about the roster is posed: `startStage` puts the stage-intro hold at zero and
// runs the one frame that gives way to the live wave, and "The wave for a stage
// is built in the moment the stage-intro hold gives way to the live wave"
// (specs/stages.md). What is read is the roster that frame produced.
//
// WHAT IS COMPARED, AND WHY IT IS READ AT THE BUILD. The wave's composition and
// layout: each drone's kind, the slot it was given, and the band it carries, in
// roster order — this point's own description, "the same drone kinds at the same
// slots with the same bands". It is read on the frame the wave is built, before
// any drone has been released, so what is compared is the LAYOUT the generator
// drew rather than how far the entrance has carried anyone.
//
// THREE RUNS IN ONE GAME, WHICH IS WHAT `reset` IS FOR. A reset restores every
// declared field and reseeds, so the second run of seed 7 begins from exactly the
// state the first did and is the "same sequence of calls" the specification
// names. That is a stronger reading than two separate games would be: it decides
// that the whole generator state lives in the state a reset restores, rather than
// in a module-level variable that a fresh process would happen to reinitialize.
//
// WHAT THIS DOES NOT DECIDE. What a wave is MADE of — the bands, the symmetry,
// the composition — which is `swarm/*`'s, or that the stage's wave is built at
// the intro at all, which is `stages/wave-built-at-intro`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The two seeds this point names. */
const SEED_A = 7;
const SEED_B = 8;

/** The stage whose wave is built: the first one, which every run opens on. */
const STAGE = 1;

/**
 * Frames run before the still, purely so the picture shows the seeded wave on
 * its way in rather than an empty field.
 *
 * A second of game time: the wave's first group is released as the wave opens
 * and "carries the drone across `FIELD_TOP` into the play field within one second
 * of its release" (specs/swarm.md), so the frame kept shows drones in the field.
 * Nothing read below is taken after these frames.
 */
const PICTURE_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The wave's composition and layout, as one comparable string. */
function layout(s: SpectraSnapshot): string {
  return JSON.stringify(
    s.drones.map((drone) => [drone.kind, drone.slotX, drone.slotY, drone.band]),
  );
}

/** Reseed the game, let it build stage 1's own wave, and report the layout. */
async function waveFor(seed: number): Promise<SpectraSnapshot> {
  h.debug.reset({ seed });
  await startStage(h, STAGE);
  return h.snapshot();
}

it("builds the same wave from the same seed, and a different one from another", async () => {
  const first = await waveFor(SEED_A);
  assertGreaterThan(
    first.drones.length,
    0,
    `drones in the wave stage ${String(STAGE)} built when its intro gave way ` +
      "— a stage's wave is built in that moment (specs/stages.md)",
  );
  assertEqual(
    first.waveEntry,
    true,
    "the wave's own entry runs after a reset, which is what lets the game " +
      "build and release its own wave (specs/instrumentation.md)",
  );

  const second = await waveFor(SEED_A);
  // The still shows the second run of the same seed on its way in.
  await h.advanceSeconds(PICTURE_SECONDS);
  captureStill(h, "seeded");

  const other = await waveFor(SEED_B);

  assertEqual(
    layout(second),
    layout(first),
    `the stage-${String(STAGE)} wave built after reset({ seed: ` +
      `${String(SEED_A)} }), against the wave the same seed built before it — ` +
      "the same seed and the same sequence of calls reach the same state " +
      "(specs/instrumentation.md)",
  );
  assertNotEqual(
    layout(other),
    layout(first),
    `the stage-${String(STAGE)} wave built after reset({ seed: ` +
      `${String(SEED_B)} }), against the wave seed ${String(SEED_A)} built — ` +
      "the wave's layout is drawn from the seeded generator, so a different " +
      "seed builds a different wave (specs/instrumentation.md)",
  );
});
