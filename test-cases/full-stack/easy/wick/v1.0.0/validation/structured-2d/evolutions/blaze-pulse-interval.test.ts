// evolutions/blaze-pulse-interval — a Blaze puddle pulses every BLAZE_PULSE.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Blaze"): "A Blaze
// puddle is a pulsing effect with interval `BLAZE_PULSE` (`0.2`): it pulses on
// the tick it appears and on every `BLAZE_PULSE` interval of ticks after, and
// each pulse deals `damage` to every enemy overlapping it." `specs/world.md`
// ("Timers"): "An interval of `s` seconds anywhere in this specification is
// likewise `round(s × TICK_HZ)` ticks", so the interval is `round(0.2 × 60)` =
// 12 ticks. `BLAZE_STATS` gives duration 4.0, and `specs/state.md`
// (`ZoneState`) removes a zone "on the tick `ttl` is due", `round(4 × 60)` =
// 240 ticks after the firing tick — phase 6 of `specs/world.md` ("One tick")
// counting down only the zones "that existed before this tick". So a puddle
// pulses on its firing tick and on every twelfth tick after, through tick 228,
// and on no other tick of its life.
//
// HOW A HOUND IS PUT UNDER A LANDING POINT. A puddle lands at a draw from the
// disk of radius `OIL_SCATTER` (`400`) about the lamplighter, so no single
// enemy can be posed under it. The lattice below tiles that disk with hounds
// at a spacing whose circumradius (`100 / sqrt(3)`, about 57.7) is under the
// `70 + 18` at which a puddle's circle and a hound's overlap
// (`specs/weapons.md`, Shapes and overlap), so wherever a puddle lands the
// hound nearest its center overlaps it. That guarantee is this check's
// arrangement rather than anything the build decides, and a check that wanted
// it and did not get it fails ITSELF rather than the build.
//
// WHY A HOUND, AND WHY ITS HP IS POSED BACK. A pulse of 8 twenty times over
// would kill anything the game holds, so the enemy under the puddle is read
// tick by tick and its `hp` posed back to its `maxHp` after every fall
// (`setEnemyHp`, "a real number above `0` and at most its `maxHp`"). A hound's
// 120 (`specs/enemies.md`) also outlasts a tick on which two of the five
// puddles overlap it, so no pulse tick can be lost to a death.
//
// WHY THE OTHER FOUR PUDDLES DO NOT DISTURB THE READING. All five appear on
// the same tick and carry the same duration, so their pulse ticks are the same
// ticks; whether one or two of them cover the hound changes how much `hp` falls
// and not WHICH ticks it falls on. The rest of the lattice is removed on the
// firing tick itself ("Removes enemy `id`. Nothing drops, nothing counts as a
// kill, and no cue plays", `specs/instrumentation.md`), so the puddles' life
// runs against one enemy and nothing is dropped, counted or drawn.
//
// WHY THE TIMER IS POSED OUT. Blaze's cooldown is 2.0 seconds, 120 ticks, so a
// second firing would land inside the puddle's 240-tick life and put a second
// generation of puddles over the hound. Its timer is posed to a value far past
// the span instead of turning `weaponFire` off, so the faculty under which a
// puddle pulses is left exactly as it is in play.
//
// THE TOLERANCE. None: the ticks are fixed by the interval rule, and whether
// an `hp` fell is a comparison of two reals a pulse separates by 8.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BLAZE_PULSE,
  BLAZE_STATS,
  ENEMIES,
  OIL_SCATTER,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  distance,
  isolate,
  placeEnemy,
  type Harness,
  type Point,
} from "../harness";
import { fireFromPosed, hpOf } from "./evolved";

/** The pulse interval in ticks: `round(0.2 × 60)` = 12. */
const INTERVAL = ticksOf(BLAZE_PULSE);

/** The puddle's life in ticks: `round(4.0 × 60)` = 240 after the firing tick. */
const LIFE = ticksOf(BLAZE_STATS.duration);

/** The ticks, counted from the firing tick, on which a puddle pulses. */
const PULSES: readonly number[] = Array.from(
  { length: Math.ceil(LIFE / INTERVAL) },
  (_, k) => k * INTERVAL,
).filter((tick) => tick < LIFE);

/** The lattice's spacing, in units. */
const SPACING = 100;

/**
 * The farthest any point of the plane is from a node of a triangular lattice
 * of `SPACING`: `100 / sqrt(3)`, about 57.7.
 */
const CIRCUMRADIUS = SPACING / Math.sqrt(3);

/** The distance under which a hound's circle overlaps a Blaze puddle's. */
const OVERLAP = BLAZE_STATS.radius + ENEMIES.hound.radius;

/** A cooldown posed far past the span, so no second firing lands inside it. */
const PARKED_COOLDOWN = 60;

/**
 * The lattice nodes covering the scatter disk: every node of a triangular
 * lattice of `SPACING` within `OIL_SCATTER + CIRCUMRADIUS` of the origin,
 * offset by the circumcenter of one cell so the origin, where the lamplighter
 * stands, is as far from a node as any point is.
 */
function lattice(): Point[] {
  const rowHeight = (SPACING * Math.sqrt(3)) / 2;
  const reach = OIL_SCATTER + CIRCUMRADIUS;
  const offset = { x: SPACING / 2, y: CIRCUMRADIUS };
  const rows = Math.ceil(reach / rowHeight) + 1;
  const cols = Math.ceil(reach / SPACING) + 1;
  const nodes: Point[] = [];
  for (let j = -rows; j <= rows; j += 1) {
    for (let i = -cols; i <= cols; i += 1) {
      const x = offset.x + SPACING * (i + (j & 1) * 0.5);
      const y = offset.y + rowHeight * j;
      if (Math.hypot(x, y) <= reach) nodes.push({ x, y });
    }
  }
  return nodes;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages a hound under a fired puddle on the firing tick and on every 12th tick after, through the puddle's life", async () => {
  if (!(CIRCUMRADIUS < OVERLAP)) {
    throw new Error("the lattice must put a hound under every landing point");
  }

  isolate(h);
  const ids = lattice().map((node) => placeEnemy(h, "hound", node.x, node.y));
  const posed = h.snapshot();
  assertEqual(
    posed.run.enemies.length,
    ids.length,
    "the hounds standing after the lattice was posed (specs/instrumentation.md, spawnEnemy)",
  );

  const firing = await fireFromPosed(h, "blaze");
  assertEqual(
    firing.zones.length,
    BLAZE_STATS.amount,
    "the puddles the firing tick created (specs/evolutions.md, Blaze)",
  );
  const puddle = firing.zones[0];

  // The hound nearest the first puddle's landing point, which the lattice
  // guarantees overlaps it.
  let under = posed.run.enemies[0];
  let reach = Number.POSITIVE_INFINITY;
  for (const enemy of posed.run.enemies) {
    const away = distance(enemy, puddle);
    if (away < reach) {
      reach = away;
      under = enemy;
    }
  }
  if (!(reach < OVERLAP)) {
    throw new Error(
      `the lattice left the nearest hound ${reach} from the puddle's center`,
    );
  }
  const full = under.maxHp;
  const firstPulse = hpOf(firing.after, under.id) < full;

  // The field cleared down to that hound, and the timer posed past the span.
  h.debug.setEnemyHp(under.id, full);
  for (const id of ids) if (id !== under.id) h.debug.removeEnemy(id);
  h.debug.setWeaponCooldown(firing.slot, PARKED_COOLDOWN);
  assertEqual(
    h.snapshot().run.enemies.length,
    1,
    "the hounds left in the world for the puddle's life (specs/instrumentation.md, removeEnemy)",
  );

  const pulsed = await captureReplay(h, "pulses", async () => {
    const ticks: number[] = firstPulse ? [0] : [];
    for (let tick = 1; tick <= LIFE; tick += 1) {
      const s = await advanceTicks(h, 1);
      if (hpOf(s, under.id) < full) {
        ticks.push(tick);
        h.debug.setEnemyHp(under.id, full);
      }
    }
    return ticks;
  });

  assertDeepEqual(
    pulsed,
    PULSES,
    `the ticks from the firing on which the hound under the puddle took damage, over the puddle's ${LIFE}-tick life (specs/evolutions.md, Blaze)`,
  );
});
