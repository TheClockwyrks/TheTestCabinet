// scoring/score-only-rises — within a game, the score never falls.
//
// `specs/scoring.md`: "The score only ever rises within a game. No event lowers
// it." That is a rule about the WHOLE run rather than about any one figure, so it
// is read the only way such a rule can be: every scoring event the game has is put
// on the field in turn, and the score is sampled on every tick between them.
//
// THE THREE EVENTS, AND WHY THESE THREE. `specs/scoring.md` names four paying
// events and two that pay nothing, and this run holds one of each kind:
//
//   1. ONE LARGE SHOT DOWN THROUGH ITS WHOLE LADDER, which pays a Large, then two
//      Mediums, then four Smalls — the three rock figures, in the order play
//      produces them, seven kills under `base` and eleven rounds under `warhead`.
//   2. A SAUCER ADDED AND SHOT, which pays the fourth figure.
//   3. ONE ROCK SLUNG INTO THE STAR, which pays nothing at all — the event a build
//      is most likely to have wired backwards, since a build that charges the
//      player for a rock the star took is exactly a build whose score falls.
//
// The run totals `720` under either variant, far below `EXTRA_LIFE_STEP`
// (`10 000`), so the extra ship never fires and nothing here is entangled with
// `lives`.
//
// THE EVENTS ARE POSED DIRECTLY, NOT WAITED FOR. `startPlaying` shuts the wave loop
// and the saucer's arrival, and the rocks and the saucer are put on the field by
// hand. Reaching them through the game's own cadences instead would make the item
// VACUOUS IN THE DIRECTION THAT MATTERS: a build whose wave loop never spawns and
// whose saucer never arrives records no scoring event at all, every sample is then
// equal, and a monotonic reading passes a build that scores nothing. Which is why
// the run is also required to have actually paid something.
//
// SAMPLED EVERY TICK rather than at the ends of each event, because that is the
// only reading that catches a dip a later event undoes — a build that zeroes the
// score on a wave's last kill and pays it back, or one that subtracts on the
// swallow and restores on the re-entry, is monotonic at the ends and not monotonic
// at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";
import {
  QUIET_SPOT,
  poseFallingRock,
  poseStandingSaucer,
  recycleTheRock,
  saucerTarget,
  shootLadderWatching,
  shootWatching,
  type Watch,
} from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never lets the score fall across a run of every scoring event", async () => {
  startPlaying(h);
  const scores: number[] = [h.snapshot().score];
  const watch: Watch = (snapshot) => {
    scores.push(snapshot.score);
  };

  // 1. A Large, shot down through every Medium and Small it leaves.
  poseRock(h, "large", QUIET_SPOT.x, QUIET_SPOT.y);
  await shootLadderWatching(h, watch);

  // 2. A saucer, standing still with its mind and its gun off, shot down.
  const saucer = poseStandingSaucer(h, QUIET_SPOT.x, QUIET_SPOT.y);
  await shootWatching(h, saucerTarget(saucer), watch);

  // 3. One rock dropped onto the star, which pays nothing.
  poseFallingRock(h);
  await recycleTheRock(h, watch);

  captureStill(h, "run");

  // What the item decides: the deepest step the score took across the whole run.
  let worst = 0;
  let at = 0;
  for (let i = 1; i < scores.length; i += 1) {
    const step = scores[i] - scores[i - 1];
    if (step < worst) {
      worst = step;
      at = i;
    }
  }
  assertGreaterThanOrEqual(
    worst,
    0,
    `the least step the score took, at sample ${at} of ${scores.length - 1} (specs/scoring.md)`,
  );

  // And the run was not vacuous: it paid for the bodies it took off the field.
  assertGreaterThan(
    scores[scores.length - 1],
    scores[0],
    "a run of seven rock kills and a saucer having paid something (specs/scoring.md)",
  );
});
