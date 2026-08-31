// surge/roster — how the six `*-stats` points read one row of the roster table,
// and nothing about what any row holds. CASE-PROVIDED.
//
// specs/surge.md gives each type a row of six columns — HP, Speed, Slowable,
// Flies, Bounty, Leak — and the six `*-stats` points are one row each. Three of
// the columns the unit itself reports, so they are read off a snapshot taken the
// moment it arrives. The other three are BEHAVIOUR and no field carries them: a
// bounty is money paid on the frame a unit's hp reaches `0`, a leak value is lives
// taken on the frame it reaches its exhaust, and slowability is whether a Rime's
// slow touches it at all (specs/economy.md, specs/surge.md, specs/combat.md). Each
// of those is reached the way the game reaches it, and the three arrangements that
// reach them live here.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here; every point states its own beside the figure
// specs/surge.md fixes for it. What the durations below say is how long a drive
// runs, which is geometry, not how far a build may miss a figure by.
//
// EVERY DRIVE POSES ITS OWN FLOOR. Each helper opens with `startRun`, which resets
// the game and leaves an empty, quiet floor (harness.ts), so the four readings a
// row needs cannot contaminate one another: the unit a bounty was read on is gone
// before the unit a leak is read on arrives.
//
// Local to this group on purpose. Nothing outside `surge/` reads a roster row.

import { COLS, RIGHT_EXHAUST_ROWS } from "../../src/constants";
import { tileCentre } from "../geometry";
import {
  posePinnedTower,
  poseTarget,
  poseWalker,
  startRun,
  ticksFor,
  towerOf,
  unitOf,
  type Harness,
  type SurgeType,
  type UnitSnapshot,
} from "../harness";

/* ---- What the unit itself reports ---------------------------------------- */

/**
 * Pose one unit of `type` at the left vent on Wave 1 and hand back what it
 * reported the moment it arrived.
 *
 * WAVE 1 IS WHAT MAKES THE HP COLUMN READABLE. specs/waves.md scales a unit's
 * maximum hp by `1 + 0.62 * (w - 1)`, which is exactly `1` on Wave 1, so the
 * `maxHp` a Wave 1 arrival reports is the base hp specs/surge.md's table gives it
 * and nothing else. `startRun` opens on Wave 1.
 *
 * THE READING IS TAKEN BEFORE A FRAME RUNS, because the row is about the unit the
 * vent released rather than about the unit a second of walking left behind. The
 * one frame that follows is for the evidence picture alone, and locomotion is held
 * for it so the picture shows the arrival.
 */
export async function readArrival(
  h: Harness,
  type: SurgeType,
): Promise<UnitSnapshot> {
  startRun(h);
  const id = poseWalker(h, type, "left");
  const arrived = unitOf(h.snapshot(), id);
  h.debug.setUnitMotion(id, false);
  await h.advance(1);
  return arrived;
}

/* ---- The bounty ---------------------------------------------------------- */

/** The Arc's footprint top-left: open floor, well clear of every opening. */
const GUN = { col: 20, row: 10 } as const;

/**
 * The tile the mark stands on: three tiles right of the gun's anchor, so it is off
 * the footprint and comfortably inside both the Arc's `6.0`-tile and the Rime's
 * `5.5`-tile range, measured from the footprint's centre (specs/combat.md,
 * specs/towers.md).
 */
const MARK = { col: 23, row: 10 } as const;

/**
 * The hp a mark that is meant to die is posed with: the least a live unit can
 * carry.
 *
 * The smallest possible target is what makes the kill follow from the shot landing
 * rather than from any figure specs/combat.md gives the shot, so a build whose
 * damage or fire rate is off still reaches the death these readings are taken
 * across.
 */
const MARK_HP = 1;

/**
 * How long a kill is waited for: six seconds of game time.
 *
 * Geometry rather than a tolerance. An Arc at its specified `2.0` shots per second
 * lands its first shot half a second in (specs/combat.md), so six seconds is a
 * dozen intervals and a build firing far slower still removes a single hp inside
 * the window.
 */
const KILL_TICKS = ticksFor(6);

/**
 * Kill one unit of `type` with an Arc and hand back the money that death paid.
 *
 * The floor holds one gun and one mark and nothing else, so the only event that
 * can move the money is the one death. The Arc's thermal model is held, so the
 * heat that scales its damage cannot move and no trip can interrupt the drive
 * (specs/instrumentation.md); the mark holds its tile, so it dies to the shot
 * rather than walking out of range or reaching an exhaust and leaking, which pays
 * a different figure entirely.
 *
 * The phase is `building`, which is what keeps the reading to one figure: a wave
 * clears only while the phase is `wave` (specs/waves.md), so no clear bonus can
 * land in the same window.
 *
 * `killed` is handed back so a point can state, as its precondition, that the
 * event it is reading actually happened.
 */
export async function bountyPaidFor(
  h: Harness,
  type: SurgeType,
): Promise<{ paid: number; killed: boolean }> {
  startRun(h);
  posePinnedTower(h, "arc", GUN.col, GUN.row, 0);
  poseTarget(h, type, MARK.col, MARK.row, MARK_HP);

  const before = h.snapshot().money;
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: KILL_TICKS,
    poll: 4,
  });
  return { paid: h.snapshot().money - before, killed: swept.hit };
}

/* ---- The leak ------------------------------------------------------------ */

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row the
 * opening covers.
 *
 * specs/floor.md puts the right exhaust on tiles `(49, 16)` through `(49, 19)`,
 * and a unit entering at the left vent is assigned the right exhaust for its whole
 * life. So a walker posed here has one tile to travel and reaches its exhaust in a
 * fraction of a second, which keeps the reading off the walk across the floor
 * specs/mazing.md already decides.
 */
const LEAK_TILE = {
  col: COLS - 2,
  row: RIGHT_EXHAUST_ROWS[1],
} as const;

/**
 * How long a leak is waited for: four seconds of game time.
 *
 * Geometry rather than a tolerance. The slowest type in the roster is the Core at
 * its specified `30` logical units per second, which covers the one `TILE` (`19`)
 * it has left in under two thirds of a second, so four seconds carries a build
 * walking at a sixth of that speed out through the opening.
 */
const LEAK_TICKS = ticksFor(4);

/**
 * Walk one unit of `type` out through its exhaust and hand back the lives that
 * leak took.
 *
 * The floor is empty but for the leaker, so nothing can damage it and the only way
 * it can leave the roster is by reaching its exhaust. Nothing is posed beyond the
 * entry and the position: its locomotion is on and its route is recomputed from
 * the tile the position falls in (specs/instrumentation.md), so the walk out is
 * the game's own.
 *
 * The phase is `building`, so no wave clear can fire on the same frame and take
 * the reading somewhere else.
 */
export async function livesLostTo(
  h: Harness,
  type: SurgeType,
): Promise<{ lost: number; leaked: boolean; gone: boolean }> {
  startRun(h);
  const id = poseWalker(h, type, "left");
  const at = tileCentre(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(id, at.x, at.y);

  const before = h.snapshot().lives;
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: LEAK_TICKS,
    poll: 2,
  });
  const after = h.snapshot();
  return {
    lost: before - after.lives,
    leaked: swept.hit,
    gone: !after.surge.some((unit) => unit.id === id),
  };
}

/* ---- Slowability --------------------------------------------------------- */

/**
 * How long a Rime is left to work: two and a half seconds of game time.
 *
 * Geometry rather than a tolerance. A Rime at its specified `2.4` shots per second
 * lands its first shot a shade past four tenths of a second (specs/combat.md) and
 * a slow lasts `SLOW_TIME` (`1.5`) seconds from the moment it is applied, so a
 * window of two and a half seconds holds several shots and closes while the last
 * one's slow is still live — whether or not a build's fire clock keeps exactly to
 * the specified rate.
 */
const SLOW_TICKS = ticksFor(2.5);

/**
 * Fire a cold Rime at one unit of `type` and report whether the slow touched it.
 *
 * specs/combat.md: "On the frame a Rime's shot resolves it applies a slow to its
 * target, when the target is slowable", and a Rime at heat `0` and level I applies
 * `0.55` — the strongest slow in the game, so a build that applies any slow at all
 * applies one here. Nothing in this reading depends on how strong it is: what is
 * read back is the `slowed` flag, which is the specification's own word for the
 * column.
 *
 * The Rime's thermal model is held at heat `0` (specs/instrumentation.md), so the
 * slow it applies cannot fade as it heats and it cannot trip mid-window. The mark
 * holds its tile so it stays in range, and carries an hp ceiling far past anything
 * a window of shots removes, so what is read is the slow rather than the moment
 * the mark died.
 *
 * `struck` is handed back so a point can state, as its precondition, that the
 * Rime's shot actually landed — without it, "not slowed" would be the reading a
 * silent tower gives as readily as an immune unit.
 */
export async function slowTouches(
  h: Harness,
  type: SurgeType,
): Promise<{ slowed: boolean; struck: boolean }> {
  startRun(h);
  const rime = posePinnedTower(h, "rime", GUN.col, GUN.row, 0);
  const mark = poseTarget(h, type, MARK.col, MARK.row);

  await h.advance(SLOW_TICKS);

  const settled = h.snapshot();
  return {
    slowed: unitOf(settled, mark).slowed,
    struck: towerOf(settled, rime).damageDealt > 0,
  };
}
