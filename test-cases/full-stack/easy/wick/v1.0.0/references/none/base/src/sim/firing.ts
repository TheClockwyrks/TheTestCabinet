// Wick — the firing, the first part of phase 5 (specs/weapons.md,
// specs/evolutions.md).
//
// While `weaponFire` is on, each held weapon's cooldown timer counts down,
// and each weapon whose timer is due fires: its projectiles and zones are
// created at the lamplighter's and the enemies' positions of this tick, from
// the level and the derived stats in force. A weapon that needs a target and
// finds none does not fire, and its timer is set as though it had.

import {
  FLARE_FLASH,
  INFINITE_PIERCE,
  OIL_SCATTER,
  PIN_SPREAD,
  SCONCE_SPREAD,
  SHARD_SPREAD,
  SLASH_FLASH,
  SPARK_FLASH,
  SPARK_RANGE,
  type WeaponId,
  type WeaponRow,
} from "../constants";
import type { Enemy, HeldWeapon, RunState, Zone } from "../state";
import { areaMul, damageMul } from "../stats";
import type { TickContext } from "./context";
import { facingVector } from "./enemies";
import { distance, fromDegrees, rotate, type Vec } from "./geometry";
import { countDown, isDue } from "./timers";
import {
  aimAt,
  amountOf,
  currentCooldown,
  makeLantern,
  makeProjectile,
  makePuddle,
  nearestEnemies,
  rowFor,
} from "./weapons";

/** The figures a firing reads: the row scaled by the stats in force. */
interface Firing {
  ctx: TickContext;
  run: RunState;
  id: WeaponId;
  row: WeaponRow;
  amount: number;
  damage: number;
  area: number;
}

type Fire = (firing: Firing) => void;

/** A zone that hits on the tick it is created and is drawn for `flash`. */
function flashZone(
  firing: Firing,
  kind: Zone["kind"],
  x: number,
  y: number,
  radius: number,
  flash: number,
): Zone {
  const { run } = firing;
  const zone: Zone = {
    id: run.nextId,
    weapon: firing.id,
    kind,
    x,
    y,
    radius,
    damage: firing.damage,
    ttl: flash,
    hits: [],
    bornTick: run.tick,
  };
  run.nextId += 1;
  run.zones.push(zone);
  return zone;
}

/** `count` unit directions fanned about `dir` by `spread` degrees apart. */
function fan(dir: Vec, count: number, spread: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(rotate(dir, (i - (count - 1) / 2) * spread));
  }
  return out;
}

/** Taper and Pyre: a slash on the facing side, a second one mirrored. */
const slash: Fire = (firing) => {
  const { run, row, area } = firing;
  const width = (row.width ?? 0) * area;
  const height = (row.height ?? 0) * area;
  const side = facingVector(run).x;
  for (let i = 0; i < firing.amount; i += 1) {
    const sign = i === 0 ? side : -side;
    const zone = flashZone(
      firing,
      "slash",
      run.player.x + (sign * width) / 2,
      run.player.y,
      0,
      SLASH_FLASH,
    );
    zone.width = width;
    zone.height = height;
  }
};

/** Ember and Beacon: one bolt at each of the nearest enemies. */
const bolts: Fire = (firing) => {
  const { run, row } = firing;
  const speed = row.speed ?? 0;
  for (const target of nearestEnemies(run, firing.amount)) {
    const dir = aimAt(run, target);
    run.projectiles.push(
      makeProjectile(
        run,
        firing.id,
        run.player.x,
        run.player.y,
        dir.x * speed,
        dir.y * speed,
        row.pierce ?? 0,
      ),
    );
  }
};

/** Pin and Hail: darts in the facing direction, spread vertically. */
const darts: Fire = (firing) => {
  const { run, row, amount } = firing;
  const vx = facingVector(run).x * (row.speed ?? 0);
  for (let i = 0; i < amount; i += 1) {
    run.projectiles.push(
      makeProjectile(
        run,
        firing.id,
        run.player.x,
        run.player.y + (i - (amount - 1) / 2) * PIN_SPREAD,
        vx,
        0,
        row.pierce ?? 0,
      ),
    );
  }
};

/** Lantern: a set of lanterns evenly spaced on their orbit. */
const lanterns: Fire = (firing) => {
  const { run, row, amount, area } = firing;
  for (let i = 0; i < amount; i += 1) {
    run.zones.push(
      makeLantern(
        run,
        firing.id,
        (i * 360) / amount,
        (row.orbit ?? 0) * area,
        (row.radius ?? 0) * area,
        firing.damage,
        row.duration ?? 0,
      ),
    );
  }
};

/** Halo and Corona: the aura pulses on this tick. */
const pulse: Fire = (firing) => {
  firing.ctx.auraPulse = true;
};

/** Oil Splash and Blaze: puddles at random points of the scatter disk. */
const puddles: Fire = (firing) => {
  const { run, ctx } = firing;
  for (let i = 0; i < firing.amount; i += 1) {
    const angle = ctx.rng.next() * 360;
    const reach = OIL_SCATTER * Math.sqrt(ctx.rng.next());
    const dir = fromDegrees(angle);
    run.zones.push(
      makePuddle(
        run,
        firing.id,
        run.player.x + dir.x * reach,
        run.player.y + dir.y * reach,
      ),
    );
  }
};

/** The enemies Spark may strike: those within `SPARK_RANGE`. */
function sparkTargets(run: RunState): Enemy[] {
  return run.enemies.filter(
    (enemy) => distance(run.player, enemy) <= SPARK_RANGE,
  );
}

/** Spark: strikes on distinct random enemies within range. */
const strikes: Fire = (firing) => {
  const { run, ctx, row, area } = firing;
  for (const target of ctx.rng.sample(sparkTargets(run), firing.amount)) {
    flashZone(
      firing,
      "strike",
      target.x,
      target.y,
      (row.area ?? 0) * area,
      SPARK_FLASH,
    );
  }
};

/** Shard: bouncing bolts toward the nearest enemy, or the facing direction. */
const shards: Fire = (firing) => {
  const { run, row } = firing;
  const [nearest] = nearestEnemies(run, 1);
  const dir = nearest ? aimAt(run, nearest) : facingVector(run);
  for (const heading of fan(dir, firing.amount, SHARD_SPREAD)) {
    run.projectiles.push(
      makeProjectile(
        run,
        firing.id,
        run.player.x,
        run.player.y,
        heading.x * (row.speed ?? 0),
        heading.y * (row.speed ?? 0),
        INFINITE_PIERCE,
      ),
    );
  }
};

/** Sconce: decelerating boomerangs toward the nearest enemy. */
const sconces: Fire = (firing) => {
  const { run, row } = firing;
  const [nearest] = nearestEnemies(run, 1);
  if (!nearest) return;
  for (const heading of fan(
    aimAt(run, nearest),
    firing.amount,
    SCONCE_SPREAD,
  )) {
    run.projectiles.push(
      makeProjectile(
        run,
        firing.id,
        run.player.x,
        run.player.y,
        heading.x * (row.speed ?? 0),
        heading.y * (row.speed ?? 0),
        INFINITE_PIERCE,
      ),
    );
  }
};

/** Flare: one burst about the lamplighter. */
const burst: Fire = (firing) => {
  const { run, row, area } = firing;
  flashZone(
    firing,
    "burst",
    run.player.x,
    run.player.y,
    (row.radius ?? 0) * area,
    FLARE_FLASH,
  );
};

const FIRES: Readonly<Record<WeaponId, Fire>> = {
  taper: slash,
  pyre: slash,
  ember: bolts,
  beacon: bolts,
  pin: darts,
  hail: darts,
  lantern: lanterns,
  chandelier: () => {},
  halo: pulse,
  corona: pulse,
  "oil-splash": puddles,
  blaze: puddles,
  spark: strikes,
  shard: shards,
  sconce: sconces,
  flare: burst,
};

/** Fire `held` on this tick, from the row and the stats in force. */
export function fire(ctx: TickContext, held: HeldWeapon): void {
  const { run } = ctx;
  const row = rowFor(held.id, held.level);
  const firing: Firing = {
    ctx,
    run,
    id: held.id,
    row,
    amount: amountOf(run, held.id, row),
    damage: row.damage * damageMul(run.passives),
    area: areaMul(run.passives),
  };
  FIRES[held.id](firing);
}

/** The seconds a weapon's timer is set to once it has fired on this tick. */
export function timerAfterFiring(run: RunState, held: HeldWeapon): number {
  const row = rowFor(held.id, held.level);
  const cooldown = currentCooldown(run, row);
  return held.id === "lantern" ? (row.duration ?? 0) + cooldown : cooldown;
}

/**
 * Phase 5, the firing: each held weapon's timer counts down, and each weapon
 * whose timer is due fires and is set to its current cooldown. Chandelier
 * has no cooldown, so its timer holds `0` and it fires nothing.
 */
export function fireWeapons(ctx: TickContext): void {
  const { run } = ctx;
  for (const held of run.weapons) {
    if (held.id === "chandelier") {
      held.cooldown = 0;
      continue;
    }
    held.cooldown = countDown(held.cooldown);
    if (!isDue(held.cooldown)) continue;
    fire(ctx, held);
    const seconds = timerAfterFiring(run, held);
    held.cooldown = seconds;
    held.cooldownSet = seconds;
  }
}
