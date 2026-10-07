// drilling/grounded-only — a miner off the ground starts no cut.
//
// specs/character.md: a cut starts only while the miner rests on a solid cell. A
// falling, thrusting, or hovering miner starts no cut whichever direction is
// held. So a plunge down a shaft never side-drills the walls it passes, however
// hard the player is steering into them.
//
// The scene is a one-tile shaft twenty rows deep with rock walls either side.
// The miner is posed in the air at the top with the side-drill direction held,
// which both keeps it flush against a wall — `specs/character.md` has lateral
// input drift the miner in the air as well as on the ground — and aims the drill
// at that wall. Thrust is then added on top, so both airborne states the
// specification names are exercised against the same wall.
//
// The spans are chosen so the miner never reaches the floor: a second of falling
// covers about eight tiles against the twenty the shaft holds, and the half
// second of thrust that follows only slows the descent. So every reading below
// is taken off a miner that has been airborne throughout.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, MINER_W, TILE, WALK_SPEED } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  digShaft,
  minerXOn,
  minerYOn,
  openScene,
  placeAt,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The shaft: a column, and the rows it is open through. */
const COL = 8;
const TOP_ROW = 6;
const BOTTOM_ROW = 25;

/** The wall the drill is aimed at. */
const WALL_COL = COL + 1;

/** How long the miner falls, and then thrusts, with the direction held. */
const FALL_FRAMES = TICK_HZ;
const THRUST_FRAMES = TICK_HZ / 2;

/**
 * How far the box may sit from the wall's face, in world units.
 *
 * Either side of the face. A build that advances, tests, and keeps the last
 * position clear of the wall comes to rest up to a whole frame of lateral drift
 * short of it, and one whose contact epsilon lets the box settle a little way in
 * comes to rest a little past it; `specs/character.md` fixes neither.
 * `specs/instrumentation.md` integrates every rate against the frame's delta, so
 * that frame is `WALK_SPEED / TICK_HZ`, and the band is the whole unit above it.
 * Either way the drill is aimed at the wall, which is all this reading is for;
 * whether the box may overlap a solid cell at all is `specs/character.md`'s
 * collision rule, read by the points whose subject is contact.
 */
const FLUSH = Math.ceil(WALK_SPEED / TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("cuts no wall while falling or thrusting past it", async () => {
  openScene(h);
  digShaft(h, COL, TOP_ROW, BOTTOM_ROW);
  placeAt(h, minerXOn(COL), minerYOn(TOP_ROW + 1));

  const airborne = await captureReplay(h, "airborne", async () => {
    h.hold(ACTION_KEY.right);
    try {
      await h.advance(FALL_FRAMES);
      const falling = h.snapshot();
      h.hold(ACTION_KEY.up);
      await h.advance(THRUST_FRAMES);
      return { falling, thrusting: h.snapshot() };
    } finally {
      h.releaseAll();
    }
  });

  // Airborne the whole way, and pressed against the wall the drill is aimed at.
  assertEqual(airborne.falling.miner.grounded, false, "specs/character.md");
  assertEqual(airborne.thrusting.miner.grounded, false, "specs/character.md");
  assertBetween(
    airborne.thrusting.miner.x + MINER_W,
    WALL_COL * TILE - FLUSH,
    WALL_COL * TILE + FLUSH,
    "specs/character.md",
  );
  assertEqual(airborne.thrusting.miner.drilling, null, "specs/character.md");

  // And every cell it passed is whole.
  for (let row = TOP_ROW; row <= BOTTOM_ROW; row += 1) {
    const tile = h.tileAt(WALL_COL, row);
    assertEqual(tile.kind, "rock", "specs/character.md");
    assertEqual(tile.health, BAND_HEALTH.topsoil, "specs/character.md");
  }
});
