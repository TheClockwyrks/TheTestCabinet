// screens/game-over-on-the-last-life — losing the last ship puts the game-over
// screen up.
//
// THE RULE. `specs/ui.md` on `gameover`: "shown on the tick the last ship is
// lost". `specs/progression.md` fixes what losing the last ship is — a lethal
// contact with `lives` at one — and `specs/collision.md` fixes that a rock
// reaching the ship is one of the three contacts that destroy it. So a real rock
// closes on a ship down to its last life, and the screen the build puts up is read.
//
// THE DEATH IS A REAL ONE. There is no operation that destroys the ship, and this
// does not pretend to be one: the ship is placed at rest with its LETHAL CONTACT
// TEST turned back on — the one gate this item turns on, because the contact is
// what its requirement is made of — its respawn grace cleared, and a Small is posed
// `APPROACH_GAP` units above it closing at `ROCK_DRIFT`. The pair starts
// `APPROACH_GAP - SHIP_TOUCHES_SMALL` units apart and the build's own collision
// pass is what resolves it.
//
// WHERE, AND WHY THERE. Down in the field's bottom left, `511` units from the star
// at `(640, 360)`, where the well pulls at some `17` units per second squared
// (`specs/gravity.md`) — a fifth of a unit over the third of a second the approach
// takes, against contact circles tens of units across, so the environment decides
// nothing here. Every edge is further than the pair's radii away, so nothing wraps.
//
// THE READING IS TAKEN A TICK LATE ON PURPOSE. `specs/ui.md` puts the screen up on
// the tick the ship is lost, and a build that plays a beat of destruction before
// switching is answering the same rule; the sweep runs until the screen changes and
// one further tick is allowed after it, so both readings pass and a build that
// leaves the player on a field with no ships fails.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the life count reaches zero, which is
// `lives/game-over-at-zero`; that no new ship is put up, which is
// `lives/respawn-only-with-lives-left`; and what the game-over screen SHOWS, which
// is `screens/game-over-shows-the-score` and `screens/game-over-shows-the-wave`.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SHIP_R } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The last ship: the count `specs/progression.md` makes a loss final at. */
const LAST_LIFE = 1;

/** Where the contact is arranged, in logical units: quiet, far from the well. */
const DEATH_SPOT = { x: 200, y: 620 };

/** The separation at which the ship and a Small touch (`specs/collision.md`). */
const SHIP_TOUCHES_SMALL = SHIP_R + ROCK_RADIUS.small;

/**
 * How far above the ship the closing rock is posed, centre to centre.
 *
 * Seventy-two units of approach past the `28` at which the pair touches: long
 * enough that the contact is a real closing rather than an overlap the pose made,
 * short enough that the well has moved the rock a fraction of a unit by then.
 */
const APPROACH_GAP = 100;

/**
 * The speed the rock closes at, in units per second. Inside the `130` to `210` a
 * Small's own drift runs at (`specs/rocks.md`), so it moves no faster than the
 * game itself sets one moving.
 */
const ROCK_DRIFT = 200;

/**
 * How long the contact is watched for, in ticks.
 *
 * The approach itself is `(APPROACH_GAP - SHIP_TOUCHES_SMALL) / ROCK_DRIFT`, a
 * third of a second, so a whole second is three times over: a build whose swept
 * contact resolves a tick or two late still reaches its verdict, and a build that
 * never resolves it fails with the scenario named rather than hanging the suite.
 */
const WATCH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the game-over screen when the last ship is destroyed", async () => {
  startPlaying(h);
  h.debug.setLives(LAST_LIFE);
  h.debug.setShipPosition(DEATH_SPOT.x, DEATH_SPOT.y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipInvuln(0);
  h.debug.setShipCollision(true);
  poseRock(
    h,
    "small",
    DEATH_SPOT.x,
    DEATH_SPOT.y - APPROACH_GAP,
    0,
    ROCK_DRIFT,
  );

  const posed = h.snapshot();
  assertEqual(
    posed.screen,
    "playing",
    "the screen the last ship was flying on",
  );
  assertEqual(posed.lives, LAST_LIFE, "the ships the run was down to");

  const found = await h.until((snapshot) => snapshot.screen === "gameover", {
    maxFrames: WATCH_TICKS,
    poll: 1,
  });

  // One further tick, so a build that plays a beat of destruction before it
  // switches screens is read the same as one that switches on the tick itself.
  if (!found.hit) await h.advance(1);
  captureStill(h, "gameover");

  const now = h.snapshot();
  assertEqual(
    now.screen,
    "gameover",
    `the screen the tick after the last ship is lost, with a Small closing ` +
      `the ${APPROACH_GAP - SHIP_TOUCHES_SMALL} units from ${APPROACH_GAP} ` +
      `down to the ${SHIP_TOUCHES_SMALL} at which the pair touches, at ` +
      `${ROCK_DRIFT} units per second, watched for ` +
      `${secondsFor(WATCH_TICKS).toFixed(1)} s with the ship's contact gate ` +
      `open and its grace clear (specs/ui.md, specs/collision.md)`,
  );
});
