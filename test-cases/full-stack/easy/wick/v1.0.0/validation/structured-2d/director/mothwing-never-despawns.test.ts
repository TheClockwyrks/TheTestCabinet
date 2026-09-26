// director/mothwing-never-despawns — a mothwing stays however far the lamplighter
// travels.
//
// THE SPEC LINE. `specs/enemies.md`, "Despawning": "every common enemy whose
// center is farther than `DESPAWN_DISTANCE` (`1200`) units from the
// lamplighter's center is removed ... Elites and the Dark are outside this
// rule and stay on the field at any distance." The roster says it of the three
// together: "each stays on the field however far the lamplighter travels,
// until it dies or the run ends". `mothwing` is rank `elite` in
// `ENEMIES`, so the rule the commons take does not reach it.
//
// WHY EACH OF THE THREE IS ITS OWN ITEM. A build that exempts one rank and not
// another loses exactly one kind of arrival — a chest the elite carries, or
// the night's last threat — so the mothwing, the owl, and the Dark are decided
// separately and a failure names which one the build removed.
//
// WHERE IT STANDS. 3000 units from the lamplighter along `+x`, two and a half
// times the distance that removes a common, so no reading of where the
// boundary lies saves a build that applies the common rule here.
//
// THE DRIVE. The isolated world with `despawning` alone on, for 60 ticks — a
// whole second of the rule being applied, so a build that removes it has sixty
// chances to. `enemyMotion` is off, so it holds its distance rather than
// chasing its way back inside (`specs/instrumentation.md`: while the switch is
// off "Every enemy holds its position and heading").
//
// THE TOLERANCE. None on the verdict: it is in the last snapshot or it is not.
// `REAL_EPS` on the distance read beside it, which is the posed figure read
// back through a hypotenuse.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { REAL_EPS, TICK_HZ } from "../constants";
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

/** Far outside the distance that removes a common. */
const FAR = 3000;

/** A whole second of the despawn rule being applied. */
const TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a mothwing posed 3000 units out across 60 ticks with despawning on", async () => {
  isolate(h);
  const id = placeEnemyNear(h, "mothwing", FAR, 0);
  enable(h, "despawning");

  const after = await advanceTicks(h, TICKS);
  captureStill(h, "kept");

  const kept = enemyById(after, id);
  assertDefined(
    kept,
    `the mothwing posed ${FAR} units out, after ${TICKS} ticks with despawning on`,
  );
  assertNear(
    distance(kept ?? after.run.player, after.run.player),
    FAR,
    REAL_EPS,
    "the distance it held while enemyMotion was off",
  );
});
