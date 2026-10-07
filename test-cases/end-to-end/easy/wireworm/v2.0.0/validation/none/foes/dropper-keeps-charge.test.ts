// foes/dropper-keeps-charge — a dropper leaves an occupied tile exactly as it
// found it.
//
// `specs/foes.md`: "A tile that already holds a node is left exactly as it is,
// at the charge it had, and no node is laid in row 0 or in the player band."
//
// THE POSED CHARGE IS THE DISTINGUISHING VALUE. At `2`, every wrong model reads
// as a different number: a build that lays a fresh node over the standing one
// reads `0`, one that bumps the charge by a level reads `3`, one that slams it
// reads `3` too but on its first act rather than after two, one that eats it
// leaves the tile empty, and only a build that left the tile alone still reads
// `2`. A node posed inert or critical would have collapsed several of those onto
// one answer.
//
// The reading is the FIRST change to the tile — the same reading
// foes/dropper-lays-node takes, over the same span — so a build that disturbs
// the node for a frame and puts it back is caught rather than read past.
//
// The dropper is posed with its locomotion held, so it acts on exactly the tile
// the node stands on (`specs/foes.md` fixes the effect as the occupancy of the
// tile a foe's center is on).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { untilTileChanges } from "./watching";

/** The tile the dropper stands on: occupied, and inside the rows it lays in. */
const TILE_C = 10;
const TILE_R = 8;

/** The charge the standing node is posed at, and the charge it must keep. */
const STANDING_CHARGE = 2;

/**
 * How long the dropper is left standing on it, in seconds: the same quarter
 * second foes/dropper-lays-node gives it to lay on an empty tile, so the two
 * readings are taken over the same span of play.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the charge of the node the dropper stands on untouched", async () => {
  await startPlaying(h);
  await h.debug.setNode(TILE_C, TILE_R, STANDING_CHARGE);
  await poseFoe(h, "dropper", TILE_C, TILE_R, { travel: false });

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    framesFor(ACT_SECONDS),
  );

  await captureStill(h, "kept");
  assertEqual(
    change.now,
    STANDING_CHARGE,
    `the node already standing on (${TILE_C}, ${TILE_R}) keeps the charge ` +
      `${STANDING_CHARGE} it had while the dropper stands on it`,
  );
});
