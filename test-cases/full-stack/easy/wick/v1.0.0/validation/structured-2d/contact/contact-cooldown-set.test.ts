// contact/contact-cooldown-set — a hit sets the enemy's contact cooldown to
// CONTACT_COOLDOWN.
//
// THE SPEC LINE. `specs/world.md`, "Contact damage": "An overlapping enemy
// whose `contactCooldown` is due lands a hit: `hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, and its `contactCooldown` is
// set to `CONTACT_COOLDOWN`", with `CONTACT_COOLDOWN` `0.5` from the same
// file's table. The snapshot reports each enemy's `contactCooldown` in seconds
// (`specs/instrumentation.md`, Snapshot shape), so the tick that lands the hit
// leaves the enemy reading exactly `0.5`.
//
// WHY THIS IS ITS OWN POINT. `contact-hit` reads the hp side of the same
// sentence; this reads the cooldown side. A build can take the damage and
// never arm the cooldown, which is what `contact-rehit-interval` would then
// catch as a hit every tick — but that point grades the SCHEDULE, and a build
// whose schedule is right by some other bookkeeping while its snapshot reports
// the wrong figure fails here and nowhere else.
//
// THE POSE. One moth overlapping the lamplighter, its cooldown `0` from the
// spawn so it is due on the first tick, `enemyMotion` off so it stays, and
// `enemyContact` on. The hit is read first, as the precondition that makes the
// cooldown reading mean anything; then the cooldown itself.
//
// THE TOLERANCE. The cooldown is SET, not counted, on the hit tick, so the
// reading is held to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertNear, assertDefined } from "../assert";
import { CONTACT_COOLDOWN, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The moth's center distance: well inside its `10 + 12` overlap bound. */
const OFFSET = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads contactCooldown 0.5 on the enemy in the tick its hit landed", async () => {
  const before = isolate(h);
  const moth = placeEnemyNear(h, "moth", OFFSET, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "cooldown");

  assertLessThan(
    after.run.player.hp,
    before.run.player.hp,
    "a hit landed on the tick (specs/world.md, Contact damage)",
  );
  const enemy = enemyById(after, moth);
  assertDefined(enemy, "the moth is still live after its hit");
  assertNear(
    enemy?.contactCooldown ?? Number.NaN,
    CONTACT_COOLDOWN,
    REAL_EPS,
    "contactCooldown in the hit tick's snapshot (specs/world.md, Contact damage)",
  );
});
