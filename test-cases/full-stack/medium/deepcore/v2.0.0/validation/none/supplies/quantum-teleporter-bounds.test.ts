// Deepcore — supplies/quantum-teleporter-bounds: the drop is carried down by the
// ordinary physics and lands under the fall-impact rule.
//
// `specs/items.md`: the Quantum Teleporter "places the miner above the camp
// ground with its feet at a height drawn uniformly from `1` to `8` tiles above
// the ground line, with a downward speed drawn uniformly from `150` to `700`
// units per second, then lets the normal physics carry it down. The ordinary
// fall-impact rule applies to the landing, so a bad draw can kill a low-hull
// miner."
//
// THE DRAW IS POSED, NOT SAMPLED. Both draws are posed at the top of their
// ranges through `setNextTeleportHeight` and `setNextTeleportSpeed`, the
// operations `specs/instrumentation.md` carries for exactly this, so the drop
// this check watches is the hardest one the item can deal: eight tiles of fall
// on top of the fastest start. The placement is read on the call itself, before
// any frame runs, so what is measured is where the item put the miner rather
// than where gravity had taken it by the time it was looked at; the height is
// the miner's feet above `SURFACE_Y`, the world `y` `specs/world.md` gives the
// camp's ground line.
//
// THEN THE PHYSICS RUNS. The fall is swept a frame at a time to the ground, the
// fastest downward speed seen is the speed the landing resolved at, and the hull
// it cost is held against `specs/hazards.md`'s rule at that speed, exactly as
// `hazards/impact-damage` holds a posed landing. A build that sets the miner
// down without the fall, or lands it for free, misses one of the readings.
//
// The tolerance on the hull is three points, a little over two frames of
// `GRAVITY` carried through `IMPACT_DAMAGE_RATE`: the sweep samples once a
// frame, so the speed it saw and the speed the build billed can differ by the
// travel of one frame either way.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  impactDamageAt,
  IMPACT_SAFE_SPEED,
  MINER_H,
  QUANTUM_DROP_MAX_TILES,
  QUANTUM_VEL_MAX,
  SURFACE_Y,
  TILE,
} from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** The drop posed: the top of both ranges `specs/items.md` states. */
const POSED_TILES = QUANTUM_DROP_MAX_TILES;
const POSED_SPEED = QUANTUM_VEL_MAX;

/** The floor the miner is teleported away from, well underground. */
const DEEP_COL = 10;
const DEEP_FLOOR_ROW = 30;

/** Decimal places the placement is held to. */
const PLACES = 3;

/** How far the hull reading may sit from the rule, in hull points. */
const HULL_TOLERANCE = 3;

/** A world unit of slack on the ground line the landing comes to rest on. */
const GROUND_EPSILON = 1;

/** Frames the drop is let fall for: eight tiles at this speed lands well inside. */
const FALL_FRAMES = 300;

/** Frames the landed miner is held on screen, so the recording shows the rest. */
const AFTER = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the miner over the camp and lands it under the fall-impact rule", async () => {
  await openScene(h);
  // The camp's whole width is solid, so a drop anywhere along it lands, and a
  // floor underground is what the miner is teleported away from.
  await layFloor(h, 1);
  await layFloor(h, DEEP_FLOOR_ROW);
  await pinDrill(h);
  await h.debug.setItemCount("quantum-teleporter", 1);
  await standOn(h, DEEP_COL, DEEP_FLOOR_ROW);
  await h.debug.setNextTeleportHeight(POSED_TILES);
  await h.debug.setNextTeleportSpeed(POSED_SPEED);

  const drop = await captureReplay(h, "drop", async () => {
    await h.debug.useItem("quantum-teleporter");
    const placed = await h.snapshot();
    let fastest = 0;
    const swept = await h.until(
      (s) => {
        if (s.miner.vy > fastest) fastest = s.miner.vy;
        return s.miner.grounded;
      },
      { maxFrames: FALL_FRAMES, poll: 1 },
    );
    // A build may report a miner about to touch down as grounded, so one more
    // frame is run before the hull the contact cost is read.
    if (swept.hit) await h.advance(1);
    const settled = await h.snapshot();
    await h.advance(AFTER);
    return { placed, landed: swept.hit, fastest, settled };
  });

  assertCloseTo(
    (SURFACE_Y - (drop.placed.miner.y + MINER_H)) / TILE,
    POSED_TILES,
    PLACES,
    "specs/items.md: tiles above the camp ground the miner was placed at",
  );
  assertCloseTo(
    drop.placed.miner.vy,
    POSED_SPEED,
    PLACES,
    "specs/items.md: the downward speed the miner was placed with",
  );
  assertEqual(drop.placed.miner.grounded, false, "placed in the air");

  assertEqual(drop.landed, true, "specs/items.md: the physics carried it down");
  assertBetween(
    drop.settled.miner.y + MINER_H,
    SURFACE_Y - GROUND_EPSILON,
    SURFACE_Y + GROUND_EPSILON,
    "specs/character.md: at rest on the camp ground line",
  );
  assertGreaterThan(
    drop.fastest,
    IMPACT_SAFE_SPEED,
    "specs/character.md: eight tiles of fall from the top speed arrives above the safe speed",
  );
  const expected = impactDamageAt(drop.fastest);
  assertBetween(
    drop.placed.miner.hull - drop.settled.miner.hull,
    expected - HULL_TOLERANCE,
    expected + HULL_TOLERANCE,
    `specs/hazards.md: the landing at ${drop.fastest.toFixed(0)} units per second cost the rule's hull`,
  );
});
