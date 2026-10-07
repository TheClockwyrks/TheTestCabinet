// Meltdown — one drive that reaches every one of the ten cues. GROUP-LOCAL.
//
// `audio/mute-silences` is the one point in this group whose requirement spans
// all ten cues — "with muted true, none of the ten cues emits anything" — so it
// needs a drive that reaches all ten. This is that drive, and nothing else uses
// it: the other eleven points each reach one event and read one frame.
//
// EVERY EVENT HERE IS REACHED THE WAY A PLAYER REACHES IT, for the reason
// `specs/instrumentation.md` gives: no operation of the debug surface plays a
// cue and none can. So the shop entry is pressed, the key is tapped, the emitter
// runs its own fire clock and its own heat model, and the unit walks into its own
// exhaust. What is posed is the floor each of those happens on.
//
// THE BLOCKS ARE INDEPENDENT. Each opens with `startRun` or `resetTo`, which
// empties both rosters and gives every declared field back, so a block cannot
// inherit a floor from the one before it. `reset` leaves the mute bit exactly as
// it stands (`specs/instrumentation.md`), which is what lets one drive run start
// to finish on either side of the bit.
//
// THIS ASSERTS NOTHING about the build. It drives, and the point that calls it
// compares what the two sides of the mute bit produced.

import { fail } from "../assert";
import {
  footprintCenter,
  poseTarget,
  posePinnedTower,
  poseTower,
  pressAt,
  resetTo,
  shopEntry,
  startRun,
  tapAction,
  tapControl,
  ticksFor,
  towerById,
  type Harness,
} from "../harness";
import { poseLeaker } from "./cues";

/**
 * The ceiling every sweep below runs under.
 *
 * Each of these events lands inside a second on a conforming build — a Mote walks
 * one tile in `0.32` s, an Arc's first shot lands `0.5` s after it acquires, a
 * Stutter posed at heat `90` crosses `100` in about half a second. Five seconds
 * is a hard ceiling several times over: a build that is merely slow is caught by
 * the point that owns that event rather than stalling this one.
 */
const SWEEP_TICKS = ticksFor(5);

/** The tile the towers of this drive stand on: quiet floor, off every opening. */
const TOWER = { col: 10, row: 10 } as const;

/** The tile a target stands on, inside every emitter's level I range (specs/towers.md). */
const TARGET = { col: 13, row: 10 } as const;

/** The tile the placed-and-sold tower is aimed at. */
const BUILD_AT = { col: 10, row: 5 } as const;

/** Heat posed below the `100` the trip crosses at, so the crossing is the build's. */
const POSED_HEAT = 90;

/** An hp pool no emitter empties inside `SWEEP_TICKS`, so a target stays a target. */
const DEEP_HP = 1_000_000;

/**
 * Drive every one of the ten events `specs/audio.md` names a cue for, in seven
 * blocks: a menu move; a placement and a sale; a shot and the kill it lands; a
 * trip; a leak and the wave it clears; a victory; a loss.
 */
export async function driveEveryCue(h: Harness): Promise<void> {
  await driveMenu(h);
  await drivePlaceAndSell(h);
  await driveFireAndDeath(h);
  await driveTrip(h);
  await driveLeakAndClear(h);
  await driveVictory(h);
  await driveGameOver(h);
}

/** `menu`: the highlight moved by the real `down` binding (specs/screens.md). */
async function driveMenu(h: Harness): Promise<void> {
  resetTo(h);
  await tapAction(h, "down");
}

/** `place` and `sell`: a pointer placement, then `KeyS` on it (specs/building.md). */
async function drivePlaceAndSell(h: Harness): Promise<void> {
  startRun(h);
  const entry = shopEntry(h.snapshot(), "arc");
  if (entry === undefined) {
    fail(
      "the panel to report a shop entry for the Arc, which is what a " +
        "placement is armed through (specs/hud.md)",
      "controls.shop carries no Arc entry",
    );
  }
  await tapControl(h, entry);
  const centre = footprintCenter("arc", BUILD_AT.col, BUILD_AT.row);
  await pressAt(h, centre.x, centre.y);

  const towers = h.snapshot().towers;
  if (towers.length === 0) {
    fail(
      "the press on a valid footprint to have built a tower, so there is one " +
        "to sell (specs/building.md, Placing)",
      "the tower roster is empty",
    );
  }
  h.debug.setSelected(towers[towers.length - 1].id);
  await tapAction(h, "sell");
}

/** `fire` and `death`: one shot, on a target one hp from gone (specs/combat.md). */
async function driveFireAndDeath(h: Harness): Promise<void> {
  startRun(h);
  posePinnedTower(h, "arc", TOWER.col, TOWER.row, 0);
  poseTarget(h, "mote", TARGET.col, TARGET.row, 1);
  await h.until((s) => s.surge.length === 0, { maxFrames: SWEEP_TICKS });
}

/** `trip`: a Stutter's own shots carrying its own heat over `100` (specs/heat.md). */
async function driveTrip(h: Harness): Promise<void> {
  startRun(h);
  const stutter = poseTower(h, "stutter", TOWER.col, TOWER.row, 0);
  h.debug.setTowerHeat(stutter, POSED_HEAT);
  poseTarget(h, "mote", TARGET.col, TARGET.row, DEEP_HP);
  await h.until((s) => towerById(s, stutter)?.tripped === true, {
    maxFrames: SWEEP_TICKS,
  });
}

/** `leak` and `wave-clear`: the wave's last unit walking out (specs/waves.md). */
async function driveLeakAndClear(h: Harness): Promise<void> {
  startRun(h);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  poseLeaker(h);
  const opened = h.snapshot();
  await h.until((s) => s.wave > opened.wave, { maxFrames: SWEEP_TICKS });
}

/** `victory`: the run's final wave clearing with lives in hand (specs/waves.md). */
async function driveVictory(h: Harness): Promise<void> {
  startRun(h);
  h.debug.setWave(h.snapshot().waveCount);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  poseLeaker(h);
  await h.until((s) => s.screen === "victory", { maxFrames: SWEEP_TICKS });
}

/** `game-over`: a real leak taking the last life (specs/waves.md). */
async function driveGameOver(h: Harness): Promise<void> {
  startRun(h);
  h.debug.setLives(1);
  poseLeaker(h);
  await h.until((s) => s.screen === "gameover", { maxFrames: SWEEP_TICKS });
}
