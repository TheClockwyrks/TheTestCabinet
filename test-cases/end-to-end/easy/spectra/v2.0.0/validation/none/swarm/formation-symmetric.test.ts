// swarm/formation-symmetric — the filled layout mirrors about FORM_CENTER_X.
//
// specs/swarm.md, "The formation": "The filled layout is mirror-symmetric about
// `FORM_CENTER_X`: for every filled slot at `x`, the slot at
// `2 * FORM_CENTER_X - x` is filled too."
//
// So the reading is over the SLOTS the assembled drones report, not over where
// they happen to be standing: the block rides a sway that carries every slotted
// drone by the same offset (`specs/field.md`), so the drawn positions are the
// mirror image shifted, while the slots themselves are what the rule is about.
// Which KINDS fill the mirrored pair is not asserted — the specification requires
// the layout to be symmetric, not the composition — so a wave with a Flux on one
// side and a Shard on its mirror passes, as it should.
//
// One unit of tolerance, which is the item's own figure: the slots are exact
// multiples of `SLOT_DX` off the centre and a build reporting them has no
// arithmetic to lose.
//
// THE WAVE IS THE GAME'S OWN, AND ITS ASSEMBLY IS POSED. `startStage` has the
// build's own stage-intro code build the stage-1 wave, so which slots are filled
// is the build's and nothing about it is posed; `settleWave` then stands every
// drone at its own slot in phase `formation`, which is the state its entrance
// ends in, rather than flying the twelve seconds `swarm/assembles` grades. The
// dive gate stays shut, so the layout read is the one the wave laid out rather
// than one a dive has taken a drone out of — a launched dive would leave a slot
// unmirrored through no fault of the layout.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  captureStill,
  createHarness,
  dronesInPhase,
  settleWave,
  startPosed,
  startStage,
  type Harness,
} from "../harness";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/** How near the mirrored x a slot must be filled: the item's own one unit. */
const MIRROR_TOLERANCE = 1;

/** The drones the assembled block must hold for the reading to mean anything. */
const MIN_DRONES = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("fills a slot at the mirror of every slot it fills", async () => {
  await startPosed(harness);
  await harness.debug.setWaveEntry(true);
  await startStage(harness, STAGE);
  await settleWave(harness);

  await harness.advance(1);
  const settled = await harness.snapshot();
  await captureStill(harness, "mirror");

  const assembled = dronesInPhase(settled, "formation");
  assertGreaterThanOrEqual(
    assembled.length,
    MIN_DRONES,
    `the drones standing in the formation the stage-${STAGE} wave laid out ` +
      `(specs/swarm.md)`,
  );

  const filled = assembled.map((drone) => drone.slotX);
  for (const drone of assembled) {
    const mirror = 2 * FORM_CENTER_X - drone.slotX;
    assertTrue(
      filled.some((x) => Math.abs(x - mirror) <= MIRROR_TOLERANCE),
      `a filled slot within ${MIRROR_TOLERANCE} unit of x ${mirror}, the ` +
        `mirror about FORM_CENTER_X (${FORM_CENTER_X}) of the slot drone ` +
        `${drone.id} fills at x ${drone.slotX} — the layout filled ` +
        `[${[...new Set(filled)].sort((a, b) => a - b).join(", ")}] ` +
        `(specs/swarm.md)`,
    );
  }
});
