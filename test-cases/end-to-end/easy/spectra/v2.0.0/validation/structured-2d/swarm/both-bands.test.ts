// swarm/both-bands — an assembled formation reads as both bands at once.
//
// specs/swarm.md, "The formation": "The formation holds at least one drone of
// each effective band at all times while it is assembled." That is the rule that
// keeps the ship's flip meaningful — a formation of one band could be cleared
// without ever flipping — and it is read as the specification states it, on the
// EFFECTIVE band (`specs/bands.md`), because that is the band a drone counts as:
// a Prism with its shell broken and a Flux mid-shimmer both read as something
// other than their stored band.
//
// THE WAVE IS THE GAME'S OWN, AND ITS ASSEMBLY IS POSED. `startStage` has the
// build's own stage-intro code build the stage-1 wave, so the roster, the kinds,
// the stored bands and the slots are all the build's and none of them is posed.
// Flying that wave in takes up to twelve seconds of game time, and none of it is
// what this point reads: the rule is about the block that stands at the end, and
// every drone reports the slot it is bound for from the moment the wave is built
// (`specs/swarm.md`, `specs/instrumentation.md`). So `settleWave` puts each drone
// at its own slot in phase `formation` through the surface, which is the state
// its entrance ends in, with the entry gate shut behind it so the wave's own
// release schedule cannot send a drone back out on its way in. What the block is
// made of is not touched.
//
// "AT ALL TIMES" IS TWO READINGS. A Shard's effective band is its stored band and
// a whole Prism's is its shell's, and neither moves on its own; a Flux's swings
// with its band clock, reading as its stored band while it holds and as the
// opposite while it shimmers (`specs/drones.md`). A block that leaned on its
// Fluxes for one of the bands would hold both on some beats and one on others.
// So the block is read twice, once with every Flux's band clock posed at `0`,
// every one holding, and once with every clock posed mid-shimmer, every one
// reading as the opposite band, with the oscillation gate shut on each so the
// posed beat holds through the frame that is read. Each of the two is a beat a
// real wave reaches, since every Flux draws its own starting clock, and the block
// must hold both bands on both.
//
// The dive gate stays shut, so the block read is the one the wave laid out rather
// than one a dive has taken a drone out of. Nothing here destroys a drone, so no
// band can leave the block between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import { FLUX_SHIMMER, fluxHold } from "../constants";
import { assertContains, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  dronesInPhase,
  dronesOfKind,
  settleWave,
  startPosed,
  startStage,
  type Band,
  type Harness,
} from "../harness";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/** The two bands specs/bands.md fixes; there is no third and no neutral value. */
const BANDS: readonly Band[] = ["cyan", "magenta"];

/** The drones the assembled block must hold for the reading to mean anything. */
const MIN_DRONES = 1;

/**
 * The two beats the block is read on: where every Flux's band clock is posed, in
 * seconds into its window, and what the Fluxes are doing there.
 *
 * `0` is the start of the held part of the window, where a Flux reads as its
 * stored band. Halfway through the shimmer — `fluxHold(1)` plus half of
 * `FLUX_SHIMMER`, well clear of both ends of it — a Flux reads as the opposite
 * band (specs/drones.md). Both are inside `[0, fluxWindow(1))`, the range
 * specs/instrumentation.md allows the clock to be posed over.
 */
const BEATS = [
  { fluxes: "holding", bandClock: 0 },
  { fluxes: "shimmering", bandClock: fluxHold(STAGE) + FLUX_SHIMMER / 2 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("assembles a formation holding at least one drone of each effective band", async () => {
  startPosed(h);
  h.debug.setWaveEntry(true);
  await startStage(h, STAGE);

  const built = h.snapshot();
  assertGreaterThanOrEqual(
    built.drones.length,
    MIN_DRONES,
    `the drones the stage-${STAGE} wave was built with as the intro gave way ` +
      "(specs/swarm.md, specs/stages.md)",
  );

  // The block, as its entrance leaves it, with every Flux's clock held.
  settleWave(h);
  const fluxes = dronesOfKind(built, "flux").map((drone) => drone.id);
  for (const id of fluxes) h.debug.setDroneOscillation(id, false);

  for (const [index, beat] of BEATS.entries()) {
    for (const id of fluxes) h.debug.setDroneBandClock(id, beat.bandClock);
    await h.advance(1);
    const read = h.snapshot();
    if (index === 0) captureStill(h, "bands");

    const assembled = dronesInPhase(read, "formation");
    assertGreaterThanOrEqual(
      assembled.length,
      MIN_DRONES,
      `the drones standing in the formation with every Flux ${beat.fluxes} ` +
        "(specs/swarm.md)",
    );

    const held = assembled.map((drone) => drone.effectiveBand);
    for (const band of BANDS) {
      assertContains(
        held,
        band,
        `the effective bands the ${assembled.length} drones of the assembled ` +
          `formation read as with every Flux ${beat.fluxes} ` +
          "(specs/swarm.md, specs/drones.md, specs/bands.md)",
      );
    }
  }
});
