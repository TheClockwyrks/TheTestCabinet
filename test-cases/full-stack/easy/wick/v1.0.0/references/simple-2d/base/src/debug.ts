// Wick — the debugging and automation surface (specs/instrumentation.md).
//
// Every operation is a reading or a pose of `WickState`, written in the
// shape of `update`: a pose takes the current state, clones it into a draft,
// sets one thing, and returns the draft; a reading takes the state and
// returns what it read. An argument outside its domain throws; a call on a
// screen the operation does not apply to returns the state as it was; no
// pose sounds a cue, and no pose decides an outcome.

import type { DeepReadonly } from "ts-essentials";
import {
  GEM_TIERS,
  MAX_WEAPON_LEVEL,
  OFFER_COUNT,
  OIL_SCATTER,
  PASSIVES,
  PASSIVE_SLOTS,
  PICKUP_KINDS,
  WEAPON_SLOTS,
  WICK_DEBUG_VERSION,
  type CueName,
  type GemTier,
  type OfferId,
  type PickupKind,
  type WeaponId,
} from "./constants";
import { choose as chooseOffer } from "./flow";
import type {
  NextDrop,
  Screen,
  WickDebugApi,
  WickSnapshot,
  WickState,
} from "./game";
import { menuRects, tabRects } from "./menus";
import {
  cloneState,
  initialState,
  type Draft,
  type Enemy,
  type SwitchName,
} from "./state";
import {
  aliveCommons,
  isEnemyId,
  runTime,
  spawnEnemy,
  spawnWindow,
} from "./sim/enemies";
import { forgetHits } from "./sim/effects";
import { unit } from "./sim/geometry";
import { DAWN_TICK } from "./sim/lamplighter";
import { candidatePool, isOfferId, isPassiveId } from "./sim/progression";
import {
  PROJECTILE_WEAPONS,
  PUDDLE_WEAPONS,
  isBaseWeapon,
  isEvolution,
  isWeaponId,
  makeProjectile,
  makePuddle,
  pairedIds,
} from "./sim/weapons";
import { armor, maxHp, moveSpeed, pickupRadius, xpToNext } from "./stats";

type View = DeepReadonly<WickState>;

// ---- Argument domains ------------------------------------------------------

function invalid(what: string): never {
  throw new RangeError(`wick debug: ${what}`);
}

function real(value: unknown, name: string, min = -Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    invalid(
      `${name} must be a real number of at least ${min}, got ${String(value)}`,
    );
  }
  return value;
}

function whole(
  value: unknown,
  name: string,
  min = -Infinity,
  max = Infinity,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    invalid(
      `${name} must be a whole number in [${min}, ${max}], got ${String(value)}`,
    );
  }
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") invalid(`${name} must be a boolean`);
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    invalid(
      `${name} must be one of ${allowed.join(", ")}, got ${String(value)}`,
    );
  }
  return value as T;
}

const RUN_SCREENS: readonly Screen[] = ["playing", "paused"];

/** What `setNextDrop` takes. */
const NEXT_DROPS: readonly NextDrop[] = ["bread", "draft", "none"];

/** A posed angle: a real number of at least `0` and below `360`. */
function angle(value: unknown): number {
  const degrees = real(value, "degrees", 0);
  if (degrees >= 360) invalid("degrees must be below 360");
  return degrees;
}

function onRunScreen(state: View): boolean {
  return RUN_SCREENS.includes(state.screen);
}

/** The next state, from `state`, with `apply` run on a run screen alone. */
function pose(state: View, apply: (draft: Draft) => void): WickState {
  const draft = cloneState(state);
  if (onRunScreen(draft)) apply(draft);
  return draft;
}

function enemyById(draft: Draft, id: unknown): Enemy {
  whole(id, "id", 0);
  const enemy = draft.run.enemies.find((candidate) => candidate.id === id);
  if (!enemy) invalid(`no live enemy has id ${String(id)}`);
  return enemy;
}

function heldSlot(slot: unknown, length: number): number {
  return whole(slot, "slot", 0, length - 1);
}

function setSwitch(state: View, name: SwitchName, on: unknown): WickState {
  const value = bool(on, "on");
  const draft = cloneState(state);
  draft[name] = value;
  return draft;
}

// ---- The reading -----------------------------------------------------------

/** A pure reading of `state`, as the plain object the specification gives. */
export function snapshot(state: View): WickSnapshot {
  const r = state.run;
  return {
    version: WICK_DEBUG_VERSION,
    screen: state.screen,
    menuIndex: state.menuIndex,
    almanacTab: state.almanacTab,
    almanacScroll: state.almanacScroll,
    spawning: state.spawning,
    events: state.events,
    despawning: state.despawning,
    enemyMotion: state.enemyMotion,
    enemyContact: state.enemyContact,
    weaponFire: state.weaponFire,
    effectMotion: state.effectMotion,
    drops: state.drops,
    progression: state.progression,
    run: {
      tick: r.tick,
      time: runTime(r),
      level: r.level,
      xp: r.xp,
      xpToNext: xpToNext(r.level),
      kills: r.kills,
      player: { ...r.player },
      hurtFlash: r.hurtFlash,
      maxHp: maxHp(r.passives),
      armor: armor(r.passives),
      moveSpeed: moveSpeed(r.passives),
      pickupRadius: pickupRadius(r.passives),
      weapons: r.weapons.map(({ id, level, cooldown }) => ({
        id,
        level,
        cooldown,
      })),
      passives: r.passives.map(({ id, level }) => ({ id, level })),
      enemies: r.enemies.map((enemy) => ({
        ...enemy,
        heading: { ...enemy.heading },
      })),
      projectiles: r.projectiles.map(
        ({
          id,
          weapon,
          x,
          y,
          vx,
          vy,
          ax,
          ay,
          radius,
          damage,
          ttl,
          pierce,
          hits,
        }) => ({
          id,
          weapon,
          x,
          y,
          vx,
          vy,
          ax,
          ay,
          radius,
          damage,
          ttl,
          pierce,
          hits: hits.map((hit) => ({ ...hit })),
        }),
      ),
      zones: r.zones.map((zone) => ({
        id: zone.id,
        weapon: zone.weapon,
        kind: zone.kind,
        x: zone.x,
        y: zone.y,
        radius: zone.radius,
        ...(zone.kind === "slash"
          ? { width: zone.width, height: zone.height }
          : {}),
        damage: zone.damage,
        ttl: zone.ttl,
        hits: zone.hits.map((hit) => ({ ...hit })),
      })),
      gems: r.gems.map(({ id, tier, x, y, attracted }) => ({
        id,
        tier,
        x,
        y,
        attracted,
      })),
      pickups: r.pickups.map((pickup) => ({ ...pickup })),
      offers: [...r.offers],
      pool: state.screen === "levelup" ? candidatePool(r) : [],
      nextOffers: r.nextOffers === null ? null : [...r.nextOffers],
      pendingLevelUps: r.pendingLevelUps,
      chestResult: r.chestResult === null ? null : { ...r.chestResult },
      spawnTimer: r.spawnTimer,
      spawnWindow: spawnWindow(r),
      firedEvents: [...r.firedEvents],
      aliveCommons: aliveCommons(r),
      nextId: r.nextId,
      nextSpawnAngle: r.nextSpawnAngle,
      nextSwarmAngle: r.nextSwarmAngle,
      nextPuddleOffset:
        r.nextPuddleOffset === null ? null : { ...r.nextPuddleOffset },
      nextStrikeTarget: r.nextStrikeTarget,
      nextChestItem: r.nextChestItem,
      nextDrop: r.nextDrop,
    },
    muted: state.muted,
    accumulator: state.accumulator,
    simTime: state.simTime,
  };
}

// ---- The screens -----------------------------------------------------------

/**
 * Set `screen`, and nothing else (specs/instrumentation.md, `setScreen`).
 *
 * The pose sets the screen and the three menu cursors alone, so a run is never
 * begun, discarded, ended, or grown by it. The sequences that build what a
 * screen shows are the caller's: a fresh run is `reset`, this pose, and
 * `setWeapon(0, "taper", 1)`; the level-up overlay is `setPendingLevelUps` and
 * a tick; the chest overlay is a chest collected; the endings are `setHp` at
 * `0` or `setTick` at `DAWN_TICK - 1` and a tick.
 */
function setScreen(state: View, name: unknown): WickState {
  const target = oneOf(name, "name", [
    "title",
    "howto",
    "almanac",
    "playing",
    "levelup",
    "paused",
    "fallen",
    "dawn",
    "chest",
  ] as const);
  const draft = cloneState(state);
  // "A call that leaves `playing` discards the accumulator, as every frame and
  // pose that leaves `playing` does."
  if (draft.screen === "playing" && target !== "playing") draft.accumulator = 0;
  draft.screen = target;
  draft.menuIndex = 0;
  draft.almanacTab = 0;
  draft.almanacScroll = 0;
  return draft;
}

// ---- The surface -----------------------------------------------------------

/** Build the surface. It holds no state: every operation is over its argument. */
export function createDebugApi(): WickDebugApi {
  return {
    version: WICK_DEBUG_VERSION,

    reset(state) {
      const draft = initialState();
      draft.muted = state.muted;
      return draft;
    },
    snapshot,
    menuRects,
    tabRects,

    setScreen,
    choose(state, index) {
      whole(index, "index");
      const draft = cloneState(state);
      chooseOffer(draft, index, new Set<CueName>());
      return draft;
    },

    setSpawning: (state, on) => setSwitch(state, "spawning", on),
    setEvents: (state, on) => setSwitch(state, "events", on),
    setDespawning: (state, on) => setSwitch(state, "despawning", on),
    setEnemyMotion: (state, on) => setSwitch(state, "enemyMotion", on),
    setEnemyContact: (state, on) => setSwitch(state, "enemyContact", on),
    setWeaponFire: (state, on) => setSwitch(state, "weaponFire", on),
    setEffectMotion: (state, on) => setSwitch(state, "effectMotion", on),
    setDrops: (state, on) => setSwitch(state, "drops", on),
    setProgression: (state, on) => setSwitch(state, "progression", on),

    setTick(state, tick) {
      const value = whole(tick, "tick", 0, DAWN_TICK - 1);
      return pose(state, (draft) => {
        draft.run.tick = value;
      });
    },
    setSpawnTimer(state, seconds) {
      const value = real(seconds, "seconds", 0);
      return pose(state, (draft) => {
        draft.run.spawnTimer = value;
      });
    },

    // ---- Drawn outcomes ----------------------------------------------
    // Each sets what the next draw of its kind decides; the draw consumes it.

    setNextSpawnAngle(state, degrees) {
      const value = angle(degrees);
      return pose(state, (draft) => {
        draft.run.nextSpawnAngle = value;
      });
    },
    setNextSwarmAngle(state, degrees) {
      const value = angle(degrees);
      return pose(state, (draft) => {
        draft.run.nextSwarmAngle = value;
      });
    },
    setNextPuddleOffset(state, dx, dy) {
      const x = real(dx, "dx");
      const y = real(dy, "dy");
      if (Math.hypot(x, y) > OIL_SCATTER) {
        invalid(`an offset must be at most OIL_SCATTER (${OIL_SCATTER}) long`);
      }
      return pose(state, (draft) => {
        draft.run.nextPuddleOffset = { x, y };
      });
    },
    setNextStrikeTarget(state, id) {
      return pose(state, (draft) => {
        draft.run.nextStrikeTarget = enemyById(draft, id).id;
      });
    },
    setNextChestItem(state, id) {
      if (typeof id !== "string" || !(isBaseWeapon(id) || isPassiveId(id))) {
        invalid(`${String(id)} is no base weapon or passive`);
      }
      const item = id;
      return pose(state, (draft) => {
        draft.run.nextChestItem = item;
      });
    },
    setNextDrop(state, kind) {
      const value: NextDrop = oneOf(kind, "kind", NEXT_DROPS);
      return pose(state, (draft) => {
        draft.run.nextDrop = value;
      });
    },

    setPlayerPosition(state, x, y) {
      const px = real(x, "x");
      const py = real(y, "y");
      return pose(state, (draft) => {
        draft.run.player.x = px;
        draft.run.player.y = py;
      });
    },
    setFacing(state, facing) {
      const value = oneOf(facing, "facing", ["left", "right"] as const);
      return pose(state, (draft) => {
        draft.run.player.facing = value;
      });
    },
    setHp(state, hp) {
      const value = real(hp, "hp");
      return pose(state, (draft) => {
        if (value > maxHp(draft.run.passives)) {
          invalid("hp must be at most maxHp");
        }
        draft.run.player.hp = value;
      });
    },

    setLevel(state, level) {
      const value = whole(level, "level", 1);
      return pose(state, (draft) => {
        draft.run.level = value;
      });
    },
    setXp(state, xp) {
      const value = real(xp, "xp", 0);
      return pose(state, (draft) => {
        draft.run.xp = value;
      });
    },
    setKills(state, kills) {
      const value = whole(kills, "kills", 0);
      return pose(state, (draft) => {
        draft.run.kills = value;
      });
    },
    setPendingLevelUps(state, count) {
      const value = whole(count, "count", 0);
      return pose(state, (draft) => {
        draft.run.pendingLevelUps = value;
      });
    },
    setNextOffers(state, ids) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > OFFER_COUNT) {
        invalid(`ids must list 1 to ${OFFER_COUNT} offers`);
      }
      const list: OfferId[] = [];
      for (const id of ids) {
        if (typeof id !== "string" || !isOfferId(id))
          invalid(`${String(id)} is no offer`);
        if (list.includes(id)) invalid(`${id} is repeated`);
        list.push(id);
      }
      const draft = cloneState(state);
      if (onRunScreen(draft) || draft.screen === "levelup") {
        draft.run.nextOffers = list;
      }
      return draft;
    },

    setWeapon(state, slot, id, level) {
      if (typeof id !== "string" || !isWeaponId(id))
        invalid(`${String(id)} is no weapon`);
      const weapon: WeaponId = id;
      const max = isEvolution(weapon) ? 1 : MAX_WEAPON_LEVEL;
      const value = whole(level, "level", 1, max);
      return pose(state, (draft) => {
        const weapons = draft.run.weapons;
        const index = whole(
          slot,
          "slot",
          0,
          Math.min(weapons.length, WEAPON_SLOTS - 1),
        );
        const paired = pairedIds(weapon);
        for (let i = 0; i < weapons.length; i += 1) {
          if (i !== index && paired.includes(weapons[i].id)) {
            invalid(`${weapons[i].id} in slot ${i} excludes ${weapon}`);
          }
        }
        if (index === weapons.length) {
          weapons.push({
            id: weapon,
            level: value,
            cooldown: 0,
            cooldownSet: 0,
          });
          return;
        }
        const held = weapons[index];
        if (held.id !== weapon) {
          held.id = weapon;
          held.cooldown = 0;
          held.cooldownSet = 0;
        }
        held.level = value;
      });
    },
    setWeaponCooldown(state, slot, seconds) {
      const value = real(seconds, "seconds", 0);
      return pose(state, (draft) => {
        const weapons = draft.run.weapons;
        const held = weapons[heldSlot(slot, weapons.length)];
        held.cooldown = value;
        held.cooldownSet = value;
      });
    },
    removeWeapon(state, slot) {
      return pose(state, (draft) => {
        const weapons = draft.run.weapons;
        weapons.splice(heldSlot(slot, weapons.length), 1);
      });
    },
    setPassive(state, slot, id, level) {
      if (typeof id !== "string" || !isPassiveId(id))
        invalid(`${String(id)} is no passive`);
      const passive = id;
      const value = whole(level, "level", 1, PASSIVES[passive].maxLevel);
      return pose(state, (draft) => {
        const passives = draft.run.passives;
        const index = whole(
          slot,
          "slot",
          0,
          Math.min(passives.length, PASSIVE_SLOTS - 1),
        );
        for (let i = 0; i < passives.length; i += 1) {
          if (i !== index && passives[i].id === passive) {
            invalid(`${passive} is already held in slot ${i}`);
          }
        }
        if (index === passives.length)
          passives.push({ id: passive, level: value });
        else passives[index] = { id: passive, level: value };
      });
    },
    removePassive(state, slot) {
      return pose(state, (draft) => {
        const passives = draft.run.passives;
        passives.splice(heldSlot(slot, passives.length), 1);
      });
    },

    spawnEnemy(state, type, x, y) {
      if (typeof type !== "string" || !isEnemyId(type))
        invalid(`${String(type)} is no enemy`);
      const px = real(x, "x");
      const py = real(y, "y");
      return pose(state, (draft) => {
        spawnEnemy(draft.run, type, px, py);
      });
    },
    setEnemyPosition(state, id, x, y) {
      const px = real(x, "x");
      const py = real(y, "y");
      return pose(state, (draft) => {
        const enemy = enemyById(draft, id);
        enemy.x = px;
        enemy.y = py;
      });
    },
    setEnemyHp(state, id, hp) {
      const value = real(hp, "hp");
      return pose(state, (draft) => {
        const enemy = enemyById(draft, id);
        if (value <= 0 || value > enemy.maxHp) {
          invalid("hp must be above 0 and at most the enemy's maxHp");
        }
        enemy.hp = value;
      });
    },
    setEnemyHeading(state, id, hx, hy) {
      const heading = unit({ x: real(hx, "hx"), y: real(hy, "hy") });
      if (heading === null) invalid("a heading must be a non-zero vector");
      return pose(state, (draft) => {
        enemyById(draft, id).heading = heading;
      });
    },
    setEnemyAge(state, id, seconds) {
      const value = real(seconds, "seconds", 0);
      return pose(state, (draft) => {
        enemyById(draft, id).age = value;
      });
    },
    setEnemyContactCooldown(state, id, seconds) {
      const value = real(seconds, "seconds", 0);
      return pose(state, (draft) => {
        enemyById(draft, id).contactCooldown = value;
      });
    },
    removeEnemy(state, id) {
      return pose(state, (draft) => {
        const enemy = enemyById(draft, id);
        draft.run.enemies = draft.run.enemies.filter(
          (candidate) => candidate !== enemy,
        );
        forgetHits(draft.run, new Set([enemy.id]));
      });
    },
    clearEnemies(state) {
      return pose(state, (draft) => {
        const gone = new Set(draft.run.enemies.map((enemy) => enemy.id));
        draft.run.enemies = [];
        forgetHits(draft.run, gone);
      });
    },

    spawnProjectile(state, weapon, x, y, vx, vy, pierce) {
      const id = oneOf(weapon, "weapon", PROJECTILE_WEAPONS);
      const px = real(x, "x");
      const py = real(y, "y");
      const vxv = real(vx, "vx");
      const vyv = real(vy, "vy");
      if (
        typeof pierce !== "number" ||
        !Number.isInteger(pierce) ||
        (pierce < 0 && pierce !== -1)
      ) {
        invalid(
          "pierce must be a whole number of at least 0, or INFINITE_PIERCE",
        );
      }
      if (id === "sconce" && vxv === 0 && vyv === 0) {
        invalid("a sconce takes a non-zero velocity");
      }
      return pose(state, (draft) => {
        draft.run.projectiles.push(
          makeProjectile(draft.run, id, px, py, vxv, vyv, pierce),
        );
      });
    },
    clearProjectiles(state) {
      return pose(state, (draft) => {
        draft.run.projectiles = [];
      });
    },
    spawnPuddle(state, weapon, x, y) {
      const id = oneOf(weapon, "weapon", PUDDLE_WEAPONS);
      const px = real(x, "x");
      const py = real(y, "y");
      return pose(state, (draft) => {
        draft.run.zones.push(makePuddle(draft.run, id, px, py));
      });
    },
    clearZones(state) {
      return pose(state, (draft) => {
        draft.run.zones = [];
      });
    },

    spawnGem(state, tier, x, y) {
      const value: GemTier = oneOf(tier, "tier", GEM_TIERS);
      const px = real(x, "x");
      const py = real(y, "y");
      return pose(state, (draft) => {
        const { run } = draft;
        run.gems.push({
          id: run.nextId,
          tier: value,
          x: px,
          y: py,
          attracted: false,
          bornTick: -1,
        });
        run.nextId += 1;
      });
    },
    setGemAttracted(state, id, attracted) {
      whole(id, "id", 0);
      const value = bool(attracted, "attracted");
      return pose(state, (draft) => {
        const gem = draft.run.gems.find((candidate) => candidate.id === id);
        if (!gem) invalid(`no gem has id ${String(id)}`);
        gem.attracted = value;
      });
    },
    clearGems(state) {
      return pose(state, (draft) => {
        draft.run.gems = [];
      });
    },
    spawnPickup(state, kind, x, y) {
      const value: PickupKind = oneOf(kind, "kind", PICKUP_KINDS);
      const px = real(x, "x");
      const py = real(y, "y");
      return pose(state, (draft) => {
        const { run } = draft;
        run.pickups.push({ id: run.nextId, kind: value, x: px, y: py });
        run.nextId += 1;
      });
    },
    clearPickups(state) {
      return pose(state, (draft) => {
        draft.run.pickups = [];
      });
    },
  };
}
