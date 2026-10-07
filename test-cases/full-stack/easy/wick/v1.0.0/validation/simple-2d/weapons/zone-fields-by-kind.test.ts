// Wick — weapons/zone-fields-by-kind: each zone reports the fields its kind
// fixes.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shapes and overlap"): "Every zone's position is the
//     center of its shape; a strike's `radius` is its `area`, a burst's is its
//     Flare `radius`, and a slash carries its `width` and `height` with a
//     `radius` of `0`."
//   - `specs/state.md` (`ZoneState`): `width` and `height` "are present on a
//     slash and absent on every other kind"; `ttl` is "`null` for a zone that
//     never expires: an aura, and a Chandelier lantern. A zone is removed on
//     the tick `ttl` is due. A slash holds `SLASH_FLASH` (`0.1`), a strike
//     `SPARK_FLASH` (`0.2`), and a burst `FLARE_FLASH` (`0.4`) ... a Lantern
//     lantern holds the set's `duration` and a puddle its `duration`."
//   - `specs/world.md` ("Timers"): "On every tick a timer counts down by
//     `TICK_DT`", and ("One tick") phase 6 counts a zone's ttl down on every
//     tick after the one that created it.
//   - The centers, each from its weapon's section of `specs/weapons.md` at
//     level 1 with no passive held: a slash's "near vertical edge is at the
//     player's `x`, it extends `width` in the facing direction, and it is
//     centered vertically on the player's `y`" (center `(x + 60, y)` facing
//     right); a Lantern lantern "starts at angle `i × 360 / amount`" on a
//     circle of `orbit` 90 (center `(x + 90, y)`), revolving "From the next
//     tick"; the aura is "centered on the player's center every tick"; a
//     strike "land[s] ... on a distinct enemy" and its `x, y` is that enemy's
//     center; a burst is Flare's, about "the player's center"; a puddle is
//     "centered at" where `spawnPuddle` put it.
//   - `specs/evolutions.md` ("Chandelier"): "On the first `playing` tick
//     Chandelier is held and no Chandelier lantern exists, any Lantern
//     lanterns still in the world are removed and `amount` Chandelier lanterns
//     are created, each a zone of kind `lantern` with `ttl` `null`", and
//     `specs/instrumentation.md` (`setWeapon`): an evolved weapon may replace
//     its base in the same slot.
//
// WHAT IS READ. One zone of each of the six kinds after the tick that creates
// them, each read for its center, its radius and slash extents, and its ttl;
// then the same zones after one more tick, each finite ttl lower by
// `TICK_DT`; then, Lantern replaced by Chandelier in its slot, the Chandelier
// lanterns after the tick that creates them, ttl `null`.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper, Lantern, Halo, Spark, and Flare held
// with their timers at `0` and `weaponFire` on, a puddle posed, and one owl as
// Spark's target: an owl (2000 hp) outlasts every hit the firing tick lands, so
// no death, drop, or kill joins the tick, and one enemy within `SPARK_RANGE`
// makes the strike's target certain. Every other switch is off, so nothing
// moves and each center is the posed geometry. `facing` is the fresh run's
// `"right"`, and the lamplighter stands at the origin.
//
// TOLERANCE. `FIGURE_TOLERANCE` on every center, extent, and ttl, exact
// arithmetic on stated figures; `MOTION_TOLERANCE` on a ttl counted down by
// one `TICK_DT`, an integrated timer. None on `null` and on absence.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertUndefined,
  assertWithin,
} from "../assert";
import {
  FIGURE_TOLERANCE,
  FLARE_FLASH,
  FLARE_LEVELS,
  LANTERN_LEVELS,
  MOTION_TOLERANCE,
  OIL_SPLASH_LEVELS,
  SLASH_FLASH,
  SPARK_FLASH,
  SPARK_LEVELS,
  SPARK_RANGE,
  TAPER_LEVELS,
  TICK_DT,
} from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enemyById,
  holdWeapon,
  isolate,
  present,
  spawnEnemyNear,
  spawnPuddleAt,
  weaponSlot,
  zoneById,
  zonesOfKind,
  type Harness,
  type Point,
  type WickSnapshot,
  type ZoneKind,
  type ZoneSnapshot,
} from "../harness";

/** Where Spark's one target stands: along +x, inside the slash and the range. */
const OWL_DX = 100;

/** Where the puddle is posed: along -y, clear of everything. */
const PUDDLE_DY = -200;

/** The five kinds the weapons create, and the one the puddle pose creates. */
const KINDS: readonly ZoneKind[] = [
  "slash",
  "lantern",
  "aura",
  "strike",
  "burst",
  "puddle",
];

/** The one zone of `kind` in `snapshot`; fails the item when there is not one. */
function theZone(snapshot: WickSnapshot, kind: ZoneKind): ZoneSnapshot {
  const zones = zonesOfKind(snapshot, kind);
  assertEqual(zones.length, 1, `zones of kind ${kind}`);
  return zones[0];
}

function assertCenter(zone: ZoneSnapshot, center: Point, what: string): void {
  assertWithin(zone.x, center.x, FIGURE_TOLERANCE, `${what}: x`);
  assertWithin(zone.y, center.y, FIGURE_TOLERANCE, `${what}: y`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports each zone kind's center, radius, extents, and ttl as its kind fixes", async () => {
  const posed = isolate(h);
  const player: Point = { x: posed.run.player.x, y: posed.run.player.y };
  assertEqual(posed.run.player.facing, "right", "facing of the fresh run");
  assertGreaterThan(SPARK_RANGE, OWL_DX, "the owl against Spark's range");
  const owl = spawnEnemyNear(h, "owl", OWL_DX, 0);
  const owlPlaced = present(enemyById(h.snapshot(), owl), "the posed owl");
  const puddle = spawnPuddleAt(h, "oil-splash", player.x, player.y + PUDDLE_DY);
  for (const id of ["taper", "lantern", "halo", "spark", "flare"] as const) {
    armWeapon(h, holdWeapon(h, id, 1));
  }

  const created = await h.tick(1);
  captureStill(h, "zones");

  const slash = theZone(created, "slash");
  assertCenter(
    slash,
    { x: player.x + TAPER_LEVELS[0].width / 2, y: player.y },
    "the slash",
  );
  assertEqual(slash.radius, 0, "the slash's radius");
  assertWithin(
    slash.width ?? Number.NaN,
    TAPER_LEVELS[0].width,
    FIGURE_TOLERANCE,
    "the slash's width",
  );
  assertWithin(
    slash.height ?? Number.NaN,
    TAPER_LEVELS[0].height,
    FIGURE_TOLERANCE,
    "the slash's height",
  );
  assertWithin(
    slash.ttl ?? Number.NaN,
    SLASH_FLASH,
    FIGURE_TOLERANCE,
    "the slash's ttl",
  );

  const lantern = theZone(created, "lantern");
  assertCenter(
    lantern,
    { x: player.x + LANTERN_LEVELS[0].orbit, y: player.y },
    "the lantern",
  );
  assertWithin(
    lantern.radius,
    LANTERN_LEVELS[0].radius,
    FIGURE_TOLERANCE,
    "the lantern's radius",
  );
  assertWithin(
    lantern.ttl ?? Number.NaN,
    LANTERN_LEVELS[0].duration,
    FIGURE_TOLERANCE,
    "the lantern's ttl",
  );

  const aura = theZone(created, "aura");
  assertCenter(aura, player, "the aura");
  assertNull(aura.ttl, "the aura's ttl");

  const strike = theZone(created, "strike");
  assertCenter(strike, { x: owlPlaced.x, y: owlPlaced.y }, "the strike");
  assertWithin(
    strike.radius,
    SPARK_LEVELS[0].area,
    FIGURE_TOLERANCE,
    "the strike's radius, its area",
  );
  assertWithin(
    strike.ttl ?? Number.NaN,
    SPARK_FLASH,
    FIGURE_TOLERANCE,
    "the strike's ttl",
  );

  const burst = theZone(created, "burst");
  assertCenter(burst, player, "the burst");
  assertWithin(
    burst.radius,
    FLARE_LEVELS[0].radius,
    FIGURE_TOLERANCE,
    "the burst's radius, Flare's radius",
  );
  assertWithin(
    burst.ttl ?? Number.NaN,
    FLARE_FLASH,
    FIGURE_TOLERANCE,
    "the burst's ttl",
  );

  const puddleZone = theZone(created, "puddle");
  assertEqual(puddleZone.id, puddle, "the puddle's id");
  assertCenter(
    puddleZone,
    { x: player.x, y: player.y + PUDDLE_DY },
    "the puddle",
  );
  // The puddle was POSED before the tick rather than created by it, so it is a
  // zone that "existed before this tick" and its ttl has counted down once.
  assertWithin(
    puddleZone.ttl ?? Number.NaN,
    OIL_SPLASH_LEVELS[0].duration - TICK_DT,
    MOTION_TOLERANCE,
    "the puddle's ttl, one tick after its pose",
  );

  for (const kind of KINDS) {
    if (kind === "slash") continue;
    const zone = theZone(created, kind);
    assertUndefined(zone.width, `the ${kind}'s width`);
    assertUndefined(zone.height, `the ${kind}'s height`);
  }

  // One more tick: every finite ttl counts down by TICK_DT, the aura's stays null.
  const aged = await h.tick(1);
  for (const kind of KINDS) {
    const before = theZone(created, kind);
    const after = present(
      zoneById(aged, before.id),
      `the ${kind} after one more tick`,
    );
    if (kind === "aura") {
      assertNull(after.ttl, "the aura's ttl after one more tick");
      continue;
    }
    assertWithin(
      after.ttl ?? Number.NaN,
      (before.ttl ?? Number.NaN) - TICK_DT,
      MOTION_TOLERANCE,
      `the ${kind}'s ttl after one more tick`,
    );
  }

  // Chandelier in Lantern's slot: its lanterns never expire.
  h.debug.setWeapon(weaponSlot(aged, "lantern"), "chandelier", 1);
  const evolved = await h.tick(1);
  const chandelier = evolved.run.zones.filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "chandelier",
  );
  assertGreaterThan(chandelier.length, 0, "Chandelier lanterns after the tick");
  for (const zone of chandelier) {
    assertNull(zone.ttl, `Chandelier lantern ${zone.id}: ttl`);
  }
});
