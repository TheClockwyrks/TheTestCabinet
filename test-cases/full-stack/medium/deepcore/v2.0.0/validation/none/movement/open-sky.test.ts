// movement/open-sky — the sky above the camp is unbounded.
//
// `specs/character.md`: "No ceiling. The sky above the camp is unbounded. The
// miner may thrust straight up out of the mine and keep climbing while it has
// fuel, and it falls back when thrust is released." `specs/world.md` says the
// same from the world's side — "there is no ceiling above it", and the camera
// "has no upper clamp and follows the miner up into the open sky".
//
// A build that put an invisible lid a screen above the camp has a prospector that
// stops dead in mid-air for no reason a player can see, which is why this reads
// well past the height a viewport covers: the climb runs three seconds, which at
// the tier's stated acceleration and climb cap is over two thousand units, and the
// bound it is held to is ten tiles above the ground line. A lid anywhere in that
// range fails.
//
// AND IT FALLS BACK. The second half of the sentence is the half that separates a
// climb from a teleport: the key comes up, and gravity brings the miner down
// again. That is read as the velocity turning downward and the miner losing
// height, not as a return to the ground, which would take as long again.
//
// The camp's ground is laid as generation leaves it so the miner starts from
// solid footing, the bay is empty, and the drill is gated.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { SURFACE_Y, TILE } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layCamp,
  minerFeet,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

/** The climb, and the frames the three seconds of it are run in. */
const CLIMB_SECONDS = 3;
const CLIMB_FRAMES = 180;

/**
 * The fall back, once the key is up.
 *
 * Long enough for gravity to turn the climb around: the miner is rising at its
 * climb cap when the key comes up, and `GRAVITY` needs the better part of a
 * second to spend that speed before it starts losing height again.
 */
const FALL_SECONDS = 1.5;
const FALL_FRAMES = 90;

/** How far above the ground line the climb has to reach, in world units. */
const CLEARANCE = 10 * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("climbs far above the camp and falls back when thrust is released", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinDrill(h);
  await h.advance(2);
  assertEqual(
    (await h.snapshot()).miner.grounded,
    true,
    "the miner standing on the camp ground before the climb",
  );

  const flight = await captureReplay(h, "sky", async () => {
    await h.hold(ACTION_KEY.up);
    await h.advanceSeconds(CLIMB_SECONDS, CLIMB_FRAMES);
    const top = await h.snapshot();
    await h.release(ACTION_KEY.up);
    await h.advanceSeconds(FALL_SECONDS, FALL_FRAMES);
    return { top, after: await h.snapshot() };
  });

  // Well above the ground line, with nothing having stopped the climb.
  assertLessThan(
    minerFeet(flight.top.miner),
    SURFACE_Y - CLEARANCE,
    "the height the climb reached, as the miner's feet in world units",
  );
  assertLessThan(
    flight.top.miner.vy,
    0,
    "the miner still rising when the key came up",
  );
  assertGreaterThan(
    flight.top.miner.fuel,
    0,
    "fuel left at the top of the climb",
  );

  // And with the key up it comes back down.
  assertGreaterThan(
    flight.after.miner.vy,
    0,
    "the miner falling once thrust was released",
  );
  assertGreaterThan(
    minerFeet(flight.after.miner),
    minerFeet(flight.top.miner),
    "the height lost after thrust was released",
  );
});
