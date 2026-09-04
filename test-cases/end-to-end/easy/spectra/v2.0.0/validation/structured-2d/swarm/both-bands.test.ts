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
// The wave is the game's own and is given the twelve seconds `swarm/assembles`
// allows it, since the rule is about the assembled block. The reading is taken
// over the drones in phase `formation`, so a straggler still flying its entrance
// neither counts toward the pair nor against it.
//
// The dive gate is shut, so the block that is read is the one the wave laid out
// rather than one a dive has already taken a drone out of; the contact gate is
// shut so nothing reaching the ship interrupts the wave. Nothing here destroys a
// drone, so no band can leave the block during the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertGreaterThanOrEqual } from "../assert";
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

/** The drones the assembled block must hold for the reading to mean anything. */
const MIN_DRONES = 1;

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

  await h.advanceSeconds(ASSEMBLE_BY);
  const settled = h.snapshot();
  captureStill(h, "bands");

  const assembled = dronesInPhase(settled, "formation");
  assertGreaterThanOrEqual(
    assembled.length,
    MIN_DRONES,
    `the drones standing in the formation ${ASSEMBLE_BY}s after the wave ` +
      `opened (specs/swarm.md)`,
  );

  const held = assembled.map((drone) => drone.effectiveBand);
  for (const band of BANDS) {
    assertContains(
      held,
      band,
      `the effective bands the ${assembled.length} drones of the assembled ` +
        `formation read as (specs/swarm.md, specs/bands.md)`,
    );
  }
});
