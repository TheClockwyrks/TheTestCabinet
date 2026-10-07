// director/despawn-boundary — the boundary itself is inside.
//
// THE SPEC LINE. `specs/enemies.md`, "Despawning": "every common enemy whose
// center is FARTHER than `DESPAWN_DISTANCE` (`1200`) units from the
// lamplighter's center is removed". Farther than, not at, so a common standing
// at exactly 1200 stays. This is the edge case of the rule the
// beyond-the-distance item decides, and a build that wrote `>=` fails here and
// passes there.
//
// WHERE THE MOTH STANDS, AND WHY IT STAYS THERE. Exactly `DESPAWN_DISTANCE`
// along `+x` from the lamplighter, which is exact in binary floating point
// from a whole-numbered pose, so the reading is the boundary and not a
// neighbour of it. `enemyMotion` is off, so the moth neither chases nor drifts
// and the distance holds at 1200 for every tick of the drive
// (`specs/instrumentation.md`: while the switch is off "Every enemy holds its
// position and heading").
//
// THE DRIVE. The isolated world with `despawning` alone on, for 60 ticks — a
// whole second of the rule being applied over and over, so a build that
// removes on the boundary has sixty chances to do it.
//
// THE TOLERANCE. None: the moth is alive after the drive or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { DESPAWN_DISTANCE, REAL_EPS, TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** A whole second of the despawn rule being applied. */
const TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a moth standing at exactly DESPAWN_DISTANCE across 60 ticks", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", DESPAWN_DISTANCE, 0);
  enable(h, "despawning");

  const after = await advanceTicks(h, TICKS);
  captureStill(h, "boundary");

  const kept = enemyById(after, moth);
  assertDefined(
    kept,
    `the moth posed at exactly ${DESPAWN_DISTANCE} units, after ${TICKS} ticks with despawning on`,
  );
  assertNear(
    distance(kept ?? after.run.player, after.run.player),
    DESPAWN_DISTANCE,
    REAL_EPS,
    "the distance the moth held while enemyMotion was off",
  );
});
