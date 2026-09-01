// swarm/wave-composition — a standard wave is built of all three kinds.
//
// specs/swarm.md, "What a standard wave is made of": "A standard wave's formation
// holds: Shards of both bands as the bulk of it; at least two Fluxes; and at
// least one Prism."
//
// Each of those is asserted as the specification states it and no further. The
// two Fluxes and the one Prism are floors rather than counts, because "The total
// grows with the stage, up to the grid's capacity, and later stages lean further
// on Fluxes and Prisms" — a build is free to send more. The Shards are read for
// BOTH BANDS, on the stored band, which is the band a Shard holds for its whole
// life (`specs/drones.md`); their being the bulk of the wave is not asserted,
// because "the bulk" is not a figure and a build that answered it with a fifth
// Flux instead of a fifth Shard has broken nothing this case can name.
//
// STAGE 1 IS A STANDARD WAVE. `isChallengeStage` is `stage % 3 === 0`
// (`specs/stages.md`), so the first stage is the standard wave this rule is about;
// what a challenge stage sends instead is the `stages` group's.
//
// The wave is the game's own and is given the twelve seconds `swarm/assembles`
// allows it, and the reading is over the drones standing in the formation, which
// is where the specification puts the rule. The dive gate is shut so the block is
// read whole rather than with a diver missing from it, and the contact gate so
// nothing reaching the ship interrupts the wave.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  dronesInPhase,
  startPosed,
  startStage,
  type Band,
  type Harness,
} from "../harness";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/** The two bands specs/bands.md fixes; there is no third and no neutral value. */
const BANDS: readonly Band[] = ["cyan", "magenta"];

/** The seconds the wave is given to assemble, as `swarm/assembles` allows. */
const ASSEMBLE_BY = 12;

/** The floors the specification puts on a standard wave's formation. */
const MIN_FLUXES = 2;
const MIN_PRISMS = 1;
/** Shards "of both bands", so at least one holding each. */
const MIN_SHARDS_PER_BAND = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds a standard wave out of Shards of both bands, two Fluxes and a Prism", async () => {
  startPosed(h);
  h.debug.setWaveEntry(true);
  await startStage(h, STAGE);

  await h.advanceSeconds(ASSEMBLE_BY);
  const settled = h.snapshot();
  captureStill(h, "composition");

  const assembled = dronesInPhase(settled, "formation");
  const kinds = assembled.map((drone) => drone.kind).join(", ");

  assertGreaterThanOrEqual(
    assembled.filter((drone) => drone.kind === "flux").length,
    MIN_FLUXES,
    `the Fluxes the assembled formation of stage ${STAGE} holds, out of ` +
      `[${kinds}] (specs/swarm.md)`,
  );
  assertGreaterThanOrEqual(
    assembled.filter((drone) => drone.kind === "prism").length,
    MIN_PRISMS,
    `the Prisms the assembled formation of stage ${STAGE} holds, out of ` +
      `[${kinds}] (specs/swarm.md)`,
  );
  for (const band of BANDS) {
    assertGreaterThanOrEqual(
      assembled.filter((drone) => drone.kind === "shard" && drone.band === band)
        .length,
      MIN_SHARDS_PER_BAND,
      `the ${band} Shards the assembled formation of stage ${STAGE} holds, ` +
        `out of [${kinds}] (specs/swarm.md)`,
    );
  }
});
