// armor/non-fatal-hit-spends-the-bullet — the round that chips a rock is gone.
//
// `specs/rocks.md`, Armor: "A bullet that hits a rock lowers that rock's health by
// exactly `1`, and the bullet is removed." `specs/collision.md` says the same thing
// from the other side: for a bullet and a rock under `warhead`, "The bullet is
// removed and the rock's health falls by `1`". So the removal is not the
// destruction's doing — it happens on the chipping hit too, and a build that only
// spends a round on the hit that kills leaves a round loose in the field to chip
// the rock again a tick later.
//
// THE READING IS THE TICK THE HIT LANDED, AND THE HEALTH IS WHAT FINDS IT. The
// drive stops on the struck rock's health falling — the one thing `specs/rocks.md`
// says a hit does — rather than on the round leaving the roster, so that the round
// leaving the roster is something this check can still assert rather than something
// its own stop condition already assumed. On that same tick the bullet must be gone
// from `bullets`.
//
// AND THE ROUND MUST HAVE BEEN THERE TO SPEND. The tick before is read too: the
// round is asserted still in flight there, so a build whose `addBullet` places
// nothing at all fails naming the operation rather than passing this vacuously on
// an empty roster.
//
// A CHIPPING HIT, NOT A FATAL ONE. The rock is a Large at its full
// `ROCK_HEALTH.large` (`3`), so the round this reads leaves it standing: what is
// decided is that a NON-FATAL hit spends the round. That the rock survived is the
// PRECONDITION and is asserted as one, and nothing more about its health is read —
// what the health then reads is `armor/health-falls-by-one`'s point, and a build
// that takes the wrong number off a hit must fail there rather than here as well.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../constants";
import { assertUndefined } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  poseRock,
  requireBullet,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ARMOR_GROUND, chipRock } from "./scene";

/** The hits a Large carries, from which the first round leaves it standing. */
const FULL = ROCK_HEALTH.large;

/** Seconds of the chipped rock drifting on, filmed after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the round on the tick its non-fatal hit lands", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);

  const chip = await chipRock(h, rock);

  requireRock(
    chip.at,
    rock,
    `the Large, one of its ROCK_HEALTH.large (${FULL}) hits spent and still ` +
      "standing on the tick the round landed, which is what makes this the " +
      "non-fatal case (specs/rocks.md)",
  );

  requireBullet(
    chip.before,
    chip.bullet,
    "the round in flight on the tick before its hit landed, so there was a " +
      "round for the hit to spend (specs/instrumentation.md)",
  );

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "chip");

  assertUndefined(
    bulletById(chip.at, chip.bullet),
    "the round in the bullet roster on the tick its hit landed: " +
      "specs/rocks.md removes the bullet on the hit that chips a rock, not " +
      "only on the hit that destroys it",
  );
});
