// growth/respawn-on-eat — an eaten pellet is replaced on the same tick.
//
// specs/board.md: "Exactly one pellet is on the board at any moment during a
// round", and "When the head enters the pellet's cell the pellet is eaten: the
// snake grows, the score resolves, and a new pellet spawns at once."
// specs/movement.md puts the spawn inside the tick that ate, at step 5.
//
// So the reading is taken on the tick the eat resolved rather than a tick later:
// a build that places the next pellet on the following tick leaves the board
// without one for an eighth of a second every time a player scores, and a build
// that places none at all leaves a round that cannot go on.
//
// The respawn switch is deliberately ON here, which is the only point in this
// directory that is about it being on. Where the replacement may land is the
// business of the three points that follow; what is decided here is only that one
// arrived.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  sameCell,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the next pellet on the board on the tick the last was eaten", async () => {
  const scene = await arrangeEat(h, { pelletRespawn: true });
  assertEqual(scene.snapshot.pelletRespawn, true, "the switch the scene posed");

  const after = await captureReplay(h, "respawn", () => h.tick());

  assertEqual(after.ticks, 1, "ticks resolved");
  assertEqual(sameCell(after.snake[0], scene.pellet), true, "the pellet was eaten");
  // WHERE it landed is decided by the three points that follow; what is decided
  // here is that the tick which ate one left another behind.
  assertNotNull(after.pellet, "the pellet on the board when the tick resolved");
});
