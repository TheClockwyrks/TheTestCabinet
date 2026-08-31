// Meltdown — combat/hits-air: an ordinary emitter damages a flyer.
//
// specs/combat.md: "Every emitter targets ground units and flyers alike, except the
// Flak, which targets flying units alone". specs/surge.md gives the Drift `Flies:
// yes`, so an Arc — which carries no air restriction at all — must fire on a Drift
// in range exactly as it fires on a Mote.
//
// THIS IS THE HALF OF THE RULE A BUILD IS MOST LIKELY TO GET WRONG. Having written
// the Flak's air-only clause, a build that reaches for a `canHit(tower, unit)`
// predicate and inverts it — air towers hit air, everything else hits ground —
// passes `combat/hits-ground`, `combat/flak-hits-air` and
// `combat/flak-ignores-ground` and fails only here. So this point is posed with a
// flyer and an ordinary emitter and nothing else, and asserts the one thing its
// title claims: hp fell. What the shot removes is `combat/damage-per-shot`'s
// figure.
//
// THE FLYER STANDS STILL. `poseTarget` takes its motion off, which for a Drift
// holds its flight line as well (specs/instrumentation.md), so the reading is taken
// with the mark three tiles from the footprint centre and staying there.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  ticksForShots,
} from "./duel";

/** The emitter read, the heat it is pinned at, and the flyer it fires on. */
const TOWER = "arc";
const HEAT = 0;
const MARK = "drift";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Emitters hit flyers", async () => {
  poseGun(h, TOWER, HEAT);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const opened = readHp(h, mark);

  await h.advance(ticksForShots(1, fireRateOf(TOWER)));
  captureStill(h, "air");

  assertGreaterThan(
    opened - readHp(h, mark),
    0,
    `hp an ${TOWER} removed from a flying ${MARK} in range, after one ` +
      `${1 / fireRateOf(TOWER)}s interval`,
  );
});
