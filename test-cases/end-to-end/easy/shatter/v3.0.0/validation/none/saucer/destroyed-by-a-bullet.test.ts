// Shatter — saucer/destroyed-by-a-bullet: the ship's gun takes the saucer down.
//
// THE RULE. `specs/collision.md` pairs "A bullet and the saucer" with "Both are
// removed, and the saucer scores", and `specs/saucer.md` says the same in its own
// words: "A bullet the ship fires destroys the saucer." What this item reads is the
// removal — both bodies gone. The `SCORE_SAUCER` the kill pays is
// `scoring/saucer-scores-200`'s, and asserting it here would cost one build two
// points for one fault.
//
// THE ROUND IS PLACED ON THE SAUCER'S DOORSTEP, which is what `fireAt` does: a
// bullet just outside the two radii, travelling inward at `MUZZLE_SPEED`, so the
// whole flight is a few ticks and what resolves the hit is the build's own
// collision pass rather than an overlap this check posed. It is placed on the side
// FACING AWAY FROM THE STAR, because `specs/collision.md` has the core absorb a
// bullet that reaches it and a round fired across the star would be eaten on the
// way.
//
// ALL THREE FACULTIES ARE OFF. A travelling saucer is no longer where the round was
// aimed, a weaving one is no longer on the row it was aimed along, and a firing one
// puts rounds on a field the still would then be full of. What is left is a body
// standing on quiet ground and one round flown into it.
//
// WHERE IT STANDS. `(320, 620)`, `412` units from the star: far enough that the
// well moves neither the round nor the reading over the eighth of a second the
// flight lasts, and far enough that the core is nowhere near the line.
//
// Nothing here is a tolerance. The saucer is gone or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertTrue, assertUndefined } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  driveBullet,
  fireAt,
  poseSaucer,
  requireSaucer,
  saucerTarget,
  startPlaying,
  type Harness,
} from "../harness";

/** Where the saucer stands: quiet ground, far from the star. */
const STAND = { x: 320, y: 620 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the saucer and the round that struck it", async () => {
  await startPlaying(h);
  await poseSaucer(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });
  const saucer = requireSaucer(await h.snapshot(), "destroyed-by-a-bullet");

  const round = await fireAt(h, saucerTarget(saucer));
  const flight = await driveBullet(h, round);
  await captureStill(h, "kill");

  assertTrue(
    flight.hit,
    "the round spent on the saucer it was flown into (specs/collision.md)",
  );
  assertNull(
    flight.snapshot.saucer,
    "the saucer removed by the bullet that struck it (specs/collision.md)",
  );
  assertUndefined(
    bulletById(flight.snapshot, round),
    "the bullet removed by the saucer it struck (specs/collision.md)",
  );
});
