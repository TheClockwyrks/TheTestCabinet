// lives/invuln-window — the respawn grace opens at two and a half seconds.
//
// THE RULE. `specs/progression.md`: the next ship appears "with `INVULN_TIME`
// (`2.5` seconds) of respawn grace", and `specs/instrumentation.md` reports what
// is left of it as `ship.invuln`, "seconds of respawn grace left, 0 for none". This
// item reads the value the grace OPENS at; `invuln-counts-down` reads the rate it
// falls at from there, and `invuln-ignores-a-rock` and `invuln-ends` read what it
// does while it runs and once it is gone.
//
// THE RESPAWN IS FOUND WITHOUT LOOKING AT THE SHIP'S POSE. Every check in this
// group poses `invuln` to `0` before the contact, so the first tick on which the
// life count has fallen AND a ship is carrying grace is the tick the next ship
// appeared. Finding it that way costs the reading nothing and keeps this item
// clear of the three that decide where the next ship stands, how fast it is
// moving, and which way it faces. A build that puts a ship up carrying no grace at
// all never satisfies that, and fails here with the grace named — which is the
// right verdict, since a respawn with no grace is exactly what this item forbids.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER: `2.5` for a build that opens the
// grace where the specification puts it, `2.5` in TICKS (`300`) for one that
// confused the unit, `1.5` or `5` for one that picked its own figure.
//
// WHY A TICK AND A HALF. `specs/simulation.md` fixes the tick order, and both
// orders are conformant on the tick the respawn lands: a build that opens the
// grace and then runs its timers down reads `2.5 - TICK_DT`, and one that runs
// them first reads `2.5`. Nothing observable at a tick boundary separates the two,
// so a tick of tolerance is the specification's own ambiguity rather than slack on
// the figure. The extra half tick is float slack, so a rounding cannot decide the
// item. Together they are a two-hundredth of `INVULN_TIME`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { INVULN_TIME, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  secondsFor,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  LOSS_TICKS,
  RESPAWN_SETTLE,
  ROCK_DRIFT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  contactNeeded,
  untilGraceOpens,
} from "./scene";

/** One tick of the fixed `TICK_HZ` clock, and half of one more for float slack. */
const GRACE_TOLERANCE = 1.5 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the respawn grace at INVULN_TIME", async () => {
  await startPlaying(h);
  const before = (await h.snapshot()).lives;
  await arrangeDoomedShip(h);

  const respawned = await untilGraceOpens(h, before);
  await captureStill(h, "grace");

  assertEqual(
    respawned.hit,
    true,
    `a ship destroyed and the next one put up carrying respawn grace, inside ` +
      `${secondsFor(LOSS_TICKS + RESPAWN_SETTLE).toFixed(1)} s of game time; ` +
      contactNeeded(
        "a drifting Small",
        APPROACH_GAP,
        SHIP_TOUCHES_SMALL,
        ROCK_DRIFT,
      ),
  );
  assertLessThanOrEqual(
    Math.abs(respawned.snapshot.ship.invuln - INVULN_TIME),
    GRACE_TOLERANCE,
    `how far the grace the next ship appeared with stands from INVULN_TIME ` +
      `(${INVULN_TIME} seconds); the build reported ` +
      `${respawned.snapshot.ship.invuln} (specs/progression.md)`,
  );
});
