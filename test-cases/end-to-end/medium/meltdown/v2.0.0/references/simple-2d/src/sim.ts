// Meltdown — one frame of the simulation, in the order the specification fixes.
//
// The release runs first, so a unit released this frame walks this frame; the
// surge moves and whatever reached its exhaust leaves; the emitters pick their
// targets off the floor as it now stands and resolve their shots; and only then
// does the heat pass run, because it needs the frame's shot counts and because
// specs/heat.md computes every term from the heats the frame OPENED with.
//
// The wave-clear transition is last, because it asks whether the frame's last
// unit went.

import { resolveCombat } from "./combat";
import { resolveHeat } from "./heat";
import { routesOf } from "./routes";
import { resolveWaveClear, stepRelease, type RunEvents } from "./run";
import { stepSurge } from "./surge";
import type { MeltdownState } from "./game";

/** The ten cues a frame may raise, one flag each. */
export interface FrameEvents extends RunEvents {
  fire: boolean;
  trip: boolean;
  death: boolean;
  leak: boolean;
  place: boolean;
  sell: boolean;
  menu: boolean;
}

/** A frame that has raised nothing yet. */
export function noEvents(): FrameEvents {
  return {
    fire: false,
    trip: false,
    death: false,
    leak: false,
    place: false,
    sell: false,
    waveClear: false,
    victory: false,
    gameOver: false,
    menu: false,
  };
}

/**
 * Advance the simulation by `dt` seconds of GAME time, which is the frame's
 * elapsed time multiplied by the game speed. A frame with `dt` of `0` still
 * refreshes each tower's target and `firing` flag, which is what makes a posed
 * floor readable without stepping it far.
 */
export function stepSimulation(
  state: MeltdownState,
  dt: number,
  events: FrameEvents,
): MeltdownState {
  const released = stepRelease(state, dt);
  const routes = routesOf(released.towers);

  const moved = stepSurge(released.surge, routes, dt);
  if (moved.leaked) events.leak = true;
  const afterLeaks: MeltdownState = {
    ...released,
    surge: moved.surge,
    lives: released.lives - moved.livesLost,
  };

  const combat = resolveCombat(
    afterLeaks.towers,
    afterLeaks.surge,
    routes,
    dt,
    afterLeaks.money,
    afterLeaks.score,
  );
  if (combat.fired) events.fire = true;
  if (combat.died) events.death = true;

  const heat = resolveHeat(combat.towers, combat.shots, dt);
  if (heat.tripped) events.trip = true;

  const settled: MeltdownState = {
    ...afterLeaks,
    towers: heat.towers,
    surge: combat.surge,
    money: combat.money,
    score: combat.score,
  };

  return resolveWaveClear(settled, moved.leaked || combat.died, events);
}
