// Floe — one tick, and the frame the ticks are run under.
//
// THE FIXED STEP. `specs/overview.md` fixes the simulation at `TICK_HZ` (`120`)
// steps a second, so one tick is exactly `TICK_DT`. The engine hands each frame a
// delta time in seconds; `advanceFrame` runs the whole ticks that delta completes
// and carries the remainder into the next frame, so the number of ticks run over an
// interval of game time is the same however that interval was divided into frames.
// Every rate in `src/constants.ts` is per second and is integrated against
// `TICK_DT` inside a tick, never against the frame's own delta.
//
// THE ORDER OF A TICK is the order the rules read in:
//
//   1. `simTime` accumulates, on every screen, the paused one included — it is the
//      one quantity a pause does not suspend (`specs/progression.md`).
//   2. Nothing else happens unless the screen is `playing`, and a `paused` screen
//      suspends the whole simulation.
//   3. The strait runs: the lanes advance and the bonus catch keeps its cadence.
//      Both run through every hold as well as through live play.
//   4. The hunt runs: slots fill, bears sense, route and travel, and traffic takes
//      off any bear it has arrived on.
//   5. A hold, where one is running, counts down and hands over when it expires.
//   6. Otherwise the crossing itself: the hop, the carry, the catch, the three
//      hazards, and the crossing timer.
//
// NOTHING HERE READS THE RENDERER OR THE WALL CLOCK, which is what makes the same
// starting state driven by the same calls over the same elapsed game time reach the
// same state every time.

import { CUES, TICK_DT, ROW_BAYS, SCORE_ROW } from "./constants";
import { carryCritter, critterRow, footingOf, hop, sweptOff } from "./critter";
import { stepFish } from "./fish";
import {
  bearsResetByTraffic,
  catcher,
  emergeBears,
  reconcileSlots,
  stepBears,
} from "./hunter";
import { advanceLanes, laneMotion } from "./lanes";
import { endHold, fillBay, loseLife, LUNGE_HOLD } from "./flow";
import { addScore } from "./scoring";
import { anyCoversBody, bayAt } from "./strait";
import { newTickEvents, type Sim, type TickEvents } from "./sim";
import { expired } from "./timing";
import type { CueName } from "./constants";

/** What one frame's ticks left behind, in the order they were raised. */
export interface FrameResult {
  readonly cues: readonly CueName[];
}

/** Whether a vehicle in a moving lane covers the critter's centre. */
function crushed(sim: Sim): boolean {
  const row = critterRow(sim);
  const { speed } = laneMotion(sim, row);
  if (speed <= 0) return false;
  return anyCoversBody(sim.vehicles, row, sim.critter.x);
}

/** Take the hop the frame asked for, where the cadence allows one. */
function stepHop(sim: Sim, dt: number, events: TickEvents): boolean {
  sim.critter.hopCooldown = Math.max(0, sim.critter.hopCooldown - dt);
  const request = sim.request;
  if (request === null) return false;
  if (!expired(sim.critter.hopCooldown)) return false;

  const taken = hop(sim, request);
  if (taken === null) return false;
  events.cues.add(CUES.hop);
  if (taken.newRow) addScore(sim, SCORE_ROW, events);

  // A hop that lands on the bay row landed in an open bay: every other column and
  // every filled bay refuses it (`specs/hopping.md`), so the crossing ends here.
  if (taken.row === ROW_BAYS) {
    const bay = bayAt(taken.col);
    if (bay !== null) {
      fillBay(sim, bay, events);
      return true;
    }
  }
  return false;
}

/** The hunt: emergence, the bears' own tick, and the traffic that resets them. */
function stepHunt(sim: Sim, dt: number): void {
  emergeBears(sim, dt);
  stepBears(sim, dt);
  const struck = bearsResetByTraffic(sim);
  if (struck.length > 0) {
    sim.bears = sim.bears.filter((bear) => !struck.includes(bear.id));
    reconcileSlots(sim);
  }
}

/** One tick of live play, in whichever phase the crossing is in. */
function stepPlaying(sim: Sim, dt: number, events: TickEvents): void {
  advanceLanes(sim, dt);
  stepFish(sim, dt);
  stepHunt(sim, dt);

  if (sim.lunge !== null) {
    sim.lunge.timer -= dt;
    if (expired(sim.lunge.timer)) sim.lunge = null;
  }

  // A hold is running whenever one has time left on it, and a phase that is not
  // `crossing` is on one by definition, so a hold posed with no time left hands
  // over on the next tick rather than wedging the crossing.
  if (sim.phaseTimer > 0 || sim.phase !== "crossing") {
    // Through a hold the critter is out of play, so nothing on the strait can
    // reach it and no hazard is tested.
    sim.phaseTimer = Math.max(0, sim.phaseTimer - dt);
    if (expired(sim.phaseTimer)) endHold(sim);
    return;
  }

  if (stepHop(sim, dt, events)) return;
  carryCritter(sim, dt);

  if (sim.critter.present) {
    const caught = sim.gates.catchTest ? catcher(sim) : undefined;
    if (caught !== undefined) {
      // The bear's lunge outlives the bear: every bear leaves the strait on the
      // tick a life is lost, and the lunge is what is drawn where this one was
      // (`specs/assets.md`).
      sim.lunge = {
        x: caught.x,
        y: caught.y,
        facing: caught.facing,
        timer: LUNGE_HOLD,
      };
      loseLife(sim, CUES.caught, events);
      return;
    }

    if (crushed(sim)) {
      loseLife(sim, CUES.crush, events);
      return;
    }

    if (footingOf(sim) === "water" || sweptOff(sim)) {
      loseLife(sim, CUES.splash, events);
      return;
    }
  }

  // The timer is the fifth thing that costs a life, and the only one with no cue
  // of its own: `specs/ui.md`'s table names none for it.
  if (sim.gates.timerRunning) {
    sim.timer = Math.max(0, sim.timer - dt);
    if (expired(sim.timer)) {
      sim.timer = 0;
      loseLife(sim, null, events);
    }
  }
}

/**
 * One tick of the whole game.
 *
 * `simTime` accumulates whatever the screen is, so a build left alone on the title
 * screen still reports time passing; everything else is the `playing` screen's, and
 * a `paused` screen suspends all of it (`specs/progression.md`).
 */
export function tick(sim: Sim, dt: number, events: TickEvents): void {
  sim.simTime += dt;
  if (sim.screen !== "playing") return;
  sim.animTime += dt;
  stepPlaying(sim, dt, events);
}

/**
 * Advance the game by a frame worth `dt` seconds, and hand back the cues its ticks
 * raised, in order.
 *
 * How much one frame's delta may be worth is the clock's to bound rather than the
 * simulation's: the engine's own wall clock clamps a stalled frame, and a scripted
 * clock is asked for exactly what it delivers.
 */
export function advanceFrame(sim: Sim, dt: number): FrameResult {
  const cues: CueName[] = [];
  sim.frameCarry += Math.max(0, dt);
  while (sim.frameCarry >= TICK_DT) {
    sim.frameCarry -= TICK_DT;
    const events = newTickEvents();
    tick(sim, TICK_DT, events);
    cues.push(...events.cues);
  }
  return { cues };
}
