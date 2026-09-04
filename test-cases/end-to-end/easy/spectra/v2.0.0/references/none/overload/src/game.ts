// Spectra — the game itself: the state, the frame, and the rules under it.
//
// This is the one file that owns THE ORDER OF A FRAME, and everything it does is
// stated in `specs/simulation.md`:
//
//   * an update covering `dt` seconds is divided into `n = max(1, ceil(dt /
//     SUBSTEP_MAX))` sub-steps of `h = dt / n` seconds each;
//   * the sub-steps run in order, and each advances every moving thing by
//     `p += v * h` and then resolves contacts.
//
// EVERYTHING THAT CHANGES WITH TIME CHANGES INSIDE THAT LOOP — every clock, every
// timer, every position, every burst. Nothing is integrated once per frame outside
// it. That is the whole reason `advance(1, 1)`, `advance(1, 60)` and `advance(1,
// 120)` all run exactly a hundred and twenty sub-steps of a hundred-and-twentieth
// of a second and reach the IDENTICAL state, which is what
// `specs/instrumentation.md` means by a deterministic core.
//
// INTENT IS READ ONCE PER FRAME and handed to the loop: a hold applies in every
// sub-step, and an edge is cleared by the first sub-step that acts on it, so one
// press of the fire key is one bullet however the frame was divided.
//
// CUES ARE RAISED IN THE SUB-STEPS AND FLUSHED ONCE, which is `specs/ui.md`'s rule
// that a frame plays each raised cue at most once.

import { CueQueue, defineCues } from "./audio";
import {
  ACTIONS,
  BINDINGS,
  CUES,
  DEFAULT_SEED,
  DIVE_FIRST_DELAY,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  INVERSION_TIME,
  START_LIVES,
  SUBSTEP_MAX,
} from "./constants";
import { resolveContacts } from "./combat";
import { crossedInvertLine, advanceBandClock, fireDiveShots } from "./drones";
import { removeDroneById } from "./entities";
import { LANE_CENTER } from "./field";
import { noIntents, readIntents, type Intents } from "./input";
import { registerDiagnostics } from "./diagnostics";
import { releaseDischarge, stepDischarge } from "./resonance";
import { render } from "./render";
import { flip, fire, moveShip, tickCannon } from "./ship";
import { closeStageIfWaveGone } from "./stages";
import { applyPointer, pause, updateScreen } from "./screens";
import {
  advanceDiveClock,
  beginDive,
  crossedFireLine,
  currentSway,
  releaseEntryGroups,
  returnPath,
  travelSpeed,
  enterPhase,
} from "./swarm";
import { stepBursts, useBurstSystem } from "./bursts";
import type { Sprites } from "./assets";
import type { CueSink } from "./audio";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";
import type { Drone, SpectraState } from "./types";

/** How far past an edge of the stage a bullet may drift before it is dropped. */
const BULLET_MARGIN = 40;

/** The title-screen state, as a run has never been played. */
export function freshState(seed = DEFAULT_SEED): SpectraState {
  return {
    screen: "title",
    phase: "live",
    phaseTimer: 0,
    menuIndex: 0,
    score: 0,
    lives: START_LIVES,
    stage: 1,
    extraLifeAwarded: false,
    challengeHits: 0,
    resonance: 0,
    inversion: 0,
    ship: {
      x: LANE_CENTER,
      band: "cyan",
      lockout: 0,
      cooldown: 0,
      contact: true,
    },
    discharge: { active: false, elapsed: 0, radius: 0 },
    drones: [],
    bullets: [],
    bursts: [],
    waveEntry: true,
    diveLaunching: true,
    entryClock: 0,
    swayClock: 0,
    diveClock: 0,
    nextDiveGap: DIVE_FIRST_DELAY,
    waveOpen: false,
    simTime: 0,
    muted: false,
    rngState: seed >>> 0,
    nextId: 1,
  };
}

/**
 * Restore every declared field of `state` to its title-screen value, in place.
 *
 * What `reset(options)` does. `muted` is left exactly as it stands, because muting
 * is a player preference the runtime owns, and the clock is untouched: `reset` is
 * about the game, not about who is stepping it.
 */
export function resetState(state: SpectraState, seed = DEFAULT_SEED): void {
  const fresh = freshState(seed);
  const muted = state.muted;
  Object.assign(state, fresh);
  state.muted = muted;
}

/** Build the game the runtime drives, bound to the decoded seeded art. */
export function createGame(sprites: Sprites): Game<SpectraState> {
  return {
    initialize(api: InitApi): SpectraState {
      for (const action of ACTIONS)
        api.input.register(action, BINDINGS[action]);
      defineCues(api);
      useBurstSystem(sprites.burst);
      const state = freshState();
      registerDiagnostics(api, state);
      return state;
    },

    update(state: SpectraState, api: UpdateApi, dt: number): void {
      // Mute is read on every screen and toggles the runtime's own bit; the game
      // holds a copy of it, refreshed here in every update.
      const intents = readIntents(api, state.screen);
      if (intents.mute) api.audio.setMuted(!api.audio.muted());
      state.muted = api.audio.muted();

      const cues = new CueQueue();
      const steps = Math.max(1, Math.ceil(dt / SUBSTEP_MAX));
      const h = dt / steps;
      const live = { ...intents };
      const opened = state.screen;
      for (let index = 0; index < steps; index += 1) {
        subStep(state, live, cues, Number.isFinite(h) ? h : 0);
      }
      // The pointer and the touch contacts are read once per frame and applied
      // after the frame's keyboard edges (specs/ui.md).
      applyPointer(state, api, opened, cues);
      cues.flush((cue) => api.audio.play(cue));
    },

    render(state: SpectraState, api: RenderApi): void {
      render(state, api.ctx, sprites);
    },
  };
}

/** Clear every edge, so a press acts in one sub-step and not in the next. */
function consumeEdges(intents: Intents): void {
  for (const action of ACTIONS) {
    if (action === "left" || action === "right" || action === "a") continue;
    intents[action] = false;
  }
}

/** One sub-step of `h` seconds: advance everything, then resolve contacts. */
export function subStep(
  state: SpectraState,
  intents: Intents,
  cues: CueSink,
  h: number,
): void {
  // `simTime` accumulates the time the sub-steps cover, whatever the screen.
  state.simTime += h;
  updateScreen(state, intents, cues, h);
  if (state.screen === "inWave") simulate(state, intents, cues, h);
  consumeEdges(intents);
}

/** The live wave: the ship, the swarm, the wave's clocks, and every contact. */
function simulate(
  state: SpectraState,
  intents: Intents,
  cues: CueSink,
  h: number,
): void {
  if (intents.pause) {
    pause(state);
    return;
  }

  tickCannon(state, h);
  if (state.inversion > 0) state.inversion = Math.max(0, state.inversion - h);

  // The ship answers to nothing while the phase is `ready`: it is not alive, and
  // `specs/progression.md` gives the beat back to the player when the hold ends.
  if (state.phase === "live") {
    moveShip(state, intents.left, intents.right, h);
    if (intents.b) flip(state, cues);
    if (intents.discharge && releaseDischarge(state))
      cues.raise(CUES.discharge);
    if (intents.a) fire(state, cues);
  }

  // The wave's own three schedules. The sway clock is the seconds the wave has been
  // played; the entry clock releases groups; the dive clock launches dives.
  state.swayClock += h;
  releaseEntryGroups(state, h);
  advanceDiveClock(state, h);

  const retired: number[] = [];
  for (const drone of state.drones)
    advanceDrone(state, drone, h, cues, retired);
  if (retired.length > 0) {
    for (const id of retired) removeDroneById(state, id);
    closeStageIfWaveGone(state, cues);
  }

  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * h;
    bullet.y += bullet.vy * h;
  }

  stepDischarge(state, h);
  stepBursts(state, h);
  resolveContacts(state, cues);
  pruneBullets(state);
}

/** Advance one drone's phase, its locomotion, its rhythm and its fire. */
function advanceDrone(
  state: SpectraState,
  drone: Drone,
  h: number,
  cues: CueSink,
  retired: number[],
): void {
  drone.phaseTime += h;
  // The band clock is gated by `oscillation` alone, so it runs on whatever the
  // drone's travel and fire gates are doing.
  advanceBandClock(state, drone, h);

  // Travel off holds the drone's exact centre and keeps its phase: nothing is
  // cancelled, completed or resolved early.
  if (!drone.travel) return;

  switch (drone.phase) {
    case "entering":
      advanceEntering(state, drone, h, retired);
      return;
    case "formation":
      drone.x = drone.slotX + currentSway(state);
      drone.y = drone.slotY;
      return;
    case "diving":
      advanceDiving(state, drone, h, cues);
      return;
    case "returning":
      advanceReturning(state, drone, h);
      return;
  }
}

/** Travel one entrance, or one challenge flyover, forward. */
function advanceEntering(
  state: SpectraState,
  drone: Drone,
  h: number,
  retired: number[],
): void {
  // A drone whose group the wave has not released yet holds its starting point.
  if (!drone.released || drone.path === null) return;
  drone.pathDist += travelSpeed(state, drone) * h;
  const point = drone.path.at(drone.pathDist);
  drone.x = point.x;
  drone.y = point.y;
  if (drone.pathDist < drone.path.length) return;
  if (drone.challenge) {
    // A challenge drone never settles into a slot: it sweeps across and leaves.
    retired.push(drone.id);
    return;
  }
  drone.path = null;
  enterPhase(drone, "formation");
  drone.x = drone.slotX + currentSway(state);
  drone.y = drone.slotY;
}

/** Travel one dive forward, taking its shots and inverting the field if it can. */
function advanceDiving(
  state: SpectraState,
  drone: Drone,
  h: number,
  cues: CueSink,
): void {
  // A dive posed through the debug surface arrives with no path: the phase is a
  // pose of one field, and the dive's own path code runs from there.
  if (drone.path === null) beginDive(state, drone);
  if (drone.path === null) return;
  const previousY = drone.y;
  drone.pathDist += travelSpeed(state, drone) * h;
  const point = drone.path.at(drone.pathDist);
  drone.x = point.x;
  drone.y = point.y;

  // The first shot leaves in the frame the centre first crosses the fire line; a
  // shimmering Flux carries the intent until it settles.
  if (crossedFireLine(previousY, drone.y)) drone.fireArmed = true;
  if (drone.fireArmed) fireDiveShots(state, drone);

  // A Prism that gets to the bottom swaps the whole field's bands rather than
  // being destroyed there, and heads back toward its slot.
  if (crossedInvertLine(drone, previousY, drone.y)) {
    drone.invertedThisDive = true;
    state.inversion = INVERSION_TIME;
    cues.raise(CUES.inversion);
    enterPhase(drone, "returning");
    drone.path = returnPath(
      { x: drone.x, y: drone.y },
      drone.slotX,
      drone.slotY,
    );
    return;
  }

  if (drone.pathDist >= drone.path.length) {
    enterPhase(drone, "returning");
    drone.path = returnPath(
      { x: drone.x, y: drone.y },
      drone.slotX,
      drone.slotY,
    );
  }
}

/** Travel one return home forward. */
function advanceReturning(state: SpectraState, drone: Drone, h: number): void {
  if (drone.path === null) {
    drone.path = returnPath(
      { x: drone.x, y: drone.y },
      drone.slotX,
      drone.slotY,
    );
  }
  drone.pathDist += travelSpeed(state, drone) * h;
  const point = drone.path.at(drone.pathDist);
  drone.x = point.x;
  drone.y = point.y;
  if (drone.pathDist < drone.path.length) return;
  drone.path = null;
  enterPhase(drone, "formation");
  drone.x = drone.slotX + currentSway(state);
  drone.y = drone.slotY;
}

/**
 * Drop every bullet that has left the play field.
 *
 * `specs/field.md` names the two edges that matter: a player bullet whose centre
 * climbs above `FIELD_TOP`, and an enemy bullet whose centre falls below
 * `FIELD_BOTTOM`. A bullet carried off the side — which only an overloaded Flux's
 * fanned spray can be — is dropped at the same margin, so no roster grows without
 * bound.
 */
function pruneBullets(state: SpectraState): void {
  state.bullets = state.bullets.filter((bullet) => {
    if (bullet.friendly && bullet.y < FIELD_TOP) return false;
    if (!bullet.friendly && bullet.y > FIELD_BOTTOM) return false;
    if (bullet.x < FIELD_LEFT - BULLET_MARGIN) return false;
    if (bullet.x > FIELD_RIGHT + BULLET_MARGIN) return false;
    return true;
  });
}

/** An intent record with nothing held, for a caller that drives no input. */
export { noIntents };
