// Wick — the debugging and automation surface, `window.__wick`
// (specs/instrumentation.md).
//
// Every operation is a read of the game's state or a pose of one part of it.
// An argument outside its domain throws; a call on a screen the operation
// does not apply to leaves the state as it was; no pose sounds a cue, and no
// pose decides an outcome. The clock operations belong here because nothing
// outside this build owns the clock.

import {
  DAWN_TICK,
  GEM_TIERS,
  OIL_SCATTER,
  MAX_WEAPON_LEVEL,
  OFFER_COUNT,
  PASSIVES,
  PASSIVE_SLOTS,
  PICKUP_KINDS,
  WEAPON_SLOTS,
  WICK_DEBUG_VERSION,
  type EnemyId,
  type Facing,
  type GemTier,
  type OfferId,
  type PickupKind,
  type Screen,
  type WeaponId,
} from "./constants";
import type { Game } from "./game";
import { menuRects, tabRects } from "./layout";
import {
  NEXT_DROPS,
  SWITCH_NAMES,
  type Enemy,
  type NextDrop,
  type RunState,
  type SwitchName,
} from "./state";
import {
  aliveCommons,
  isEnemyId,
  runTime,
  spawnEnemy,
  spawnWindow,
} from "./sim/enemies";
import { drawDrop, forgetHits } from "./sim/effects";
import { unit } from "./sim/geometry";
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

/** One rectangle a menu item or a tab occupies, in stage coordinates. */
export interface WickRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WickSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  almanacTab: number;
  almanacScroll: number;
  autoStep: boolean;
  spawning: boolean;
  events: boolean;
  despawning: boolean;
  enemyMotion: boolean;
  enemyContact: boolean;
  weaponFire: boolean;
  effectMotion: boolean;
  drops: boolean;
  progression: boolean;
  run: {
    tick: number;
    time: number;
    level: number;
    xp: number;
    xpToNext: number;
    kills: number;
    player: { x: number; y: number; facing: Facing; hp: number };
    hurtFlash: number;
    maxHp: number;
    armor: number;
    moveSpeed: number;
    pickupRadius: number;
    weapons: { id: string; level: number; cooldown: number }[];
    passives: { id: string; level: number }[];
    enemies: {
      id: number;
      type: string;
      x: number;
      y: number;
      hp: number;
      maxHp: number;
      heading: { x: number; y: number };
      age: number;
      contactCooldown: number;
    }[];
    projectiles: {
      id: number;
      weapon: string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      ax: number;
      ay: number;
      radius: number;
      damage: number;
      ttl: number;
      pierce: number;
      hits: { enemy: number; cooldown: number }[];
    }[];
    zones: {
      id: number;
      weapon: string;
      kind: string;
      x: number;
      y: number;
      radius: number;
      width?: number;
      height?: number;
      damage: number;
      ttl: number | null;
      hits: { enemy: number; cooldown: number }[];
    }[];
    gems: {
      id: number;
      tier: string;
      x: number;
      y: number;
      attracted: boolean;
    }[];
    pickups: { id: number; kind: string; x: number; y: number }[];
    offers: string[];
    pool: string[];
    nextOffers: string[] | null;
    pendingLevelUps: number;
    chestResult:
      | { kind: "evolve"; weapon: string }
      | { kind: "level"; item: string; level: number }
      | { kind: "heal" }
      | null;
    spawnTimer: number;
    spawnWindow: number;
    firedEvents: number[];
    aliveCommons: number;
    nextId: number;
    nextSpawnAngle: number | null;
    nextSwarmAngle: number | null;
    nextSpawnType: string | null;
    nextPuddleOffset: { x: number; y: number } | null;
    nextStrikeTarget: number | null;
    nextChestItem: string | null;
    nextDrop: NextDrop | null;
  };
  muted: boolean;
  accumulator: number;
  simTime: number;
}

export interface WickDebugApi {
  version: number;
  setAutoStep(auto: boolean): void;
  step(ticks?: number): void;
  advance(seconds: number): void;
  reset(): void;
  snapshot(): WickSnapshot;
  menuRects(): WickRect[];
  tabRects(): WickRect[];
  setScreen(name: Screen): void;
  choose(index: number): void;
  setSpawning(on: boolean): void;
  setEvents(on: boolean): void;
  setDespawning(on: boolean): void;
  setEnemyMotion(on: boolean): void;
  setEnemyContact(on: boolean): void;
  setWeaponFire(on: boolean): void;
  setEffectMotion(on: boolean): void;
  setDrops(on: boolean): void;
  setProgression(on: boolean): void;
  setTick(tick: number): void;
  setSpawnTimer(seconds: number): void;
  setNextSpawnAngle(degrees: number): void;
  setNextSwarmAngle(degrees: number): void;
  setNextSpawnType(id: EnemyId): void;
  setNextPuddleOffset(dx: number, dy: number): void;
  setNextStrikeTarget(id: number): void;
  setNextChestItem(id: string): void;
  setNextDrop(kind: string): void;
  rollDrop(): NextDrop;
  setPlayerPosition(x: number, y: number): void;
  setFacing(facing: Facing): void;
  setHp(hp: number): void;
  setLevel(level: number): void;
  setXp(xp: number): void;
  setKills(kills: number): void;
  setPendingLevelUps(count: number): void;
  setNextOffers(ids: readonly string[]): void;
  setWeapon(slot: number, id: string, level: number): void;
  setWeaponCooldown(slot: number, seconds: number): void;
  removeWeapon(slot: number): void;
  setPassive(slot: number, id: string, level: number): void;
  removePassive(slot: number): void;
  spawnEnemy(type: string, x: number, y: number): void;
  setEnemyPosition(id: number, x: number, y: number): void;
  setEnemyHp(id: number, hp: number): void;
  setEnemyHeading(id: number, hx: number, hy: number): void;
  setEnemyAge(id: number, seconds: number): void;
  setEnemyContactCooldown(id: number, seconds: number): void;
  removeEnemy(id: number): void;
  clearEnemies(): void;
  spawnProjectile(
    weapon: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    pierce: number,
  ): void;
  clearProjectiles(): void;
  spawnPuddle(weapon: string, x: number, y: number): void;
  clearZones(): void;
  spawnGem(tier: string, x: number, y: number): void;
  setGemAttracted(id: number, attracted: boolean): void;
  clearGems(): void;
  spawnPickup(kind: string, x: number, y: number): void;
  clearPickups(): void;
}

// ---- Argument domains --------------------------------------------------------

function invalid(what: string): never {
  throw new RangeError(`__wick: ${what}`);
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

/** A posed angle: a real number of at least `0` and below `360`. */
function angle(value: unknown): number {
  const degrees = real(value, "degrees", 0);
  if (degrees >= 360) invalid("degrees must be below 360");
  return degrees;
}

/** The clock the surface takes hold of: the frame loop's three operations. */
export interface Clock {
  setAutoStep(auto: boolean): void;
  step(ticks: number): void;
  advance(seconds: number): void;
}

/** Build the surface over `game` and the `clock` its frames run on. */
export function createApi(game: Game, clock: Clock): WickDebugApi {
  const state = (): Game["state"] => game.state;
  const run = (): RunState => game.state.run;
  const onRunScreen = (): boolean => RUN_SCREENS.includes(game.state.screen);

  /** Run `pose` on a run screen; a pose sounds nothing. */
  const pose = (apply: () => void): void => {
    if (!onRunScreen()) return;
    apply();
    game.discardCues();
  };

  const enemyById = (id: unknown): Enemy => {
    whole(id, "id", 0);
    const enemy = run().enemies.find((candidate) => candidate.id === id);
    if (!enemy) invalid(`no live enemy has id ${String(id)}`);
    return enemy;
  };

  const setSwitch = (name: SwitchName, on: unknown): void => {
    state().switches[name] = bool(on, "on");
  };

  const heldSlot = (slot: unknown, length: number): number =>
    whole(slot, "slot", 0, length - 1);

  const snapshot = (): WickSnapshot => {
    const s = state();
    const r = s.run;
    return {
      version: WICK_DEBUG_VERSION,
      screen: s.screen,
      menuIndex: s.menuIndex,
      almanacTab: s.almanacTab,
      almanacScroll: s.almanacScroll,
      autoStep: game.autoStep,
      ...SWITCH_NAMES.reduce(
        (switches, name) => ({ ...switches, [name]: s.switches[name] }),
        {} as Record<SwitchName, boolean>,
      ),
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
        offers: r.offers.slice(),
        pool: s.screen === "levelup" ? candidatePool(r) : [],
        nextOffers: r.nextOffers === null ? null : r.nextOffers.slice(),
        pendingLevelUps: r.pendingLevelUps,
        chestResult: r.chestResult === null ? null : { ...r.chestResult },
        spawnTimer: r.spawnTimer,
        spawnWindow: spawnWindow(r),
        firedEvents: r.firedEvents.slice(),
        aliveCommons: aliveCommons(r),
        nextId: r.nextId,
        nextSpawnAngle: r.nextSpawnAngle,
        nextSwarmAngle: r.nextSwarmAngle,
        nextSpawnType: r.nextSpawnType,
        nextPuddleOffset:
          r.nextPuddleOffset === null ? null : { ...r.nextPuddleOffset },
        nextStrikeTarget: r.nextStrikeTarget,
        nextChestItem: r.nextChestItem,
        nextDrop: r.nextDrop,
      },
      muted: s.muted,
      accumulator: s.accumulator,
      simTime: s.simTime,
    };
  };

  const setScreen = (name: unknown): void => {
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
    game.poseScreen(target);
    game.discardCues();
  };

  return {
    version: WICK_DEBUG_VERSION,

    setAutoStep(auto) {
      clock.setAutoStep(bool(auto, "auto"));
    },
    step(ticks = 1) {
      clock.step(whole(ticks, "ticks", 1));
    },
    advance(seconds) {
      const dt = real(seconds, "seconds");
      if (dt <= 0) invalid("seconds must be above 0");
      clock.advance(dt);
    },
    reset() {
      game.reset();
    },
    snapshot,
    menuRects: () => menuRects(state()).map((rect) => ({ ...rect })),
    tabRects: () => tabRects(state()).map((rect) => ({ ...rect })),

    setScreen,
    choose(index) {
      whole(index, "index");
      if (state().screen !== "levelup") return;
      game.choose(index);
      game.discardCues();
    },

    setSpawning: (on) => setSwitch("spawning", on),
    setEvents: (on) => setSwitch("events", on),
    setDespawning: (on) => setSwitch("despawning", on),
    setEnemyMotion: (on) => setSwitch("enemyMotion", on),
    setEnemyContact: (on) => setSwitch("enemyContact", on),
    setWeaponFire: (on) => setSwitch("weaponFire", on),
    setEffectMotion: (on) => setSwitch("effectMotion", on),
    setDrops: (on) => setSwitch("drops", on),
    setProgression: (on) => setSwitch("progression", on),

    setTick(tick) {
      const value = whole(tick, "tick", 0, DAWN_TICK - 1);
      pose(() => {
        run().tick = value;
      });
    },
    setSpawnTimer(seconds) {
      const value = real(seconds, "seconds", 0);
      pose(() => {
        run().spawnTimer = value;
      });
    },

    // ---- Drawn outcomes ----------------------------------------------
    // Each sets what the next draw of its kind decides; the draw consumes it.

    setNextSpawnAngle(degrees) {
      const value = angle(degrees);
      pose(() => {
        run().nextSpawnAngle = value;
      });
    },
    setNextSwarmAngle(degrees) {
      const value = angle(degrees);
      pose(() => {
        run().nextSwarmAngle = value;
      });
    },
    setNextSpawnType(id) {
      if (typeof id !== "string" || !isEnemyId(id))
        invalid(`${String(id)} is no enemy`);
      const type = id;
      pose(() => {
        run().nextSpawnType = type;
      });
    },
    setNextPuddleOffset(dx, dy) {
      const x = real(dx, "dx");
      const y = real(dy, "dy");
      if (Math.hypot(x, y) > OIL_SCATTER) {
        invalid(`an offset must be at most OIL_SCATTER (${OIL_SCATTER}) long`);
      }
      pose(() => {
        run().nextPuddleOffset = { x, y };
      });
    },
    setNextStrikeTarget(id) {
      pose(() => {
        run().nextStrikeTarget = enemyById(id).id;
      });
    },
    setNextChestItem(id) {
      if (typeof id !== "string" || !(isBaseWeapon(id) || isPassiveId(id))) {
        invalid(`${String(id)} is no base weapon or passive`);
      }
      const item = id;
      pose(() => {
        run().nextChestItem = item;
      });
    },
    setNextDrop(kind) {
      const value: NextDrop = oneOf(kind, "kind", NEXT_DROPS);
      pose(() => {
        run().nextDrop = value;
      });
    },
    rollDrop() {
      return drawDrop(game.rng);
    },

    setPlayerPosition(x, y) {
      const px = real(x, "x");
      const py = real(y, "y");
      pose(() => {
        run().player.x = px;
        run().player.y = py;
      });
    },
    setFacing(facing) {
      const value = oneOf(facing, "facing", ["left", "right"] as const);
      pose(() => {
        run().player.facing = value;
      });
    },
    setHp(hp) {
      const value = real(hp, "hp");
      pose(() => {
        if (value > maxHp(run().passives)) invalid("hp must be at most maxHp");
        run().player.hp = value;
      });
    },

    setLevel(level) {
      const value = whole(level, "level", 1);
      pose(() => {
        run().level = value;
      });
    },
    setXp(xp) {
      const value = real(xp, "xp", 0);
      pose(() => {
        run().xp = value;
      });
    },
    setKills(kills) {
      const value = whole(kills, "kills", 0);
      pose(() => {
        run().kills = value;
      });
    },
    setPendingLevelUps(count) {
      const value = whole(count, "count", 0);
      pose(() => {
        run().pendingLevelUps = value;
      });
    },
    setNextOffers(ids) {
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
      if (!onRunScreen() && state().screen !== "levelup") return;
      run().nextOffers = list;
      game.discardCues();
    },

    setWeapon(slot, id, level) {
      if (typeof id !== "string" || !isWeaponId(id))
        invalid(`${String(id)} is no weapon`);
      const weapon: WeaponId = id;
      const max = isEvolution(weapon) ? 1 : MAX_WEAPON_LEVEL;
      const value = whole(level, "level", 1, max);
      pose(() => {
        const weapons = run().weapons;
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
    setWeaponCooldown(slot, seconds) {
      const value = real(seconds, "seconds", 0);
      pose(() => {
        const held = run().weapons[heldSlot(slot, run().weapons.length)];
        held.cooldown = value;
        held.cooldownSet = value;
      });
    },
    removeWeapon(slot) {
      pose(() => {
        run().weapons.splice(heldSlot(slot, run().weapons.length), 1);
      });
    },
    setPassive(slot, id, level) {
      if (typeof id !== "string" || !isPassiveId(id))
        invalid(`${String(id)} is no passive`);
      const passive = id;
      const value = whole(level, "level", 1, PASSIVES[passive].maxLevel);
      pose(() => {
        const passives = run().passives;
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
    removePassive(slot) {
      pose(() => {
        run().passives.splice(heldSlot(slot, run().passives.length), 1);
      });
    },

    spawnEnemy(type, x, y) {
      if (typeof type !== "string" || !isEnemyId(type))
        invalid(`${String(type)} is no enemy`);
      const px = real(x, "x");
      const py = real(y, "y");
      pose(() => {
        spawnEnemy(run(), type, px, py);
      });
    },
    setEnemyPosition(id, x, y) {
      const px = real(x, "x");
      const py = real(y, "y");
      pose(() => {
        const enemy = enemyById(id);
        enemy.x = px;
        enemy.y = py;
      });
    },
    setEnemyHp(id, hp) {
      const value = real(hp, "hp");
      pose(() => {
        const enemy = enemyById(id);
        if (value <= 0 || value > enemy.maxHp) {
          invalid("hp must be above 0 and at most the enemy's maxHp");
        }
        enemy.hp = value;
      });
    },
    setEnemyHeading(id, hx, hy) {
      const heading = unit({ x: real(hx, "hx"), y: real(hy, "hy") });
      if (heading === null) invalid("a heading must be a non-zero vector");
      pose(() => {
        enemyById(id).heading = heading;
      });
    },
    setEnemyAge(id, seconds) {
      const value = real(seconds, "seconds", 0);
      pose(() => {
        enemyById(id).age = value;
      });
    },
    setEnemyContactCooldown(id, seconds) {
      const value = real(seconds, "seconds", 0);
      pose(() => {
        enemyById(id).contactCooldown = value;
      });
    },
    removeEnemy(id) {
      pose(() => {
        const enemy = enemyById(id);
        run().enemies = run().enemies.filter(
          (candidate) => candidate !== enemy,
        );
        forgetHits(run(), new Set([enemy.id]));
      });
    },
    clearEnemies() {
      pose(() => {
        const gone = new Set(run().enemies.map((enemy) => enemy.id));
        run().enemies = [];
        forgetHits(run(), gone);
      });
    },

    spawnProjectile(weapon, x, y, vx, vy, pierce) {
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
      pose(() => {
        run().projectiles.push(
          makeProjectile(run(), id, px, py, vxv, vyv, pierce),
        );
      });
    },
    clearProjectiles() {
      pose(() => {
        run().projectiles = [];
      });
    },
    spawnPuddle(weapon, x, y) {
      const id = oneOf(weapon, "weapon", PUDDLE_WEAPONS);
      const px = real(x, "x");
      const py = real(y, "y");
      pose(() => {
        run().zones.push(makePuddle(run(), id, px, py));
      });
    },
    clearZones() {
      pose(() => {
        run().zones = [];
      });
    },

    spawnGem(tier, x, y) {
      const value: GemTier = oneOf(tier, "tier", GEM_TIERS);
      const px = real(x, "x");
      const py = real(y, "y");
      pose(() => {
        const r = run();
        r.gems.push({
          id: r.nextId,
          tier: value,
          x: px,
          y: py,
          attracted: false,
          bornTick: -1,
        });
        r.nextId += 1;
      });
    },
    setGemAttracted(id, attracted) {
      whole(id, "id", 0);
      const value = bool(attracted, "attracted");
      pose(() => {
        const gem = run().gems.find((candidate) => candidate.id === id);
        if (!gem) invalid(`no gem has id ${String(id)}`);
        gem.attracted = value;
      });
    },
    clearGems() {
      pose(() => {
        run().gems = [];
      });
    },
    spawnPickup(kind, x, y) {
      const value: PickupKind = oneOf(kind, "kind", PICKUP_KINDS);
      const px = real(x, "x");
      const py = real(y, "y");
      pose(() => {
        const r = run();
        r.pickups.push({ id: r.nextId, kind: value, x: px, y: py });
        r.nextId += 1;
      });
    },
    clearPickups() {
      pose(() => {
        run().pickups = [];
      });
    },
  };
}

/** Put the surface on `window.__wick`. */
export function installApi(api: WickDebugApi): void {
  (window as unknown as { __wick: WickDebugApi }).__wick = api;
}
