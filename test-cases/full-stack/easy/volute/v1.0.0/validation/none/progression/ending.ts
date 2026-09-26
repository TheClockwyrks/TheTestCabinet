// progression/ending — the ended run every dismissal point is read off.
//
// WHAT THEY ALL DECIDE. `specs/progression.md` — "Interludes and endings": "An
// ending holds until it is dismissed, and dismissing it returns the game to the
// title screen with every value of a fresh run restored." That is a dozen
// separate requirements — the holding, the press on each device that leaves it,
// and each value a fresh run holds — and each one is a point of its own, because
// a build that returns to the title carrying the ended run's score has to grade
// differently from one that never leaves `gameover` at all. What they share is
// the ended run they are read off, which is here.
//
// THE ENDING IS POSED, NOT DRIVEN. `specs/instrumentation.md` has `setScreen`
// change "nothing else: no level is opened, no channel is seeded, no timer is
// started, and no interlude is set", so the hall stands on `gameover` carrying
// exactly the run posed around it. Reaching the ending by spending three cells
// instead would make every point here fail whenever `progression/game-over`'s own
// requirement failed.
//
// EVERY FIGURE STANDS AWAY FROM THE VALUE A FRESH RUN HOLDS, or a point would
// pass on a build that restores nothing. `specs/state.md` fixes what a fresh
// run holds — "score `0`, level `1`, three cells, the level's full quota still
// to emit, pressure `0`, chain step `1`, no machinery, an empty channel, no
// projectiles, an aim of `270` degrees" — and the pose below puts each of them
// somewhere else through the single-field poses the surface carries for
// exactly that. The cells are posed at `0` because that is how a run ends: "A
// spend that takes the count to 0 ends the run in place of restarting the
// level."
//
// A SIGHTLINE IS THE MACHINERY LEFT STANDING, at 12 s the longest of the three
// timed kinds and the one that leaves the feed speed alone, so it is certainly
// still in force at the press and changes nothing else about the hall.
//
// NOTHING ADVANCES UNDER AN ENDING. `specs/ui.md` has the simulation advance on
// `playing`, `cleared` and `setback` alone, so the ticks a point steps on
// `gameover` move no core and run no timer: what changes is what the press
// changed.

import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  poseHall,
  pressConfirm,
  spacedBlock,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/** The level the ended run stood on, so "level `1`" is a reading and not a default. */
export const ENDED_LEVEL = 3;

/** The score the ended run carried, so "score `0`" is a reading and not a default. */
export const ENDED_SCORE = 1240;

/** The pressure the ended run carried. */
export const ENDED_PRESSURE = 40;

/** A chain step above the 1 a fresh run holds. */
export const ENDED_CHAIN_STEP = 4;

/** A quota below the 45 level 1's full value leaves, so "refilled" is readable. */
export const ENDED_QUOTA = 20;

/** An aim far from the opening 270 degrees. */
export const ENDED_AIM = 30;

/** Cores left standing on the channel of the ended run, and where their head is. */
export const ENDED_CORE_COUNT = 4;
export const ENDED_HEAD_S = 1200;

/** The timed kind left in force across the press; 12 s outlasts the drive. */
export const STANDING_MACHINERY = "sightline" as const;

/** A second of play before a press, which is what "holds" is read over. */
export const HOLD_TICKS = TICK_HZ;

/** Ticks recorded after a press, so a clip shows the title it returned to. */
export const SETTLE_TICKS = 20;

/** The hall as the ending was posed, and the hall the press left. */
export interface Dismissal {
  /** The ended run, read before any tick ran. */
  readonly posed: VoluteSnapshot;
  /** The tick the confirm press ran. */
  readonly title: VoluteSnapshot;
}

/**
 * Pose an ended run on `gameover`, with every fresh-run figure moved off its
 * value, and read it back.
 *
 * The reading is what lets a point assert its figure really stood somewhere else
 * first. Nothing here decides an outcome: what a point reads afterwards comes
 * from the tick the press runs.
 */
export async function poseEnding(h: Harness): Promise<VoluteSnapshot> {
  await poseHall(h, {
    screen: "gameover",
    level: ENDED_LEVEL,
    score: ENDED_SCORE,
    cells: 0,
    quotaRemaining: ENDED_QUOTA,
    pressure: ENDED_PRESSURE,
    chainStep: ENDED_CHAIN_STEP,
    aim: ENDED_AIM,
    cores: spacedBlock(ENDED_HEAD_S, ENDED_CORE_COUNT, "halide"),
    machinery: STANDING_MACHINERY,
  });
  const posed = await h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the ending was posed on");
  return posed;
}

/** Pose the ended run and dismiss it with the confirm control. */
export async function dismissEnding(h: Harness): Promise<Dismissal> {
  const posed = await poseEnding(h);
  const title = await pressConfirm(h);
  return { posed, title };
}
