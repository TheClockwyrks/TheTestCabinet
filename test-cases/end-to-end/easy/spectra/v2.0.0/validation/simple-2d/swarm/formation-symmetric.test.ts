// swarm/formation-symmetric — the filled layout mirrors about FORM_CENTER_X.
//
// specs/swarm.md, "The formation": "The filled layout is mirror-symmetric about
// `FORM_CENTER_X`: for every filled slot at `x`, the slot at
// `2 * FORM_CENTER_X - x` is filled too."
//
// So the reading is over the SLOTS the assembled drones report, not over where they
// happen to be standing: the block rides a sway that carries every slotted drone by
// the same offset (`specs/field.md`), so the drawn positions are the mirror image
// shifted, while the slots themselves are what the rule is about. Which KINDS fill
// the mirrored pair is not asserted — the specification requires the layout to be
// symmetric, not the composition — so a wave with a Flux on one side and a Shard on
// its mirror passes, as it should.
//
// One unit of tolerance, which is the item's own figure: the slots are exact
// multiples of `SLOT_DX` off the centre and a build reporting them has no
// arithmetic to lose.
//
// The wave is the game's own and is given the twelve seconds `swarm/assembles`
// allows it. The dive gate is shut, so the layout read is the one the wave laid out
// rather than one a dive has taken a drone out of — a launched dive would leave a
// slot unmirrored through no fault of the layout — and the contact gate is shut so
// nothing reaching the ship interrupts the wave.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X } from "../../src/constants";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  type Harness,
} from "../harness";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/** The seconds the wave is given to assemble, as `swarm/assembles` allows. */
const ASSEMBLE_BY = 12;

/** How near the mirrored x a slot must be filled: the item's own one unit. */
const MIRROR_TOLERANCE = 1;

/** The drones the assembled block must hold for the reading to mean anything. */
const MIN_DRONES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills a slot at the mirror of every slot it fills", async () => {
  h.debug.setDiveLaunching(false);
  h.debug.setShipContact(false);
  await startStage(h, STAGE);

  await h.advanceSeconds(ASSEMBLE_BY);
  const settled = h.snapshot();
  captureStill(h, "mirror");

  const assembled = settled.drones.filter(
    (drone) => drone.phase === "formation",
  );
  assertGreaterThanOrEqual(
    assembled.length,
    MIN_DRONES,
    `the drones standing in the formation ${String(ASSEMBLE_BY)}s after the ` +
      `wave opened (specs/swarm.md)`,
  );

  const filled = assembled.map((drone) => drone.slotX);
  for (const drone of assembled) {
    const mirror = 2 * FORM_CENTER_X - drone.slotX;
    assertTrue(
      filled.some((x) => Math.abs(x - mirror) <= MIRROR_TOLERANCE),
      `a filled slot within ${String(MIRROR_TOLERANCE)} unit of x ` +
        `${String(mirror)}, the mirror about FORM_CENTER_X ` +
        `(${String(FORM_CENTER_X)}) of the slot drone ${String(drone.id)} ` +
        `fills at x ${String(drone.slotX)} — the layout filled ` +
        `[${[...new Set(filled)].sort((a, b) => a - b).join(", ")}] ` +
        `(specs/swarm.md)`,
    );
  }
});
