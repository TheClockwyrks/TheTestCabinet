// Wick — weapons/zone-fields-by-kind: each zone reports the fields its kind
// fixes.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shapes and overlap"):
// "Every zone's position is the center of its shape; a strike's `radius` is
// its `area`, a burst's is its Flare `radius`, and a slash carries its `width`
// and `height` with a `radius` of `0`." `specs/instrumentation.md` ("Snapshot
// shape"): "`zones[].ttl` is `null` for a zone that never expires, and `width`
// and `height` appear on a slash alone." The centers the specification fixes
// on the firing tick, with the lamplighter at the origin facing right:
//   - a slash's near edge is "at the player's `x`, it extends `width` in the
//     facing direction, and it is centered vertically on the player's `y`", so
//     the level-1 slash (`120 × 40`) is centered at `(60, 0)`;
//   - a strike lands on its target and covers "every other enemy within `area`
//     of the target's center", so it is centered on the target, with level-1
//     area `40`;
//   - a burst covers "every enemy within `radius` of the player's center",
//     `640` at level 1, so it is centered on the player;
//   - the aura is "centered on the player's center every tick" and, as Halo's
//     section states, permanent, so its `ttl` is `null`;
//   - lantern `0` "starts at angle `0`" on a circle of radius `orbit` (`90`)
//     about the player's center, so it is at `(90, 0)`; a Lantern set's `ttl`
//     is "set to `duration`", while each Chandelier lantern is "a zone of kind
//     `lantern` with `ttl` `null`" (`specs/evolutions.md`);
//   - a posed puddle is "centered at `(x, y)`" with `ttl` "that row's duration".
// Every timed zone's ttl "counts down" (`specs/world.md`, phase 6), by
// `TICK_DT` per tick.
//
// THE POSE. Five weapons held at once on one isolated night — Taper, Lantern,
// Halo, Spark, and Flare — each with its timer at `0`, a puddle posed, and one
// hound at `(200, 0)` for Spark to strike: outside the slash, the aura, and
// the lantern, and inside `SPARK_RANGE` and the burst. The hound's `120` hp
// outlives the strike's `15` and the burst's `100` together. One tick with
// `weaponFire` on fires all five and places the aura; a second tick reads the
// count-down. Chandelier cannot be held beside Lantern ("an evolved weapon
// whose base is held in another slot" is invalid), so it is posed on a second
// isolated night and placed by one tick. Every other faculty is held.
//
// TOLERANCE. `POSITION_TOL` on centers and lengths a build copies from a table
// or a posed point; `TIMER_TOL` on a ttl one tick down.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNear,
  assertNull,
  assertUndefined,
} from "../assert";
import {
  CHANDELIER_STATS,
  POSITION_TOL,
  TICK_DT,
  TIMER_TOL,
  weaponRow,
  type ZoneKind,
} from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  mustZone,
  newZones,
  placeEnemy,
  placePuddle,
  zonesOf,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
  type ZoneView,
} from "../harness";

/** Where Spark's one target stands. */
const HOUND = { x: 200, y: 0 };

/** Where the puddle is posed. */
const PUDDLE = { x: -200, y: 150 };

const TAPER = weaponRow("taper", 1);
const LANTERN = weaponRow("lantern", 1);
const SPARK = weaponRow("spark", 1);
const FLARE = weaponRow("flare", 1);
const OIL = weaponRow("oil-splash", 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The one zone of `kind` among `zones`, or the point fails on the count. */
function only(zones: readonly ZoneView[], kind: ZoneKind): ZoneView {
  const found = zones.filter((zone) => zone.kind === kind);
  assertEqual(found.length, 1, `zones of kind ${kind} the tick created`);
  return found[0]!;
}

/** Center and ttl, a tick later, of a zone that counts down. */
function assertCountsDown(
  later: WickSnapshot,
  zone: ZoneView,
  what: string,
): void {
  const ttl = zone.ttl;
  assertEqual(typeof ttl, "number", `the ${what}'s ttl, a number`);
  assertNear(
    mustZone(later, zone.id).ttl ?? NaN,
    (ttl as number) - TICK_DT,
    TIMER_TOL,
    `the ${what}'s ttl one tick later`,
  );
}

it("reports each zone kind's center, radius, rectangle, and ttl as its kind fixes", async () => {
  await isolate(h);
  await placeEnemy(h, "hound", HOUND.x, HOUND.y);
  const puddle = await placePuddle(h, "oil-splash", PUDDLE.x, PUDDLE.y);
  for (const id of ["taper", "lantern", "halo", "spark", "flare"] as const) {
    await armWeapon(h, await holdWeapon(h, id, 1));
  }
  await enable(h, "weaponFire");
  const before = await h.snapshot();
  const fired = await h.step(1);
  await captureStill(h, "zones");
  const created = newZones(before, fired);

  const slash = only(created, "slash");
  assertNear(slash.x, TAPER.width! / 2, POSITION_TOL, "the slash's center x");
  assertNear(slash.y, 0, POSITION_TOL, "the slash's center y");
  assertNear(
    slash.width ?? NaN,
    TAPER.width!,
    POSITION_TOL,
    "the slash's width",
  );
  assertNear(
    slash.height ?? NaN,
    TAPER.height!,
    POSITION_TOL,
    "the slash's height",
  );
  assertEqual(slash.radius, 0, "the slash's radius");

  const strike = only(created, "strike");
  assertNear(strike.x, HOUND.x, POSITION_TOL, "the strike's center x");
  assertNear(strike.y, HOUND.y, POSITION_TOL, "the strike's center y");
  assertNear(strike.radius, SPARK.area!, POSITION_TOL, "the strike's radius");
  assertUndefined(strike.width, "width on a strike");

  const burst = only(created, "burst");
  assertNear(burst.x, 0, POSITION_TOL, "the burst's center x");
  assertNear(burst.y, 0, POSITION_TOL, "the burst's center y");
  assertNear(burst.radius, FLARE.radius!, POSITION_TOL, "the burst's radius");
  assertUndefined(burst.height, "height on a burst");

  const aura = only(created, "aura");
  assertNear(aura.x, 0, POSITION_TOL, "the aura's center x");
  assertNear(aura.y, 0, POSITION_TOL, "the aura's center y");
  assertNull(aura.ttl, "the aura's ttl");

  const lantern = only(created, "lantern");
  assertNear(lantern.x, LANTERN.orbit!, POSITION_TOL, "the lantern's center x");
  assertNear(lantern.y, 0, POSITION_TOL, "the lantern's center y");
  assertNear(
    lantern.ttl ?? NaN,
    LANTERN.duration!,
    TIMER_TOL,
    "the lantern's ttl",
  );

  const posed = mustZone(fired, puddle.id);
  assertNear(posed.x, PUDDLE.x, POSITION_TOL, "the puddle's center x");
  assertNear(posed.y, PUDDLE.y, POSITION_TOL, "the puddle's center y");
  assertNear(posed.radius, OIL.radius!, POSITION_TOL, "the puddle's radius");

  const later = await h.step(1);
  assertCountsDown(later, slash, "slash");
  assertCountsDown(later, strike, "strike");
  assertCountsDown(later, burst, "burst");
  assertCountsDown(later, lantern, "lantern");
  assertCountsDown(later, posed, "puddle");
  assertNull(mustZone(later, aura.id).ttl, "the aura's ttl a tick later");

  // Chandelier, on a night of its own.
  await isolate(h);
  await holdWeapon(h, "chandelier", 1);
  const placed = await h.step(1);
  const lanterns = zonesOf(placed, "chandelier").filter(
    (zone) => zone.kind === "lantern",
  );
  assertEqual(
    lanterns.length,
    CHANDELIER_STATS.amount!,
    "Chandelier lanterns after the first tick it is held",
  );
  for (const zone of lanterns)
    assertNull(zone.ttl, "a Chandelier lantern's ttl");
  assertEqual(
    zonesOfKind(placed, "lantern").length,
    lanterns.length,
    "lantern zones on the Chandelier night",
  );
});
