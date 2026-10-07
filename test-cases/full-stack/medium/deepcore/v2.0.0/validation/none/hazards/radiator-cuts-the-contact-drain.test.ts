// hazards/radiator-cuts-the-contact-drain — the radiator thins the bleed.
//
// `specs/upgrades.md` gives the radiator one job and states its five
// effectivenesses, and `specs/hazards.md` says where the first of them lands:
// "The radiator tier's effectiveness reduces both the contact drain and the lump
// by that fraction." So the same posed contact span is repeated at every tier
// and each hull loss is held against `LAVA_CONTACT_DPS * (1 - effectiveness)`
// times the span, which is 17.6 a second at tier 3 and 6.4 at tier 5.
//
// Every tier rather than the two the description names, because each is its own
// figure in the table and a build that reduced by the wrong fraction at one tier
// would otherwise pass. The pose is `hazards/lava-contact-drain`'s, unchanged:
// the box inside one lava cell, both faculties gated, a fixed span of game time.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { LAVA_CONTACT_DPS, RADIATOR_EFFECTIVENESS } from "../constants";
import {
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { armHull, bandRow, HAZARD_COL, soakIn } from "./scene";

/** The tier whose hull outlasts the bare span with room to read the loss. */
const HULL_TIER = 5;

/** The contact span, and the frames it is run in. */
const SECONDS = 3;
const FRAMES = 90;

/** How far a reading may sit from its rate: a couple of frames of drain. */
const TOLERANCE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drains the rate less the tier's effectiveness at every tier", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  const row = bandRow(await h.snapshot(), "deepstone");
  await h.debug.setTile(HAZARD_COL, row, "lava");
  await soakIn(h, HAZARD_COL, row);

  const losses = await captureReplay(h, "shielded", async () => {
    const seen: number[] = [];
    for (let tier = 1; tier <= RADIATOR_EFFECTIVENESS.length; tier += 1) {
      await h.debug.setTier("radiator", tier);
      const full = await armHull(h, HULL_TIER);
      await h.advanceSeconds(SECONDS, FRAMES);
      seen.push(full - (await h.snapshot()).miner.hull);
    }
    return seen;
  });

  for (let tier = 1; tier <= RADIATOR_EFFECTIVENESS.length; tier += 1) {
    const expected =
      LAVA_CONTACT_DPS * (1 - RADIATOR_EFFECTIVENESS[tier - 1]) * SECONDS;
    assertBetween(
      losses[tier - 1],
      expected - TOLERANCE,
      expected + TOLERANCE,
      `specs/hazards.md, ${SECONDS} seconds at radiator tier ${tier}`,
    );
  }
});
