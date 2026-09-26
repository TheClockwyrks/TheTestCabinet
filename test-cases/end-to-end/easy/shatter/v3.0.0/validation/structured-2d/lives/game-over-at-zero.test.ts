// lives/game-over-at-zero — the last ship lost takes the counter to zero.
//
// THE RULE. `specs/progression.md`: "When the last ship is lost the life count
// reaches `0`, no new ship appears, and the game is over." This item decides the
// COUNTER and nothing else. That no ship is put up is
// `lives/respawn-only-with-lives-left`, and the screen the loss raises is
// `screens/game-over-on-the-last-life`, so a build that reaches zero and forgets
// to change screen loses one point rather than two.
//
// EXACTLY ZERO. `specs/instrumentation.md` reports `lives` as the ships left
// "INCLUDING the one in play", so the ship that just died is the one that came
// off the count and the figure below is an equality rather than a bound. The two
// wrong models this separates both read a different number: a build that stops
// the counter at one because it will not respawn below that reads `1`, and a
// build that decrements past the end reads `-1`.
//
// THE RUN IS TAKEN DOWN TO ONE SHIP WITH `setLives(1)`, which is the ship being
// flown with nothing in reserve, so the contact that follows is the last death.
// The counter is read on the tick it falls, so nothing that happens afterwards —
// a screen change, a menu, a build's own tidying — stands between the death and
// the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { poseLosingDuel, watchTheDeath } from "./duel";

/** The ships the run is taken down to: the one being flown, nothing in reserve. */
const LAST_SHIP = 1;

/** The ceiling on the drive to the death: see `duel.ts`. */
const DEATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the ship counter to exactly zero on the last death", async () => {
  const rockId = poseLosingDuel(h);
  h.debug.setLives(LAST_SHIP);

  const armed = h.snapshot();
  assertEqual(
    armed.lives,
    LAST_SHIP,
    "setLives to be reported by the snapshot, so the contact that follows " +
      "is the last death (specs/instrumentation.md)",
  );
  assertEqual(
    armed.ship.collision,
    true,
    "the ship's lethal contact test running for the contact " +
      "(specs/instrumentation.md)",
  );

  const death = await watchTheDeath(h, rockId, DEATH_TICKS);
  captureStill(h, "zero");

  assertTrue(
    death.lostAt >= 0,
    "the rock reaching the ship to cost the last life (specs/collision.md)",
  );
  assertEqual(
    death.end.lives,
    0,
    "the ships left the tick the last one was destroyed — the life count " +
      "reaches 0 (specs/progression.md)",
  );
});
