// audio — the one drive that reaches every one of the ten cues' events.
//
// WHY IT IS A MODULE. Two items are read over the same drive and neither is the
// other's: `audio.mute-silences` asks that a muted build make no sound through
// it, and `audio.mute-changes-nothing-else` asks that every event it carries
// still resolves. Writing the drive twice would let the two drift apart, and the
// claim each item makes is only comparable with the other while the drive is
// literally the same one.
//
// ALL TEN CUES' EVENTS ARE DRIVEN, because both items say all ten. Seven drives
// cover them: a menu highlight moving, a tower placed, a tower sold, a shot that
// kills (`fire` and `death` on one frame), an emitter carried over `100` by its
// own gun (`fire` and `trip`), a final wave's unit walking out (`leak`,
// `wave-clear` and `victory` on one frame), and a leak that takes the last life
// (`leak` and `game-over`). Every one of them is reached on the REAL path the
// matching point of this group reaches it on — real keys and a real mouse through
// Chromium's own pipeline, real shots, a real trip, a real send, real leaks —
// because `specs/instrumentation.md` says no operation of the debug surface plays
// a cue, so a posed event would be silent for the wrong reason.
//
// WHAT IT HANDS BACK. Every reading either item needs: whether each drive hit
// what it was driving at, and the snapshot after each of them. Neither the drive
// nor this module asserts anything — a shared module that carried a verdict would
// put one item's claim inside the other's.

import {
  framesFor,
  posePinnedTower,
  poseTarget,
  poseTower,
  poseWalker,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";
import {
  MIN_HEAT_MULT,
  SURGE_DEFS,
  TOWER_DEFS,
  footprintCentre,
  isEmitter,
  milestoneWaves,
  modeFigures,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  SHOT_CEILING,
  TRIP_CEILING,
  armFromShop,
  frameWhere,
  leakOut,
  mousePress,
  moveHighlight,
  poseAtExhaustDoor,
  releaseAndLeak,
  sellSelected,
} from "./cues";

/** The run every stage is posed on: the default row `startRun` uses. */
export const MODE = "containment" as const;
export const DIFFICULTY = "medium" as const;

/** The last wave of that run, which `specs/waves.md` wins on (`specs/modes.md`). */
export const FINAL_WAVE = milestoneWaves(
  modeFigures(MODE, DIFFICULTY).waveCount,
)[1];

/** The type placed and sold, and what a fresh one refunds (`specs/towers.md`). */
export const BUILT = "arc" as const;
const BUILT_SIZE = TOWER_DEFS[BUILT].size;
export const BUILT_COST = TOWER_DEFS[BUILT].cost;

/** What one Arc shot removes at heat `0`: `6 * 0.35` (`specs/combat.md`). */
const PER_SHOT_DAMAGE = (() => {
  const def = TOWER_DEFS[BUILT];
  return isEmitter(def) ? def.baseDamage * MIN_HEAT_MULT : 0;
})();

/** The hp the killed target is posed with: inside one shot's worth. */
const KILL_HP = PER_SHOT_DAMAGE / 2;

/** Where a target stands: inside the Arc's and the Stutter's range, off both corridors. */
const TARGET_TILE = { col: 8, row: 5 } as const;

/** The unit walked out in the last stage, and what its escape costs. */
export const LEAK_TYPE = "mote" as const;
const LEAK_VENT = "left" as const;
export const LEAK_COST = SURGE_DEFS[LEAK_TYPE].leak;

/** Quiet play driven after each event, so a late blip is still caught. */
const SETTLE_FRAMES = framesFor(0.25);

/** What one stage of the drive left behind: did it hit, and what the game read. */
export interface Stage {
  hit: boolean;
  snapshot: MeltdownSnapshot;
}

/** Every reading the drive hands back, stage by stage. */
export interface Drive {
  /** The menu highlight moving on the title screen. */
  moved: Stage;
  /** The money the run held before the placement. */
  moneyBefore: number;
  /** The preview held after the shop press. */
  armed: MeltdownSnapshot;
  /** The frame after the placement landed. */
  placed: MeltdownSnapshot;
  /** The sale of the same tower. */
  sold: Stage;
  /** The shot that took its target to `0` hp, and the gun that took it. */
  kill: Stage;
  gun: number;
  /** The emitter carried over `100` by its own gun. */
  trip: Stage;
  tripped: number;
  /** The final wave's unit walking out: a leak, a clear and a win. */
  won: Stage;
  /** The leak that took the last life. */
  lost: Stage;
}

/**
 * Drive every one of the ten cues' events, in order, on the game `h` holds.
 *
 * The harness is left on the game-over screen the last stage opens, so a caller
 * that wants a picture of a running floor poses one of its own afterwards.
 */
export async function driveEveryCue(h: Harness): Promise<Drive> {
  /* -- A menu highlight moving, on the title the game opened on -------------- */
  const moved = await moveHighlight(h);
  await h.advance(SETTLE_FRAMES);
  const afterMove = await h.snapshot();

  /* -- A tower placed, by a real press on the reported shop entry ------------ */
  await startRun(h, MODE, DIFFICULTY);
  const armed = await armFromShop(h, BUILT);
  const moneyBefore = armed.snapshot.money;
  const site = footprintCentre(FREE_SITE.col, FREE_SITE.row, BUILT_SIZE);
  await mousePress(h, site.x, site.y);
  await h.advance(SETTLE_FRAMES);
  const afterPlace = await h.snapshot();

  /* -- The same tower sold, by the key specs/controls.md binds sell to ------- */
  const built = afterPlace.towers[0];
  await h.debug.setSelected(built.id);
  const sold = await sellSelected(h);
  await h.advance(SETTLE_FRAMES);
  const afterSell = await h.snapshot();

  /* -- A shot that takes its target to 0 hp --------------------------------- */
  await startRun(h, MODE, DIFFICULTY);
  const pinned = await posePinnedTower(
    h,
    BUILT,
    FREE_SITE.col,
    FREE_SITE.row,
    0,
  );
  await poseTarget(h, "mote", TARGET_TILE.col, TARGET_TILE.row, KILL_HP);
  const kill = await frameWhere(
    h,
    (snapshot) => snapshot.surge.length === 0,
    SHOT_CEILING,
    "the kill",
  );
  await h.advance(SETTLE_FRAMES);
  const afterKill = await h.snapshot();

  /* -- An emitter carrying its own heat over 100 ---------------------------- */
  await startRun(h, MODE, DIFFICULTY);
  const stutter = await poseTower(h, "stutter", FREE_SITE.col, FREE_SITE.row);
  await poseTarget(h, "mote", TARGET_TILE.col, TARGET_TILE.row);
  const trip = await frameWhere(
    h,
    (snapshot) => requireTower(snapshot, stutter, "the trip").tripped,
    TRIP_CEILING,
    "the trip",
  );
  await h.advance(SETTLE_FRAMES);
  const afterTrip = await h.snapshot();

  /* -- The final wave's unit walking out: a leak, a clear and a win --------- */
  await startRun(h, MODE, DIFFICULTY);
  await h.debug.setWave(FINAL_WAVE);
  const won = await releaseAndLeak(h, 0);
  await h.advance(SETTLE_FRAMES);
  const afterWin = await h.snapshot();

  /* -- A leak that takes the last life ------------------------------------- */
  await startRun(h, MODE, DIFFICULTY);
  await h.debug.setLives(LEAK_COST);
  const walker = await poseWalker(h, LEAK_TYPE, LEAK_VENT);
  const entered = requireUnit(await h.snapshot(), walker, "the walker");
  await poseAtExhaustDoor(h, walker, entered.exhaust);
  const lost = await leakOut(h, "the closing leak");
  await h.advance(SETTLE_FRAMES);
  const afterLoss = await h.snapshot();

  return {
    moved: { hit: moved.hit, snapshot: afterMove },
    moneyBefore,
    armed: armed.snapshot,
    placed: afterPlace,
    sold: { hit: sold.hit, snapshot: afterSell },
    kill: { hit: kill.hit, snapshot: afterKill },
    gun: pinned,
    trip: { hit: trip.hit, snapshot: afterTrip },
    tripped: stutter,
    won: { hit: won.leak.hit, snapshot: afterWin },
    lost: { hit: lost.hit, snapshot: afterLoss },
  };
}
