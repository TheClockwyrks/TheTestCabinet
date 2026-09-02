// saucer/first-arrives-at-18s — the first saucer of a game arrives about eighteen
// seconds in.
//
// THE RULE. `specs/saucer.md`'s cadence table: the first arrival of a game
// happens "`SAUCER_FIRST_DELAY` (`18` seconds) of game time after the game
// begins", while the ship is in play. So the reading is a bracket around that
// moment — no saucer before it, one after it — taken off a game that has just
// begun.
//
// WHY A BRACKET AND NOT AN INSTANT. The specification fixes the delay but not the
// tick a build must notice it on: a build that accumulates the delay and spawns
// on the first tick past it, and one that schedules the arrival for the tick the
// delay lands on, are both conformant and can differ by a tick. Two seconds
// either side is eleven percent of the figure, which nothing conformant needs
// and every wrong delay in this specification's neighbourhood fails: the
// `25`-to-`35`-second gap that governs LATER arrivals is over the ceiling by five
// seconds at its smallest, and a build that puts a saucer up at the start of a
// game is under the floor by the whole sixteen.
//
// THE GATE IS ON, AND IT IS THIS ITEM'S OWN REQUIREMENT. `openSaucerGame` resets
// the game — which is what returns the arrival clock to the start of a game's
// cadence — empties the field, shuts the wave loop, and then turns the arrival
// gate back on. Nothing is added: a saucer that turns up on this field is the
// build's own spawner putting it there.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRST_DELAY } from "../constants";
import { assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { openSaucerGame } from "./cadence";

/**
 * The two seconds either side of `SAUCER_FIRST_DELAY` the item brackets it with.
 *
 * Eleven percent of the figure. See the header for why nothing conformant needs
 * it and why no wrong delay this specification names survives it.
 */
const BRACKET = 2;

/** The moment nothing may be up yet: 16 s of game time. */
const BEFORE_TICKS = ticksFor(SAUCER_FIRST_DELAY - BRACKET);

/** The moment one must be up by: 20 s of game time. */
const AFTER_TICKS = ticksFor(SAUCER_FIRST_DELAY + BRACKET);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts no saucer up before 16 s and one up by 20 s", async () => {
  openSaucerGame(h);

  await h.advance(BEFORE_TICKS);
  assertNull(
    h.snapshot().saucer,
    `the field ${SAUCER_FIRST_DELAY - BRACKET} s into a game, before the ` +
      "first arrival is due (specs/saucer.md)",
  );

  await h.advance(AFTER_TICKS - BEFORE_TICKS);
  const arrived = h.snapshot();
  captureStill(h, "arrival");

  assertNotNull(
    arrived.saucer,
    `the saucer up ${SAUCER_FIRST_DELAY + BRACKET} s into a game ` +
      "(specs/saucer.md)",
  );
});
