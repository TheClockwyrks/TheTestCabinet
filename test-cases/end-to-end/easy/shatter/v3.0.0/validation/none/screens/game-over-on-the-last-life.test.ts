// Shatter — screens/game-over-on-the-last-life: losing the last ship puts up the
// game-over screen.
//
// THE RULE. `specs/ui.md` says `gameover` is "shown on the tick the last ship is lost",
// and `specs/progression.md` says when that is: "When the last ship is lost the life
// count reaches `0`, no new ship appears, and the game is over." `specs/collision.md`
// says what loses one: "The ship and a rock — the ship is destroyed and a life is
// lost."
//
// THE SHIP IS REALLY DESTROYED. Nothing here poses the screen: `setScreen("gameover")`
// would answer the question for the build. What is posed is the SITUATION — one ship
// left, the contact test running, and a rock on its way in — and the game's own
// collision, its own life accounting and its own screen rule produce the result.
//
// THE CONTACT GATE IS OPENED, BECAUSE THIS IS ONE OF THE ITEMS IT EXISTS FOR.
// `startPlaying` shuts `setShipCollision` so that a rock posed near the ship in some
// other scenario cannot cost a life mid-check; here the lethal contact IS the
// requirement, so it is turned back on — and only it. Both world gates stay shut, so no
// wave arrives and no saucer wanders in to take the ship first, and the field holds
// exactly the one rock this item is about.
//
// THE READING IS TAKEN OFF THE TICK THE SHIP WAS LOST. The sweep runs tick by tick and
// stops the moment `lives` reaches `0`, which is `specs/progression.md`'s own statement
// of the last ship being lost; the screen is then read ONE TICK LATER, which is what
// "the tick the last ship is lost" allows either way — a build that raises the screen
// within the destroying tick still reads `gameover` a tick after, and a build that
// raises it on the tick after reads it there too. A build that leaves the game running
// reads `playing` and fails.
//
// THE ROCK IS A SMALL, POSED ON THE SHIP'S ROW `80` UNITS OUT AND DRIFTING IN AT `200`
// UNITS PER SECOND — a legal Small drift speed (`specs/rocks.md`). Its whole approach is
// a quarter of a second, over which `specs/gravity.md` bends it about three units off
// the row, against the `28` units of contact radius the two circles have; so the contact
// is the rock arriving rather than the well steering it.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the counter reaches `0` (`lives/game-over-at-
// zero`), that no ship is put back up (`lives/respawn-only-with-lives-left`), or what
// the game-over screen then shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ROCK_RADIUS, SAFE_X, SAFE_Y, SHIP_R } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { SETTLE_TICKS } from "./screens";

/** The ships left when the fatal contact lands: the one being flown, and no more. */
const LAST_LIFE = 1;

/** How far out along the ship's row the Small is posed. */
const APPROACH_GAP = 80;
/** The speed it comes in at: inside the Small drift range specs/rocks.md fixes. */
const APPROACH_SPEED = 200;

/**
 * How long the approach is followed for.
 *
 * The gap the two circles have to close is `APPROACH_GAP` less their radii, `52`
 * units, which the posed drift covers in `0.26` s. A second is four times that, so a
 * build whose contact is a little late is still caught, and a build that never
 * destroys the ship fails on the sweep rather than on a timeout.
 */
const APPROACH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the game-over screen the tick after the last ship is destroyed", async () => {
  await startPlaying(h);
  await h.debug.setLives(LAST_LIFE);
  await h.debug.setShipCollision(true);

  const posed = await h.snapshot();
  assertEqual(posed.lives, LAST_LIFE, "the ships left when the rock comes in");
  assertEqual(
    posed.ship.collision,
    true,
    "the ship's lethal contact test running",
  );
  assertEqual(posed.screen, "playing", "the screen the approach starts on");

  await poseRock(h, "small", SAFE_X + APPROACH_GAP, SAFE_Y, -APPROACH_SPEED, 0);
  assertEqual(
    APPROACH_GAP > SHIP_R + ROCK_RADIUS.small,
    true,
    "the Small is posed clear of the ship, so the contact is its arrival",
  );

  const lost = await h.until((snapshot) => snapshot.lives === 0, {
    maxTicks: APPROACH_TICKS,
    poll: 1,
  });
  assertEqual(lost.hit, true, "the last ship was destroyed by the rock it met");

  await h.advance(SETTLE_TICKS);
  await captureStill(h, "gameover");

  assertEqual(
    (await h.snapshot()).screen,
    "gameover",
    "the screen the last ship's destruction put up (specs/ui.md)",
  );
});
