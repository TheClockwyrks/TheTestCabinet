// lives/a-rock-costs-a-life — a rock that reaches the ship costs exactly one ship.
//
// THE RULE. `specs/collision.md` gives the pair "The ship and a rock" the
// resolution "The ship is destroyed and a life is lost", and
// `specs/progression.md` states that "losing a ship costs one life". Two figures
// are in that, and this item reads the second: not that something happened, but
// that the counter fell by EXACTLY ONE.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. From three ships, a correct build
// reads `2`; a build that lets the rock pass through reads `3`; a build that
// resolves the same contact on several consecutive ticks — the commonest way to
// get this wrong, since the rock is still overlapping the ship on the tick after
// the one it landed on — reads `1` or `0`; and a build that ends the run outright
// reads `0`.
//
// THE CONTACT IS REAL AND IT IS THE ONLY ONE ON THE FIELD. `startPlaying` empties
// every roster and shuts both world gates, so no wave arrives, no saucer arrives
// and no saucer fires; the ship's own contact gate is opened and its grace posed
// clear, because the contact test IS this item's requirement; and a Small is set
// drifting onto the ship from `APPROACH_GAP` away at a speed inside a Small's own
// drift range. The pair starts `72` units outside the `28` at which it touches, so
// what resolves the hit is the build's collision pass rather than an overlap the
// pose created.
//
// WHAT THIS DOES NOT DECIDE. Which ship comes next and where, which is
// `respawns-*`'s; the grace it carries, which is `invuln-window`'s; and the cue
// the destruction plays, which is `audio/death-cue`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  ROCK_DRIFT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  contactNeeded,
  untilLifeLost,
} from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the ship count by exactly one when a rock reaches the ship", async () => {
  startPlaying(h);
  const before = h.snapshot().lives;
  arrangeDoomedShip(h);

  const lost = await untilLifeLost(h, before);
  captureStill(h, "contact");

  assertEqual(
    lost.hit,
    true,
    contactNeeded(
      "a drifting Small",
      APPROACH_GAP,
      SHIP_TOUCHES_SMALL,
      ROCK_DRIFT,
    ),
  );
  assertEqual(
    lost.snapshot.lives,
    before - 1,
    `the ships left after one rock reached the ship, from the ${before} it ` +
      `stood at — losing a ship costs one life, and one contact is one loss ` +
      `(specs/collision.md, specs/progression.md)`,
  );
});
