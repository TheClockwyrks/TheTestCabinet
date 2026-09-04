// foes/dropper-keeps-charge — a dropper leaves an occupied tile exactly as it
// found it.
//
// specs/foes.md: "A tile that already holds a node is left exactly as it is, at
// the charge it had."
//
// The node is posed at charge `2`, which is the value that tells every wrong
// answer apart by the number it leaves behind: a build that lays a fresh node
// over the standing one reads `0`, one that bumps the charge reads `3`, one that
// slams it reads `3`, one that removes it reads as an empty tile, and only a
// build that left it alone reads `2`.
//
// The dropper is posed with its locomotion held, so it acts on exactly the tile
// the node stands on (specs/foes.md fixes the effect as an occupancy of the tile
// its center is on).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";
import { clearForStill, poseStillFoe } from "./harness";

/** The tile the dropper stands on: occupied, and inside the scatter rows. */
const TILE_C = 10;
const TILE_R = 8;

/** The charge the standing node is posed at, and the charge it must keep. */
const STANDING_CHARGE = 2;

/**
 * How long the dropper is left standing before the field is read: the same
 * quarter second foes/dropper-lays-node gives it to lay on an empty tile, so
 * the two readings are taken over the same span of play.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the charge of the node the dropper stands on untouched", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setNode(TILE_C, TILE_R, STANDING_CHARGE);
  const id = poseStillFoe(h, "dropper", TILE_C, TILE_R);

  await h.advanceSeconds(ACT_SECONDS);
  const kept = chargeAt(h.snapshot(), TILE_C, TILE_R);
  await clearForStill(h, id);
  captureStill(h, "kept");

  assertEqual(
    kept,
    STANDING_CHARGE,
    `the node already standing on (${TILE_C}, ${TILE_R}) keeps the charge it ` +
      `had`,
  );
});
