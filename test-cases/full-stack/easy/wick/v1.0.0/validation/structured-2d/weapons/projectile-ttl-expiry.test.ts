// weapons/projectile-ttl-expiry — a projectile is removed on the tick its ttl
// is due.
//
// THE SPEC LINE. `specs/weapons.md`, "Projectiles and pierce": "A projectile's
// `ttl` is set to its `duration` when it is fired, and it is removed on the
// tick `ttl` is due, whether or not it hit anything." Ember's level-1 row
// gives duration `2.0`, and `spawnProjectile` gives a posed bolt "`ttl` is that
// row's duration" (`specs/instrumentation.md`). `specs/world.md`, "Timers": "a
// timer set to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick it
// was set on", so the bolt is due `120` ticks after the pose: present in the
// snapshot after tick `119`, gone after tick `120`.
//
// THE POSE. One bolt at `(200, 0)` with zero velocity and pierce `0`, no enemy
// anywhere, so nothing but the `ttl` can remove it. `effectMotion` is held,
// under which "`ttl` ... still count[s]", so the bolt neither moves nor leaves
// the view; nothing else runs.
//
// THE TOLERANCE. None: the tick is fixed by the timer rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertUndefined } from "../assert";
import { EMBER_LEVELS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the bolt is posed. */
const BOLT = { x: 200, y: 0 };

/** The tick the bolt's `ttl` is due on: `round(2.0 × 60)` = `120` after the pose. */
const DUE = ticksOf(EMBER_LEVELS[0].duration);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a ttl-2.0 bolt through tick 119 and removes it on tick 120", async () => {
  const posed = isolate(h);
  const bolt = placeProjectile(h, "ember", BOLT.x, BOLT.y, 0, 0, 0);

  const expiry = await captureReplay(h, "expired", async () => {
    const lastLive = await advanceTicks(h, DUE - 1);
    const live = projectileById(lastLive, bolt);
    const due = await advanceTicks(h, 1);
    return {
      live,
      gone: projectileById(due, bolt),
      tick: due.run.tick - posed.run.tick,
    };
  });

  assertDefined(
    expiry.live,
    `the bolt in projectiles on tick ${DUE - 1} after the pose (specs/weapons.md, Projectiles and pierce)`,
  );
  assertEqual(expiry.tick, DUE, "the ticks stepped to the due tick");
  assertUndefined(
    expiry.gone,
    `the bolt in projectiles on tick ${DUE} after the pose, the tick its ttl is due (specs/weapons.md, Projectiles and pierce)`,
  );
});
