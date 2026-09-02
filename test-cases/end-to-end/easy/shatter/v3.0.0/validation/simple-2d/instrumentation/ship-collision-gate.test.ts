// instrumentation/ship-collision-gate — `setShipCollision(false)` shuts the ship's
// lethal contact test, so a rock that reaches the ship costs nothing; with the gate
// on, the same rock costs a life.
//
// WHY THIS GATE IS THE MOST LOAD-BEARING ONE IN THE SURFACE. The ship is the one
// entity no scenario can take off the field: every roster has a clear and the
// saucer has a removal, and the ship has neither. So `startPlaying` shuts this gate
// instead, and almost every scenario in this project runs behind it — a rock posed
// for a gravity reading, a bullet flown across the field, a wave shot down. If the
// gate does nothing, all of those quietly become scenarios in which the ship can
// die, and the checks that read a life count read one the scenario did not arrange.
// This is the item that names that fault once, by itself.
//
// THE TWO LEGS ARE THE SAME SCENARIO, TWICE. Identical pose, identical rock,
// identical flight; the only difference between them is the gate. So a build that
// reads as passing on one leg and failing the other has been told apart by the
// gate and by nothing else, and the three wrong models each read differently: a
// gate that does nothing fails the OFF leg, a gate that is inverted fails both, and
// a build with no lethal contact at all fails the ON leg.
//
// AND THE CONTACT IS PROVED, NOT ASSUMED. The wrong way to write the OFF leg is to
// fly a rock somewhere near the ship and read that no life was lost, which a rock
// that missed passes just as well. So both legs sweep the separation tick by tick
// and require it to have closed to inside the sum of the two collision radii
// `specs/collision.md` fixes — the rock really reached the ship — before any life
// count is read.
//
// THE ROCK IS A SMALL, POSED CLOSE, AND FIRED ACROSS THE SHIP'S ROW. A Small
// because it is the least of the three and the point is contact rather than mass;
// close because the well bends anything left in it for long (the flight here is a
// third of a second, over which the star moves the rock some five units — far
// inside the 28 units of contact); and across `SAFE_Y`, which is 200 units below
// the star, so nothing on the rock's path comes near the core and no recycling can
// take the rock off the field before it arrives.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SAFE_X, SAFE_Y, SHIP_R, START_LIVES } from "../constants";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { distance } from "../geometry";

/** Where the rock starts: 120 units to the ship's left, on the ship's own row. */
const ROCK_START = { x: SAFE_X - 120, y: SAFE_Y } as const;

/** How fast it crosses, in units per second: a third of a second to contact. */
const ROCK_SPEED = 240;

/**
 * The separation, in logical units, at which `specs/collision.md` has the two
 * bodies touching: the sum of the ship's radius and a Small rock's.
 */
const CONTACT = SHIP_R + ROCK_RADIUS.small;

/** How long the rock is given to cross, in ticks: twice the flight it needs. */
const CROSSING_FRAMES = ticksFor(1);

let h: Harness;

/** What one crossing did: how near the rock came, and what the run reported. */
interface Crossing {
  closest: number;
  lives: number;
  screen: string;
}

/**
 * Pose the ship at rest at its safe point with a Small rock bearing down on it,
 * fly the crossing out, and answer how near the rock came and what it cost.
 *
 * `capture` is the still this leg leaves, written on the first tick the two are
 * touching, so the picture is the rock sitting over the ship rather than the
 * empty field it left behind.
 */
async function crossing(gate: boolean, capture?: string): Promise<Crossing> {
  startPlaying(h);
  h.debug.setShipCollision(gate);
  h.debug.setShipPosition(SAFE_X, SAFE_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipInvuln(0);
  const id = poseRock(h, "small", ROCK_START.x, ROCK_START.y, ROCK_SPEED, 0);

  let closest = Number.POSITIVE_INFINITY;
  let captured = false;
  for (let tick = 0; tick < CROSSING_FRAMES; tick += 1) {
    await h.advance(1);
    const now = h.snapshot();
    const rock = now.rocks.find((r) => r.id === id);
    if (rock !== undefined) {
      closest = Math.min(closest, distance(rock, now.ship));
    }
    if (!captured && capture !== undefined && closest <= CONTACT) {
      captureStill(h, capture);
      captured = true;
    }
  }

  const end = h.snapshot();
  return { closest, lives: end.lives, screen: end.screen };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life with contact off, and one life with contact on", async () => {
  // The gate shut. The rock reaches the ship and passes straight through it.
  const off = await crossing(false, "overlap");
  assertLessThanOrEqual(
    off.closest,
    CONTACT,
    "the rock reached the ship: the shortest separation of the crossing, " +
      "against SHIP_R + ROCK_RADIUS.small (specs/collision.md)",
  );
  assertEqual(
    off.lives,
    START_LIVES,
    "the ships left after a rock crossed the ship with setShipCollision(false)",
  );
  assertEqual(
    off.screen,
    "playing",
    "the screen after a rock crossed the ship with setShipCollision(false)",
  );

  // The same scenario with the gate open. Nothing else about it changed.
  const on = await crossing(true);
  assertLessThanOrEqual(
    on.closest,
    CONTACT,
    "the rock reached the ship on the second leg too",
  );
  assertEqual(
    on.lives,
    START_LIVES - 1,
    "the ships left after the same rock crossed with setShipCollision(true) " +
      "(specs/progression.md: a rock destroys the ship and costs one life)",
  );
  assertTrue(
    on.screen === "playing",
    "the run carried on: two ships remain, so the game is not over " +
      "(specs/progression.md)",
  );
});
