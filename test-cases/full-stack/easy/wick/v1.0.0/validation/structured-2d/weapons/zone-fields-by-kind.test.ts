// weapons/zone-fields-by-kind — each zone reports the fields its kind fixes.
//
// THE SPEC LINE. `specs/weapons.md`, "Shapes and overlap": "Every zone's
// position is the center of its shape; a strike's `radius` is its `area`, a
// burst's is its Flare `radius`, and a slash carries its `width` and `height`
// with a `radius` of `0`." `specs/instrumentation.md`, Snapshot shape:
// "`zones[].ttl` is `null` for a zone that never expires, and `width` and
// `height` appear on a slash alone." The zones that never expire are the aura
// ("Halo is a permanent aura") and the Chandelier lanterns ("each a zone of
// kind `lantern` with `ttl` `null`", `specs/evolutions.md`); every other zone's
// `ttl` is a timer, which "On every tick ... counts down by `TICK_DT`"
// (`specs/world.md`, Timers).
//
// WHERE EACH CENTER IS. The slash's "near vertical edge is at the player's
// `x`, it extends `width` in the facing direction, and it is centered
// vertically on the player's `y`", so facing right its center is
// `(player.x + width / 2, player.y)`. A strike lands "on a distinct enemy",
// dealing damage "within `area` of the target's center", so with one enemy in
// range its center is that enemy's. A burst is "every enemy within `radius`
// of the player's center", so its center is the player's. The aura is
// "centered on the player's center every tick". Lantern `0` "starts at angle
// `0`" on "a circle of radius `orbit` around the player's center", so on its
// firing tick it sits at `(player.x + orbit, player.y)`; a Chandelier lantern
// `0` the same at its `orbit`. A posed puddle is "centered at `(x, y)`".
//
// THE POSE. One hound at `(300, 300)`, within Spark's `600` and Flare's `640`
// and outside every other shape, so the strike has its one target and the
// hound's `120` hp outlasts the strike's `15` and the burst's `100`. A puddle
// posed at `(−300, 0)`. Taper, Spark, Flare, Lantern, and Halo held at level
// 1 with their timers at `0` and `weaponFire` on, so one tick fires the four
// and places the aura; a second tick counts every timer down once. Then
// Lantern is removed and Chandelier held (a base and its evolution are never
// held together), and one more tick places the Chandelier lanterns. Every
// switch but `weaponFire` is held, so nothing moves, spawns, or touches. No
// second firing falls in the span: the shortest cooldown held is Taper's
// `1.35` seconds.
//
// THE TOLERANCE. `REAL_EPS` on each center and radius, figures read straight
// from the tables or copied from a posed point, and `MOTION_EPS` on a `ttl`
// counted down by one `TICK_DT`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNull,
  assertTypeOf,
} from "../assert";
import {
  CHANDELIER_STATS,
  FLARE_LEVELS,
  LANTERN_LEVELS,
  MOTION_EPS,
  REAL_EPS,
  SPARK_LEVELS,
  TAPER_LEVELS,
  TICK_DT,
  type BaseWeaponId,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  enable,
  enemyById,
  holdWeapon,
  isolate,
  placeEnemyNear,
  placePuddle,
  weaponSlotOf,
  zoneById,
  zonesOf,
  zonesOfKind,
  type Harness,
  type Point,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";

/** Where the hound stands: in Spark's and Flare's range, outside every other shape. */
const HOUND = { x: 300, y: 300 };

/** Where the puddle is posed. */
const PUDDLE = { x: -300, y: 0 };

/** The weapons fired together on one tick, each at level 1. */
const FIRED: readonly BaseWeaponId[] = [
  "taper",
  "spark",
  "flare",
  "lantern",
  "halo",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The one zone `weapon` has in `s`, or a failed check. */
function only(s: WickSnapshot, weapon: string): SnapshotZone {
  const zones = zonesOf(s, weapon);
  assertEqual(zones.length, 1, `zones of ${weapon} in the world`);
  return zones[0];
}

/** The zone's center is `at`. */
function assertCenteredAt(zone: SnapshotZone, at: Point, what: string): void {
  assertNear(
    distance(zone, at),
    0,
    REAL_EPS,
    `how far the ${what}'s (x, y) is from its center (specs/weapons.md, Shapes and overlap)`,
  );
}

it("reports each zone's center, a slash's width and height, the radii by kind, and null ttl on the permanent kinds alone", async () => {
  const posed = isolate(h);
  const { player } = posed.run;
  const hound = placeEnemyNear(h, "hound", HOUND.x, HOUND.y);
  const target = enemyById(h.snapshot(), hound);
  if (target === undefined) throw new Error("the posed hound is missing");
  const puddle = placePuddle(
    h,
    "oil-splash",
    player.x + PUDDLE.x,
    player.y + PUDDLE.y,
  );
  for (const id of FIRED) {
    const slot = holdWeapon(h, id, 1);
    h.debug.setWeaponCooldown(slot, 0);
  }
  enable(h, "weaponFire");

  const fired = await advanceTicks(h, 1);
  const counted = await advanceTicks(h, 1);

  // A slash: width and height, radius 0, centered half its width out.
  const slash = only(fired, "taper");
  assertEqual(slash.kind, "slash", "the kind of Taper's zone");
  assertTypeOf(
    slash.width,
    "number",
    "a slash's width (specs/instrumentation.md, Snapshot shape)",
  );
  assertTypeOf(
    slash.height,
    "number",
    "a slash's height (specs/instrumentation.md, Snapshot shape)",
  );
  assertEqual(
    slash.radius,
    0,
    "a slash's radius (specs/weapons.md, Shapes and overlap)",
  );
  assertCenteredAt(
    slash,
    { x: player.x + TAPER_LEVELS[0].width / 2, y: player.y },
    "slash",
  );

  // A strike: radius is its area, centered on its target.
  const strike = only(fired, "spark");
  assertEqual(strike.kind, "strike", "the kind of Spark's zone");
  assertNear(
    strike.radius,
    SPARK_LEVELS[0].area,
    REAL_EPS,
    "a strike's radius, its area (specs/weapons.md, Shapes and overlap)",
  );
  assertCenteredAt(strike, target, "strike");

  // A burst: radius is Flare's, centered on the player.
  const burst = only(fired, "flare");
  assertEqual(burst.kind, "burst", "the kind of Flare's zone");
  assertNear(
    burst.radius,
    FLARE_LEVELS[0].radius,
    REAL_EPS,
    "a burst's radius, its Flare radius (specs/weapons.md, Shapes and overlap)",
  );
  assertCenteredAt(burst, player, "burst");

  // The aura: centered on the player, never expires.
  const aura = only(fired, "halo");
  assertEqual(aura.kind, "aura", "the kind of Halo's zone");
  assertCenteredAt(aura, player, "aura");
  assertNull(
    aura.ttl,
    "an aura's ttl (specs/instrumentation.md, Snapshot shape)",
  );

  // Lantern 0: on the orbit at angle 0 on its firing tick.
  const lantern = only(fired, "lantern");
  assertEqual(lantern.kind, "lantern", "the kind of Lantern's zone");
  assertCenteredAt(
    lantern,
    { x: player.x + LANTERN_LEVELS[0].orbit, y: player.y },
    "lantern",
  );

  // The puddle: where it was posed.
  const posedPuddle = zoneById(fired, puddle);
  assertDefined(posedPuddle, "the posed puddle in zones");
  assertEqual(posedPuddle!.kind, "puddle", "the kind of the posed zone");
  assertCenteredAt(
    posedPuddle!,
    { x: player.x + PUDDLE.x, y: player.y + PUDDLE.y },
    "puddle",
  );

  // Every other zone's ttl counts down by TICK_DT a tick.
  for (const zone of [slash, strike, burst, lantern, posedPuddle!]) {
    assertTypeOf(
      zone.ttl,
      "number",
      `a ${zone.kind}'s ttl (specs/instrumentation.md, Snapshot shape)`,
    );
    const later = zoneById(counted, zone.id);
    assertDefined(later, `the ${zone.kind} in zones one tick on`);
    assertNear(
      later!.ttl ?? NaN,
      (zone.ttl ?? NaN) - TICK_DT,
      MOTION_EPS,
      `a ${zone.kind}'s ttl one tick on, counted down by TICK_DT (specs/world.md, Timers)`,
    );
  }

  // Chandelier lanterns: never expire, lantern 0 on the orbit at angle 0.
  h.debug.removeWeapon(weaponSlotOf(counted, "lantern"));
  holdWeapon(h, "chandelier", 1);
  const evolved = await advanceTicks(h, 1);
  captureStill(h, "zones");
  const chandelier = zonesOf(evolved, "chandelier").filter(
    (zone) => zone.kind === "lantern",
  );
  assertGreaterThan(
    chandelier.length,
    0,
    "Chandelier lanterns placed on the first tick Chandelier is held (specs/evolutions.md, Chandelier)",
  );
  for (const zone of chandelier) {
    assertNull(
      zone.ttl,
      "a Chandelier lantern's ttl (specs/evolutions.md, Chandelier)",
    );
  }
  const lowest = chandelier.reduce((a, b) => (a.id < b.id ? a : b));
  assertCenteredAt(
    lowest,
    {
      x: evolved.run.player.x + CHANDELIER_STATS.orbit,
      y: evolved.run.player.y,
    },
    "Chandelier lantern 0",
  );
  assertEqual(
    zonesOfKind(evolved, "aura").length,
    1,
    "auras in the world once Chandelier is placed",
  );
});
