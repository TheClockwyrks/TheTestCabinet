// instrumentation/helpers — what the points of this category share: the
// documented snapshot shape as field lists, the idle run of specs/state.md as a
// value, a busy posed night for the points that read the whole state back, and
// the two readings of the debug overlay. CASE-PROVIDED.
//
// No review item names this file. Everything here is either a restatement of a
// spec table (the field lists, the idle run) or a compound pose built from the
// atomic operations of the surface, which the authoring guide has live beside
// the checks rather than inside any one of them.

import { assertDeepEqual } from "../assert";
import { BASE_MAX_HP, MOVE_SPEED, PICKUP_RADIUS, XP_BASE } from "../constants";
import {
  endDawn,
  endFallen,
  freshRun,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  openLevelUp,
  poseScene,
  spawnEnemyAt,
  spawnGemAt,
  spawnPickupAt,
  textReadings,
  type Harness,
  type IsolateOptions,
  type Screen,
  type WickSnapshot,
} from "../harness";
import type { RunSnapshot } from "../surface";

/* -------------------------------------------------------------------------- */
/* The snapshot shape, as specs/instrumentation.md lists it                   */
/* -------------------------------------------------------------------------- */

/** The top-level fields of the "Snapshot shape" block, in its order. */
export const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "menuIndex",
  "almanacTab",
  "almanacScroll",
  "spawning",
  "events",
  "despawning",
  "enemyMotion",
  "enemyContact",
  "weaponFire",
  "effectMotion",
  "drops",
  "progression",
  "run",
  "muted",
  "accumulator",
  "simTime",
] as const;

/** The fields of `run`, in the block's order. */
export const RUN_FIELDS = [
  "tick",
  "time",
  "level",
  "xp",
  "xpToNext",
  "kills",
  "player",
  "hurtFlash",
  "maxHp",
  "armor",
  "moveSpeed",
  "pickupRadius",
  "weapons",
  "passives",
  "enemies",
  "projectiles",
  "zones",
  "gems",
  "pickups",
  "offers",
  "pool",
  "nextOffers",
  "pendingLevelUps",
  "chestResult",
  "spawnTimer",
  "spawnWindow",
  "firedEvents",
  "aliveCommons",
  "nextId",
  "nextSpawnAngle",
  "nextSwarmAngle",
  "nextSpawnType",
  "nextPuddleOffset",
  "nextStrikeTarget",
  "nextChestItem",
  "nextDrop",
] as const;

export const PLAYER_FIELDS = ["x", "y", "facing", "hp"] as const;
export const WEAPON_FIELDS = ["id", "level", "cooldown"] as const;
export const PASSIVE_FIELDS = ["id", "level"] as const;
export const ENEMY_FIELDS = [
  "id",
  "type",
  "x",
  "y",
  "hp",
  "maxHp",
  "heading",
  "age",
  "contactCooldown",
] as const;
export const PROJECTILE_FIELDS = [
  "id",
  "weapon",
  "x",
  "y",
  "vx",
  "vy",
  "ax",
  "ay",
  "radius",
  "damage",
  "ttl",
  "pierce",
  "hits",
] as const;
export const ZONE_FIELDS = [
  "id",
  "weapon",
  "kind",
  "x",
  "y",
  "radius",
  "damage",
  "ttl",
  "hits",
] as const;
export const GEM_FIELDS = ["id", "tier", "x", "y", "attracted"] as const;
export const PICKUP_FIELDS = ["id", "kind", "x", "y"] as const;
export const HIT_FIELDS = ["enemy", "cooldown"] as const;

/**
 * The screens that show no menu, on which `menuIndex` "stays 0" (specs/ui.md,
 * Menu navigation). `paused` shows `PAUSE_ITEMS` and `almanac` shows its entry
 * rows, so both carry a menu.
 */
export const MENU_FREE_SCREENS = ["howto", "playing", "chest"] as const;

/**
 * The screens `menuRects` reports nothing on: "`playing` reports an empty
 * list" (specs/instrumentation.md, Menus).
 */
export const RECTLESS_SCREENS = ["playing"] as const;

/**
 * The two screens with no menu that answer one rectangle each: "`howto` and
 * `chest` report exactly one rectangle, the area the screen's way out is taken
 * in" (specs/instrumentation.md, Menus).
 */
export const ONE_BOX_SCREENS = ["howto", "chest"] as const;

/**
 * The nine screens of specs/ui.md, each reached THROUGH THE SURFACE ALONE, so a
 * build whose menus cannot be walked still answers for what a screen reports.
 * `title`, `howto`, `almanac`, `playing`, and `paused` are the atomic
 * `setScreen`; `levelup`, `chest`, `fallen`, and `dawn` are the screens the
 * game's own systems open, so each is reached by the sequence that opens it.
 */
export const SCREEN_ROUTES: readonly [Screen, (h: Harness) => Promise<void>][] =
  [
    ["title", async (on) => on.reset()],
    ["howto", async (on) => void poseScene(on, "howto")],
    ["almanac", async (on) => void poseScene(on, "almanac")],
    ["playing", async (on) => void freshRun(on)],
    [
      "levelup",
      async (on) => {
        freshRun(on);
        await openLevelUp(on, 1);
      },
    ],
    [
      "chest",
      async (on) => {
        freshRun(on);
        await openChest(on);
      },
    ],
    [
      "paused",
      async (on) => {
        freshRun(on);
        on.debug.setScreen("paused");
      },
    ],
    [
      "fallen",
      async (on) => {
        freshRun(on);
        await on.tick(RUN_TICKS);
        await endFallen(on);
      },
    ],
    [
      "dawn",
      async (on) => {
        freshRun(on);
        await on.tick(RUN_TICKS);
        await endDawn(on);
      },
    ],
  ];

/** The ticks a run screen's route runs before the ending it is reached by. */
export const RUN_TICKS = 3;

/**
 * The run clock a route leaves on `fallen`: `RUN_TICKS` plus the one tick the
 * `hp` at `0` ends the run on.
 */
export const FALLEN_TICK = RUN_TICKS + 1;

/* -------------------------------------------------------------------------- */
/* The idle run                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The idle run of specs/state.md, "The idle run", with every derived field the
 * snapshot adds computed from those values by the formulas of
 * specs/instrumentation.md: `time` 0, `xpToNext` XP_BASE, `maxHp` BASE_MAX_HP,
 * `armor` 0, `moveSpeed` MOVE_SPEED, `pickupRadius` PICKUP_RADIUS,
 * `spawnWindow` 0, `aliveCommons` 0, and `pool` empty off `levelup`.
 */
export const IDLE_RUN: RunSnapshot = {
  tick: 0,
  time: 0,
  level: 1,
  xp: 0,
  xpToNext: XP_BASE,
  kills: 0,
  player: { x: 0, y: 0, facing: "right", hp: BASE_MAX_HP },
  hurtFlash: 0,
  maxHp: BASE_MAX_HP,
  armor: 0,
  moveSpeed: MOVE_SPEED,
  pickupRadius: PICKUP_RADIUS,
  weapons: [],
  passives: [],
  enemies: [],
  projectiles: [],
  zones: [],
  gems: [],
  pickups: [],
  offers: [],
  pool: [],
  nextOffers: null,
  pendingLevelUps: 0,
  chestResult: null,
  spawnTimer: 0,
  spawnWindow: 0,
  firedEvents: [],
  aliveCommons: 0,
  nextId: 0,
  nextSpawnAngle: null,
  nextSwarmAngle: null,
  nextSpawnType: null,
  nextPuddleOffset: null,
  nextStrikeTarget: null,
  nextChestItem: null,
  nextDrop: null,
};

/**
 * A fresh run: "the idle run with Taper at level 1 and cooldown 0 in the first
 * weapon slot" (specs/state.md).
 */
export const FRESH_RUN: RunSnapshot = {
  ...IDLE_RUN,
  weapons: [{ id: "taper", level: 1, cooldown: 0 }],
};

/** `run` is the idle run, field for field. */
export function assertIdleRun(run: RunSnapshot, context: string): void {
  assertDeepEqual(run, IDLE_RUN, context);
}

/** `run` is a fresh run, field for field. */
export function assertFreshRun(run: RunSnapshot, context: string): void {
  assertDeepEqual(run, FRESH_RUN, context);
}

/* -------------------------------------------------------------------------- */
/* A busy posed night                                                         */
/* -------------------------------------------------------------------------- */

/** The ids the busy night handed out, so a check can address one entity. */
export interface BusyNight {
  moth: number;
  gnat: number;
  wisp: number;
  hound: number;
  bolt: number;
  dart: number;
  shard: number;
  puddle: number;
  gems: number[];
  pickups: number[];
  /** The slot Halo took, whose aura the first tick places. */
  haloSlot: number;
  /** The slot Ember took, with a posed cooldown counting. */
  emberSlot: number;
}

/** The figures the busy night poses, each distinctive enough to read back. */
export const BUSY = {
  level: 7,
  xp: 12,
  hp: 43,
  kills: 321,
  playerX: 40,
  playerY: -25,
  spawnTimer: 0.7,
  emberLevel: 6,
  emberCooldown: 0.75,
  tallowLevel: 2,
  brassLevel: 1,
} as const;

/**
 * Pose an isolated night holding one of everything the snapshot reports: a
 * disturbed lamplighter and progression, two weapons and two passives, four
 * enemies of three behaviors, three projectiles of three weapons (one with
 * infinite pierce sitting on the hound, so a tick leaves it a `hits` entry),
 * a puddle, three gems, and the three pickups, every one placed clear of the
 * lamplighter so nothing is collected and no contact lands. Every switch is
 * off, so a tick run after it changes only what a check turns on.
 *
 * Halo's aura is placed by the first `playing` tick under the placement rule,
 * not by the pose: a check that needs the aura in the snapshot runs one tick.
 */
export function poseBusyNight(
  h: Harness,
  options: IsolateOptions = {},
): BusyNight {
  isolate(h, { level: BUSY.level, ...options });
  h.debug.setPlayerPosition(BUSY.playerX, BUSY.playerY);
  h.debug.setFacing("left");
  h.debug.setXp(BUSY.xp);
  h.debug.setKills(BUSY.kills);
  h.debug.setSpawnTimer(BUSY.spawnTimer);
  const haloSlot = holdWeapon(h, "halo", 1);
  const emberSlot = holdWeapon(h, "ember", BUSY.emberLevel);
  h.debug.setWeaponCooldown(emberSlot, BUSY.emberCooldown);
  holdPassive(h, "tallow", BUSY.tallowLevel);
  holdPassive(h, "brass", BUSY.brassLevel);
  // After Tallow, so the value sits below the maxHp then in force.
  h.debug.setHp(BUSY.hp);

  const { x, y } = h.snapshot().run.player;
  const moth = spawnEnemyAt(h, "moth", x + 200, y);
  const gnat = spawnEnemyAt(h, "gnat", x - 300, y + 100);
  const wisp = spawnEnemyAt(h, "wisp", x, y + 250);
  const hound = spawnEnemyAt(h, "hound", x + 400, y + 400);

  const bolt = h.snapshot().run.nextId;
  h.debug.spawnProjectile("ember", x + 100, y, 400, 0, 0);
  const dart = h.snapshot().run.nextId;
  h.debug.spawnProjectile("pin", x - 100, y, -600, 0, 1);
  const shard = h.snapshot().run.nextId;
  h.debug.spawnProjectile("shard", x + 400, y + 400, 500, 0, -1);

  const puddle = h.snapshot().run.nextId;
  h.debug.spawnPuddle("oil-splash", x + 150, y + 150);

  const gems = [
    spawnGemAt(h, "small", x + 500, y),
    spawnGemAt(h, "medium", x, y + 500),
    spawnGemAt(h, "large", x - 500, y),
  ];
  const pickups = [
    spawnPickupAt(h, "bread", x + 600, y + 600),
    spawnPickupAt(h, "draft", x - 600, y + 600),
    spawnPickupAt(h, "chest", x + 600, y - 600),
  ];

  return {
    moth,
    gnat,
    wisp,
    hound,
    bolt,
    dart,
    shard,
    puddle,
    gems,
    pickups,
    haloSlot,
    emberSlot,
  };
}

/**
 * `run` with the three fields the clock derives dropped, so a check about
 * "nothing else changes" compares everything but them.
 */
export function withoutClock(
  run: RunSnapshot,
): Omit<RunSnapshot, "tick" | "time" | "spawnWindow"> {
  const { tick: _tick, time: _time, spawnWindow: _window, ...rest } = run;
  return rest;
}

/**
 * `snapshot` with `simTime` dropped: the one field that rises on every frame
 * whatever the screen, so two readings taken a frame apart compare on the
 * rest.
 */
export function withoutSimTime(
  snapshot: WickSnapshot,
): Omit<WickSnapshot, "simTime"> {
  const { simTime: _simTime, ...rest } = snapshot;
  return rest;
}

/* -------------------------------------------------------------------------- */
/* The debug overlay                                                          */
/* -------------------------------------------------------------------------- */
//
// specs/instrumentation.md (Diagnostics): the overlay "shows the values the
// game registers with it as diagnostic sources", and "Drawing the panel,
// toggling it with the backtick key (KeyboardEvent.code Backquote), and
// keeping it read-only are the engine's". The one honest way to read the panel
// is the way a person does, off what the frame DRAWS, so the readings below
// take the text a frame paints and compare frames with and without the panel.
// Nothing here fixes where the panel sits or how a line is worded.

/**
 * Every string the next frame draws, read both ways: the raw calls, then the
 * logical runs they spell (`textReadings`). The runs, so a panel a build
 * letter-spaces still reads as the lines it spells; the raw calls as well, so
 * a value drawn a narrow gap after its label, which the run rule merges into
 * one word, still stands alone as a token. The readings below diff two frames
 * read the same way, so a line the panel adds is in the difference whichever
 * way it was read, and match tokens on what is left.
 */
export async function frameText(h: Harness): Promise<string[]> {
  const { calls } = await h.frameDraw();
  return textReadings(calls);
}

/**
 * The lines two frames agree on: what a stretch of the panel reports STABLY,
 * with anything that changes frame to frame (the engine's own frame metrics)
 * dropped.
 */
export function stableLines(
  a: readonly string[],
  b: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
  const stable: string[] = [];
  for (const line of a) {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      stable.push(line);
    }
  }
  return stable;
}
