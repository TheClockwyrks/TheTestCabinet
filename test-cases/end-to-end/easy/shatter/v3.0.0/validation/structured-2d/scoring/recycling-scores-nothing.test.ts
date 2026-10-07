// scoring/recycling-scores-nothing — the star's own kill pays the player nothing.
//
// `specs/scoring.md` states it twice over: "Nothing else scores. A rock the star
// recycles pays nothing", and `specs/collision.md` pairs a rock with the core as
// "The rock is recycled, as `specs/rocks.md` states. Nothing scores." So the score
// a build reports across the swallow is the score it held before it.
//
// THE WRONG MODEL THIS NAMES is a build that treats the core as a killer: one that
// runs the swallow through the same path a bullet's kill runs through pays the
// player a rock's figure for a rock the player never shot, and a score can then
// climb on its own while the ship sits still. That build reads `1254`, `1284` or
// `1334` here — its own idea of what a Large is worth — and a conformant build
// reads the `1234` it was posed at.
//
// SAMPLED ON EVERY TICK of the fall, the swallow and the re-entry rather than at
// the ends alone, because a build that pays for the swallow and takes the payment
// back when the rock re-enters would read as unchanged from the ends and would
// still have moved the score inside a game.
//
// THE RECYCLE IS REQUIRED TO HAVE HAPPENED, and asserted AFTER the score, in that
// order deliberately. A build that destroys the rock at the core instead of
// recycling it also leaves no recycle to read, and the assertion the reviewer should
// see first is the one this item owns: what the score did. `specs/rocks.md` has the
// star "immediately re-place" the rock, so the re-placement is a single-tick step of
// hundreds of units and travel cannot counterfeit it; where it re-enters is the
// `rocks` group's item and is not read here.
//
// The field holds one rock and nothing else: `startPlaying` shuts the wave loop and
// the saucer's arrival and empties every roster, so there is no second body whose
// destruction could pay while this one falls.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { POSED_SCORE, poseFallingRock, recycleTheRock } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the score exactly as it was when the star takes a rock", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  poseFallingRock(h);
  const before = h.snapshot().score;

  const scores: number[] = [];
  const run = await recycleTheRock(h, (snapshot) => {
    scores.push(snapshot.score);
  });
  captureStill(h, "score");

  // What the item decides: not one tick of the swallow paid anything.
  const strayed = scores.find((score) => score !== before);
  assertEqual(
    strayed ?? before,
    before,
    "the score across the fall, the swallow and the re-entry (specs/scoring.md)",
  );

  // And the scenario was real: the star did take the rock and set it down again.
  assertTrue(
    run.recycled,
    "a rock that reached the core taken and immediately re-placed (specs/rocks.md)",
  );
});
