// Kessler — the screens wrapped around the simulation (specs/screens.md).
//
// The engine holds the whole game as one value, `KesslerState`, and every
// frame is a transition over it. This module declares that state and owns the
// transitions the screens are made of: the routing of one action to what it
// does on the screen the game is on, the tick accumulator that consumes a
// frame's seconds into whole ticks, the session lifecycle (a fresh session on
// START, the discard on QUIT), the 180-tick wave-clear interstitial, the
// seeded pod stream's carried state, and the two driver switches. Only
// `playing` advances the simulation; `waveclear` advances its interstitial
// and nothing else; the other four freeze everything.
//
// Because a `DeepReadonly` view is all anything is handed, a transition first
// takes one mutable working copy with `cloneState` and runs the ported tick
// pipeline (`src/sim.ts`) over that draft — the draft is this frame's next
// state under construction, never the value the engine holds. The pure
// wrappers at the bottom are that pattern packaged for the debug surface and
// the tests. Nothing here reads the wall clock, the keyboard, or the canvas;
// cues and particle spawns go out through the `FlowIo` hooks.

import type { DeepReadonly } from "ts-essentials";
import type { KesslerAssets } from "./assets";
import {
  DEFAULT_SEED,
  INTERSTITIAL_TICKS,
  PAUSE_MENU,
  TICK_DT,
  TITLE_MENU,
  type Action,
  type Cue,
  type ParticleSystem,
  type ScreenName,
} from "./figures";
import { seedRngState, stepRng } from "./rng";
import { launchParkedBall, tickPlaying, type TickIo } from "./sim";
import {
  bootSession,
  clearVolatiles,
  layOutWave,
  parkFreshBall,
  type Session,
} from "./state";

/**
 * What the flow asks of the layers around it: a cue played on its event and a
 * particle system spawned at a stage point. Structural on purpose — `update`
 * hands in the engine's cue bus and the fx pool, and a test hands in a
 * recorder.
 */
export interface FlowIo {
  /** Play a one-shot cue now. */
  cue(cue: Cue): void;
  /** Spawn a particle system instance at a stage point now. */
  particle(system: ParticleSystem, x: number, y: number): void;
}

/** Hooks that do nothing, for poses and tests that listen to neither. */
export const SILENT: FlowIo = {
  cue: () => undefined,
  particle: () => undefined,
};

/** The rotation actions' held values, sampled once per frame. */
export interface Held {
  readonly left: boolean;
  readonly right: boolean;
}

/** Neither rotation action held. */
export const NO_HELD: Held = { left: false, right: false };

// ---- The state contract --------------------------------------------------

/** The whole authoritative state the engine holds, replaced every frame. */
export interface KesslerState {
  /** The screen the game is on; a build opens on `title`. */
  screen: ScreenName;
  /** The highlighted menu entry; `0` on a screen with no menu. */
  menuIndex: number;
  /** Ticks resolved since the last reset, on every screen. */
  ticks: number;
  /**
   * Ticks of *simulation* time resolved since the last reset — the ticks the
   * `playing` screen advanced on. The ball sprite's spin runs on this clock
   * (`specs/assets.md`), so it holds exactly where a pause left it while
   * `ticks` keeps counting the frozen screens' resolved ticks.
   */
  simTicks: number;
  /** Unconsumed game time carried between updates, in seconds. */
  accumulator: number;
  /** The seed the pod stream reseeds from at each session start. */
  seed: number;
  /** The pod stream's whole state (`src/rng.ts`); draws alone advance it. */
  rngState: number;
  /** Ticks left on the wave-clear interstitial while on `waveclear`. */
  interstitialTicks: number;
  /** The `waveAdvance` driver switch; on when the game is played. */
  waveAdvance: boolean;
  /** The `podSpawn` driver switch; on when the game is played. */
  podSpawn: boolean;
  /**
   * The delta time the most recent `update` was handed, in seconds. The live
   * particle effects advance on it when `render` composites them
   * (`specs/assets.md`).
   */
  lastFrameDt: number;
  /** The session in play, or the boot layout behind the title screen. */
  session: Session;
  /** The produced sprites, loaded once and carried by reference. */
  assets: KesslerAssets;
}

/** The read-only view every reader of the state is handed. */
export type View = DeepReadonly<KesslerState>;

/**
 * The slack the accumulator allows a tick boundary. A second delivered as
 * sixty updates of a sixtieth each sums to a hair under a second in binary
 * floating point, and it must resolve the same sixty ticks a second
 * delivered whole does. Far smaller than any interval a caller can mean.
 */
const TICK_EPSILON = 1e-9;

/**
 * The boot state (`specs/instrumentation.md` `reset`): the title screen over
 * the boot layout, zero ticks, both driver switches on, and the pod stream
 * seeded with `seed`.
 */
export function bootState(
  assets: KesslerAssets,
  seed: number = DEFAULT_SEED,
): KesslerState {
  return {
    screen: "title",
    menuIndex: 0,
    ticks: 0,
    simTicks: 0,
    accumulator: 0,
    seed,
    rngState: seedRngState(seed),
    interstitialTicks: 0,
    waveAdvance: true,
    podSpawn: true,
    lastFrameDt: 0,
    session: bootSession(),
    assets,
  };
}

/**
 * One mutable working copy of `view` — this frame's next state under
 * construction. The session is copied deeply so the ported tick pipeline may
 * write into it; the loaded sprites are immutable and shared by reference.
 */
export function cloneState(view: View): KesslerState {
  return {
    screen: view.screen,
    menuIndex: view.menuIndex,
    ticks: view.ticks,
    simTicks: view.simTicks,
    accumulator: view.accumulator,
    seed: view.seed,
    rngState: view.rngState,
    interstitialTicks: view.interstitialTicks,
    waveAdvance: view.waveAdvance,
    podSpawn: view.podSpawn,
    lastFrameDt: view.lastFrameDt,
    session: cloneSession(view.session),
    assets: view.assets,
  };
}

function cloneSession(session: DeepReadonly<Session>): Session {
  return {
    score: session.score,
    lives: session.lives,
    wave: session.wave,
    paddleAngleDeg: session.paddleAngleDeg,
    rings: session.rings.map((ring) => ({
      angleDeg: ring.angleDeg,
      speedDegPerSec: ring.speedDegPerSec,
      targets: [...ring.targets],
    })),
    balls: session.balls.map((ball) => ({ ...ball })),
    pods: session.pods.map((pod) => ({ ...pod })),
    effects: { ...session.effects },
  };
}

// ---- Screen transitions over the draft -----------------------------------

/** Enters `screen` with its top menu entry highlighted. */
function enter(draft: KesslerState, screen: ScreenName): void {
  draft.screen = screen;
  draft.menuIndex = 0;
}

/**
 * Starts a fresh session exactly as confirming START does: the boot layout
 * with a ball parked on the deflector, the pod stream reseeded from the
 * session's seed, and the game on `playing`.
 */
export function startFreshSession(draft: KesslerState): void {
  draft.session = bootSession();
  draft.rngState = seedRngState(draft.seed);
  parkFreshBall(draft.session, draft.simTicks);
  enter(draft, "playing");
}

/** Discards the session exactly as QUIT does and returns to the title. */
function discardSession(draft: KesslerState): void {
  draft.session = bootSession();
  enter(draft, "title");
}

/**
 * Enters the wave-clear interstitial as the clearing event enters it:
 * balls, pods, timed effects, and the shield are removed and a fresh
 * interstitial begins for the wave the counter holds.
 */
export function enterWaveclear(draft: KesslerState): void {
  draft.session.balls = [];
  clearVolatiles(draft.session);
  draft.interstitialTicks = INTERSTITIAL_TICKS;
  enter(draft, "waveclear");
}

/**
 * The interstitial's lapse: every slot refills, ring angles reset, the wave
 * number rises by one with the new wave's figures in force, a ball parks,
 * and play resumes (`specs/rings.md`).
 */
function beginNextWave(draft: KesslerState): void {
  layOutWave(draft.session, draft.session.wave + 1);
  parkFreshBall(draft.session, draft.simTicks);
  enter(draft, "playing");
}

/**
 * Enters a screen exactly as the real transition into it does, with the
 * entering menu highlighting its top entry and no cue sounding
 * (`specs/instrumentation.md`'s `setScreen` table).
 */
export function poseScreenDraft(draft: KesslerState, name: ScreenName): void {
  switch (name) {
    case "playing":
      startFreshSession(draft);
      break;
    case "waveclear":
      enterWaveclear(draft);
      break;
    case "title":
      discardSession(draft);
      break;
    default:
      enter(draft, name);
      break;
  }
}

// ---- Actions (specs/controls.md routes them; specs/screens.md answers) ---

/** One press edge of `action`, routed to the screen the draft is on. */
export function handleActionDraft(
  draft: KesslerState,
  action: Action,
  io: FlowIo,
): void {
  switch (draft.screen) {
    case "title":
      menuAction(draft, action, TITLE_MENU.length, io, (index) => {
        if (index === 0) startFreshSession(draft);
        else enter(draft, "howto");
      });
      break;
    case "howto":
      if (action === "confirm" || action === "back") enter(draft, "title");
      break;
    case "playing":
      if (action === "launch") launchParkedBall(draft.session);
      else if (action === "back" || action === "pause") enter(draft, "paused");
      break;
    case "waveclear":
      break;
    case "paused":
      if (action === "back" || action === "pause") {
        enter(draft, "playing");
        break;
      }
      menuAction(draft, action, PAUSE_MENU.length, io, (index) => {
        if (index === 0) enter(draft, "playing");
        else discardSession(draft);
      });
      break;
    case "gameover":
      if (action === "confirm") discardSession(draft);
      break;
  }
}

/** The shared menu behavior: wrap-around movement and confirm. */
function menuAction(
  draft: KesslerState,
  action: Action,
  entries: number,
  io: FlowIo,
  accept: (index: number) => void,
): void {
  if (action === "up" || action === "down") {
    const delta = action === "down" ? 1 : -1;
    draft.menuIndex = (draft.menuIndex + delta + entries) % entries;
    io.cue("menu-move");
  } else if (action === "confirm") {
    io.cue("menu-select");
    accept(draft.menuIndex);
  }
}

// ---- Time ----------------------------------------------------------------

/** The `TickIo` one tick of the draft reads and raises. */
function tickIo(draft: KesslerState, held: Held, io: FlowIo): TickIo {
  return {
    held: { left: held.left, right: held.right },
    rng: () => {
      const step = stepRng(draft.rngState);
      draft.rngState = step.state;
      return step.value;
    },
    podSpawn: draft.podSpawn,
    waveAdvance: draft.waveAdvance,
    tickIndex: draft.simTicks,
    cue: (cue) => io.cue(cue),
    particle: (system, x, y) => io.particle(system, x, y),
  };
}

/** Resolves one whole tick of the screen the draft is on. */
export function tickDraft(draft: KesslerState, held: Held, io: FlowIo): void {
  draft.ticks += 1;
  if (draft.screen === "playing") {
    draft.simTicks += 1;
    const outcome = tickPlaying(draft.session, tickIo(draft, held, io));
    if (outcome.clearedWave !== null) {
      enterWaveclear(draft);
    } else if (outcome.gameOver) {
      enter(draft, "gameover");
      io.cue("game-over");
    }
  } else if (draft.screen === "waveclear") {
    draft.interstitialTicks -= 1;
    if (draft.interstitialTicks <= 0) {
      beginNextWave(draft);
    }
  }
}

/**
 * Consumes `dtSeconds` of game time into whole ticks over the draft,
 * carrying the remainder, so a second of game time is sixty ticks however it
 * was divided into frames.
 */
export function consumeTime(
  draft: KesslerState,
  dtSeconds: number,
  held: Held,
  io: FlowIo,
): void {
  draft.accumulator += dtSeconds;
  while (draft.accumulator >= TICK_DT - TICK_EPSILON) {
    draft.accumulator -= TICK_DT;
    tickDraft(draft, held, io);
  }
}

// ---- Pure wrappers, for the debug surface and the tests ------------------

/** The next state one routed press edge leaves. */
export function applyAction(
  view: View,
  action: Action,
  io: FlowIo = SILENT,
): KesslerState {
  const draft = cloneState(view);
  handleActionDraft(draft, action, io);
  return draft;
}

/** The next state `dtSeconds` of game time leaves. */
export function advanceTime(
  view: View,
  dtSeconds: number,
  held: Held = NO_HELD,
  io: FlowIo = SILENT,
): KesslerState {
  const draft = cloneState(view);
  consumeTime(draft, dtSeconds, held, io);
  return draft;
}

/** The next state `count` whole ticks leave, with no accumulator involved. */
export function advanceTicks(
  view: View,
  count: number,
  held: Held = NO_HELD,
  io: FlowIo = SILENT,
): KesslerState {
  const draft = cloneState(view);
  for (let i = 0; i < count; i += 1) tickDraft(draft, held, io);
  return draft;
}

/** The next state entering `name` leaves (`setScreen`). */
export function poseScreen(view: View, name: ScreenName): KesslerState {
  const draft = cloneState(view);
  poseScreenDraft(draft, name);
  return draft;
}

/** The boot state restored over the same loaded sprites (`reset`). */
export function resetState(view: View, seed: number): KesslerState {
  return bootState(cloneState(view).assets, seed);
}
