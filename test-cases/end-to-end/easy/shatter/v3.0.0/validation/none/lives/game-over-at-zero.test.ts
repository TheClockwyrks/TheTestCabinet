// lives/game-over-at-zero — the last ship lost takes the counter to zero.
//
// THE RULE. `specs/progression.md`: "when the last ship is lost the life count
// reaches `0`, no new ship appears, and the game is over". This item reads the
// COUNTER alone. That no ship is put up is `respawn-only-with-lives-left`'s, and
// the screen the loss raises is `screens/game-over-on-the-last-life`'s, so a build
// that reaches zero and stays on the field loses one point rather than three.
//
// THE LAST SHIP IS POSED, NOT SPENT. `setLives(1)` counts the ship in play
// (`specs/instrumentation.md`: "`lives` counts every ship left INCLUDING the one
// being flown"), so one contact is the last death this item is about, and the two
// deaths before it would add nothing but time — every one of them is the same rule
// `a-rock-costs-a-life` already grades.
//
// AND ZERO IS READ EXACTLY, WHICH IS THE POINT OF THE ITEM. `specs/progression.md`
// fixes the resting value; nothing about a run makes it approximate. Every wrong
// model reads as a different number: a build that stops the counter one short
// reads `1`, a build that spends the ship twice on the same contact reads `-1`, a
// build that counts ships in RESERVE rather than ships left has already spent its
// last at `0` and reads `-1` here, and a build that resets the counter as the run
// ends reads `START_LIVES`.

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

/** The ships posed before the contact: the one in play, and nothing in reserve. */
const LAST_SHIP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads exactly zero ships once the last one is destroyed", async () => {
  await startPlaying(h);
  await h.debug.setLives(LAST_SHIP);
  await arrangeDoomedShip(h);

  const lost = await untilLifeLost(h, LAST_SHIP);
  await captureStill(h, "zero");

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
    0,
    `the ships left once the last one was destroyed, posed at ${LAST_SHIP} ` +
      `before the contact — the life count reaches 0 (specs/progression.md)`,
  );
});
