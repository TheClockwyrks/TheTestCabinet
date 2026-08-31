// lives/respawn-only-with-lives-left — the last death puts no new ship up.
//
// THE RULE. `specs/progression.md` puts the next ship at the safe point "when a
// ship is lost AND LIVES REMAIN", and states the other case in its own sentence:
// "When the last ship is lost the life count reaches `0`, no new ship appears,
// and the game is over." This item decides the middle clause — that nothing is
// put up — and only that. The counter reading `0` is `lives/game-over-at-zero`,
// and the screen the loss puts up is `screens/game-over-on-the-last-life`, so a
// build that flies a phantom ship on its game-over screen loses one point rather
// than three.
//
// THE RUN IS TAKEN DOWN TO ONE SHIP WITH `setLives(1)`, which
// `specs/instrumentation.md` defines as the ships left "counting the one in
// play": one ship left is the ship being flown and nothing in reserve, so the
// contact that follows is the last death.
//
// WHAT IS READ, AND WHY IT IS READ OVER A WINDOW. The least the ship's centre
// came to `(SAFE_X, SAFE_Y)` over half a second after the loss. The ship dies
// 481 units away, and a build that puts nothing up leaves it there — a wreck
// still coasting at `DEATH_SPEED` (160) covers 80 units in that window and is
// never nearer than 400 — while a build that respawns puts a ship within a unit
// of the safe point on one of those ticks. The two readings are two orders of
// magnitude apart, so the bound below is nowhere near either.
//
// AND THE GRACE IS READ TOO, because it is the second signature of a ship that
// was put up: `specs/progression.md` gives every respawned ship `INVULN_TIME`
// (`2.5` s), of which two full seconds would still be standing at the end of
// this window. A build that respawned a ship somewhere OTHER than the safe point
// is caught by that reading even though the first one misses it.
//
// WHAT IS NOT READ, AND WHY. The item's own description asks for "nothing is
// drawn there" beside the state reading. That half is not decidable against this
// case's specification: `specs/ui.md` leaves the layout of the `gameover` screen
// — the screen this scenario is on the moment the last ship is lost — entirely
// to the build, so the pixels around `(640, 560)` may legitimately be the build's
// own menu, its final score, or nothing at all. A pixel reading there would fail
// conformant builds for where they put their type. The state reading below
// decides the requirement without that hazard.

import { afterEach, beforeEach, it } from "vitest";
import { SAFE_X, SAFE_Y } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { wrappedDistance, type Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { poseLosingDuel, watchForRespawn, watchTheDeath } from "./duel";

/** The place `specs/progression.md` fixes for a ship a death puts up. */
const SAFE: Vec = { x: SAFE_X, y: SAFE_Y };

/** The ships the run is taken down to: the one being flown, nothing in reserve. */
const LAST_SHIP = 1;

/**
 * How near the safe point counts as a ship having been put up there, in units.
 *
 * Four times `SHIP_R` (14). A build that respawns lands within a unit of the
 * point; a build that puts nothing up leaves the wreck more than 400 units
 * away. Nothing a build can do lands between the two.
 */
const NO_SHIP_CLEARANCE = 60;

/** The ceiling on the drive to the death: see `duel.ts`. */
const DEATH_TICKS = ticksFor(0.5);

/** How long the safe point is watched after the last ship is lost. */
const WATCH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts no ship at the safe point when the last one is lost", async () => {
  const rockId = poseLosingDuel(h);
  h.debug.setLives(LAST_SHIP);

  const armed = h.snapshot();
  assertEqual(
    armed.lives,
    LAST_SHIP,
    "setLives to be reported by the snapshot, so the contact that follows " +
      "is the last death (specs/instrumentation.md)",
  );
  assertGreaterThan(
    wrappedDistance({ x: armed.ship.x, y: armed.ship.y }, SAFE),
    NO_SHIP_CLEARANCE,
    "the doomed ship standing well away from the safe point, so a ship " +
      "found there afterwards is one that was put there",
  );

  const death = await watchTheDeath(h, rockId, DEATH_TICKS);
  assertTrue(
    death.lostAt >= 0,
    "the rock reaching the ship to cost the last life (specs/collision.md)",
  );

  const after = await watchForRespawn(h, SAFE, NO_SHIP_CLEARANCE, WATCH_TICKS);
  captureStill(h, "empty");

  assertGreaterThan(
    after.closest,
    NO_SHIP_CLEARANCE,
    "the ship's centre staying away from (SAFE_X, SAFE_Y) after the last " +
      "ship was lost — no new ship appears (specs/progression.md)",
  );
  assertEqual(
    after.mostGrace,
    0,
    "the most respawn grace the ship carried after the last one was lost, " +
      "which a fresh ship would carry INVULN_TIME of (specs/progression.md)",
  );
});
