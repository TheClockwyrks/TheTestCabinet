// Volute — the game the engine drives: the state, the three functions, and the
// debug surface `initialize` returns beside the state.
//
// The engine owns the frame loop, the canvas fit, the keyboard and the pointer,
// the audio bus, asset loading, and the overlay (specs/overview.md "The
// runtime"). What is left is here and in the modules beside it: the simulation
// (`sim.ts`, `train.ts`, `level.ts`, `channel.ts`, `rng.ts`), the picture
// (`render.ts`, `hud.ts`, `fx.ts`, `theme.ts`), the produced files
// (`assets.ts`, `audio.ts`), the overlay's values (`diagnostics.ts`), and the
// debug surface (`debug.ts`).
//
// THE STATE IS HELD BY VALUE. The engine replaces it with whatever `update`
// returns, and every reader is handed it as `DeepReadonly<VoluteState>`, so
// nothing here writes into the state it was given: a frame thaws it into a
// working draft, runs the simulation over the draft, and returns the frozen
// result (`draft.ts`).
//
// THE SIMULATION ADVANCES IN WHOLE TICKS. The engine measures the frame and hands
// `update` its delta in seconds; the delta accumulates in `accumulator`, whole
// `TICK_DT` ticks are consumed, and the remainder waits for the next frame. So an
// interval of game time reaches the same state however it was divided into
// frames, and a scenario stepped with `engine.advance` over a `ConstantClock`
// runs the very same ticks the wall clock would have run.
//
// THE CONTROLS ARE READ ONCE PER UPDATE, which is the grain the engine delivers
// an edge at, and the ticks that follow are what the request rides into
// (specs/controls.md).

import type { Game, UpdateApi } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  ACTIONS,
  BINDINGS,
  CUES,
  DEFAULT_SEED,
  LOOPING_CUES,
  TICK_DT,
} from "./constants";
import type { ChargeId, MachineryKind, Point, ScreenName } from "./constants";
import { emptyAssets, loadAssets, type Assets } from "./assets";
import { bindCues } from "./audio";
import { createDebugApi, type PosedCore, type VoluteSnapshot } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { freeze, thaw, type Draft } from "./draft";
import { newReport, type TickReport } from "./events";
import { Effects } from "./fx";
import { createDraft } from "./level";
import { renderFrame, resetPatternCache } from "./render";
import {
  advancesSimulation,
  inDanger,
  readControls,
  stepTick,
  type Controls,
} from "./sim";
import { COLOR } from "./theme";

/* -------------------------------------------------------------------------- */
/* The state (specs/state.md)                                                 */
/* -------------------------------------------------------------------------- */

export type { ChargeId, MachineryKind, ScreenName };

/** One core standing on the channel. */
export interface CoreState {
  /** The charge it carries. */
  readonly charge: ChargeId;
  /** Its arc position, the distance from the inlet walked along `CHANNEL`. */
  readonly s: number;
  /** The machinery extracting it grants, and `null` on an unmarked core. */
  readonly mark: MachineryKind | null;
}

/** One segment: a maximal run of cores exactly one spacing apart. */
export interface SegmentState {
  /** How many consecutive cores of `cores` the segment covers, at least `1`. */
  readonly count: number;
  /** The seconds of recoil hold it has left; `0` on a segment that advances. */
  readonly hold: number;
}

/** One core in flight, between the injector and what it meets. */
export interface ProjectileState {
  /** The charge it carries and seats. */
  readonly charge: ChargeId;
  /** Its center, in logical units. */
  readonly x: number;
  readonly y: number;
  /** The heading it was fired along, in degrees, in `[0, 360)`. */
  readonly angle: number;
}

/** The timed machinery in force. */
export interface MachineryState {
  /** `choke`, `backflow`, or `sightline`; `bore` resolves at once. */
  readonly kind: MachineryKind;
  /** The seconds it has left, counting down to `0`. */
  readonly remaining: number;
}

/** The whole of Volute's state. */
export interface VoluteState {
  /** The screen currently shown. */
  readonly screen: ScreenName;

  /** The run's score. */
  readonly score: number;
  /** The level in play, from `1` to `LEVEL_COUNT`. */
  readonly level: number;
  /** The cells remaining, from `CELLS` down to `0`. */
  readonly cells: number;
  /** How many more cores the inlet emits this level. */
  readonly quotaRemaining: number;

  /** The pressure, from `PRESSURE_MIN` to `PRESSURE_MAX`. */
  readonly pressure: number;
  /** The chain step an extraction scores at, at least `1`. */
  readonly chainStep: number;
  /** The seconds left before `chainStep` returns to `1`. */
  readonly chainTimer: number;
  /** The timed machinery in force, and `null` when none is. */
  readonly machinery: MachineryState | null;

  /** The train, head first, so `s` descends along the list. */
  readonly cores: readonly CoreState[];
  /** The train's segments, the lead segment first. */
  readonly segments: readonly SegmentState[];
  /** The projectiles, oldest first. */
  readonly projectiles: readonly ProjectileState[];

  /** The charge the injector fires next; `null` while no level is open. */
  readonly loaded: ChargeId | null;
  /** The charge that becomes `loaded` on the next firing. */
  readonly queued: ChargeId | null;
  /** The direction the injector points, in degrees, in `[0, 360)`. */
  readonly aim: number;
  /** The seconds until the injector may fire again. */
  readonly fireCooldown: number;

  /** The seconds left of the interlude `cleared` and `setback` hold. */
  readonly interlude: number;
  /** The simulation time the run has accumulated, in seconds. */
  readonly simTime: number;
  /** The frame time waiting for the next whole tick, in `[0, TICK_DT)`. */
  readonly accumulator: number;
  /** The game's readable copy of the engine's mute bit. */
  readonly muted: boolean;
  /** The state of the game's one seeded generator. */
  readonly rngState: number;
}

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md)                               */
/* -------------------------------------------------------------------------- */

/**
 * The debugging and automation surface, returned beside the state as
 * `[state, debug]` and handed back by `engine.debug`.
 *
 * Every operation is a READING or a POSE, written in the shape of `update`: each
 * takes the current state as `DeepReadonly<VoluteState>` and either returns the
 * next `VoluteState` or returns what it read. A caller drives a pose through
 * `engine.apply((s) => debug.start(s))` and a reading against `engine.state`, as
 * `debug.snapshot(engine.state)`.
 */
export interface VoluteDebugApi {
  /** `VOLUTE_DEBUG_VERSION`. */
  readonly version: number;

  /** Restore every declared field to its title value and reseed the generator. */
  reset(
    state: DeepReadonly<VoluteState>,
    options?: { seed?: number },
  ): VoluteState;

  /** A pure reading of the running game. */
  snapshot(state: DeepReadonly<VoluteState>): VoluteSnapshot;

  /** Pose what the start control on the title does. */
  start(state: DeepReadonly<VoluteState>): VoluteState;

  /** Open `level`, exactly as the interlude before it opens it. */
  startLevel(state: DeepReadonly<VoluteState>, level: number): VoluteState;

  /** Replace every core on the channel with the `[s, charge, mark]` triples given. */
  poseTrain(
    state: DeepReadonly<VoluteState>,
    cores: readonly PosedCore[],
  ): VoluteState;

  /** Remove every core from the channel and every projectile. */
  clearTrain(state: DeepReadonly<VoluteState>): VoluteState;

  /** Set the charge the injector holds loaded. */
  setLoaded(state: DeepReadonly<VoluteState>, charge: string): VoluteState;

  /** Set the charge the injector holds queued. */
  setQueued(state: DeepReadonly<VoluteState>, charge: string): VoluteState;

  /** Aim at `angleDegrees` and release the loaded core along it. */
  fire(state: DeepReadonly<VoluteState>, angleDegrees: number): VoluteState;

  /** Set the pressure, clamped to `0` through `100`. */
  setPressure(state: DeepReadonly<VoluteState>, value: number): VoluteState;

  /** Set the cores the inlet has left to emit this level. */
  setQuotaRemaining(state: DeepReadonly<VoluteState>, n: number): VoluteState;

  /** Grant `kind` exactly as extracting a run holding its mark grants it. */
  grantMachinery(state: DeepReadonly<VoluteState>, kind: string): VoluteState;

  /** Pose the pause control. */
  pause(state: DeepReadonly<VoluteState>): VoluteState;

  /** Pose the pause control again. */
  resume(state: DeepReadonly<VoluteState>): VoluteState;
}

/* -------------------------------------------------------------------------- */
/* The presentation table                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The decoded images, the parsed particle systems, and the effects playing over
 * the hall.
 *
 * None of it is game state — the simulation reaches the same state with these
 * present and with them absent — so it lives here, in the one module-level table
 * `specs/state.md` allows, and `initialize` fills it. It starts complete rather
 * than empty-or-missing, so nothing that reads it has to ask whether it is there
 * yet.
 */
let assets: Assets = emptyAssets();
let effects: Effects = new Effects(assets);

/** The field background, which the engine clears the canvas to every frame. */
export const BACKGROUND: string = COLOR.field;

/* -------------------------------------------------------------------------- */
/* The frame                                                                  */
/* -------------------------------------------------------------------------- */

/** Read the player once, as the update's own view of the controls. */
function readInput(api: UpdateApi): Controls {
  // Every edge is consumed here whatever the screen, and the screen's own row of
  // specs/controls.md decides which of them is acted on. The engine closes the
  // input frame after the render, so an edge nothing read is discarded anyway.
  const fire = api.input.pressed("a");
  const pointerFire = api.input.pointerPressed();
  const swap = api.input.pressed("b");
  const confirm = api.input.pressed("confirm");
  const pause = api.input.pressed("pause");

  // The samples the primary pointer delivered since the input frame last closed:
  // a pointer that has not moved leaves the aim to the turn actions, and a
  // second finger on a touchscreen aims nothing.
  const samples = api.input
    .pointerSamples()
    .filter((sample) => sample.primary);
  const last = samples[samples.length - 1];
  const pointer: Point | null =
    last === undefined ? null : { x: last.x, y: last.y };

  return {
    turn: api.input.value("right") - api.input.value("left"),
    pointer,
    fire: fire || pointerFire,
    swap,
    confirm,
    pause,
  };
}

/** Sound the cues a step raised, and play the effects it raised over the hall. */
function emit(api: UpdateApi, report: TickReport): void {
  for (const cue of report.cues) api.audio.play(cue);
  for (const event of report.fx) effects.spawn(event);
}

/**
 * Exactly one bed loops on `playing`, and neither on any other screen.
 *
 * Reconciled against what the engine is ACTUALLY looping rather than against what
 * was last asked for, so the change happens on the tick the danger condition
 * changes and the two beds never sound together.
 */
function syncBeds(api: UpdateApi, draft: Draft): void {
  const wanted =
    draft.screen === "playing"
      ? inDanger(draft)
        ? CUES.dangerLoop
        : CUES.hallLoop
      : null;
  for (const cue of LOOPING_CUES) {
    if (cue !== wanted && api.audio.looping(cue)) api.audio.stop(cue);
  }
  if (wanted !== null && !api.audio.looping(wanted)) api.audio.loop(wanted);
}

/** Volute, as the engine holds it. */
export const game: Game<VoluteState, VoluteDebugApi> = {
  async initialize(api) {
    // Every action `ACTIONS` names, under the keys `BINDINGS` binds it to. The
    // list is the `dpad-4-two-buttons` vocabulary the engine was created with, so
    // the scheme and the bindings agree.
    for (const action of ACTIONS) {
      api.input.register(action, { keys: [...BINDINGS[action]] });
    }

    // Awaited, so nothing is still decoding on the first frame.
    await bindCues(api);
    assets = await loadAssets(api);
    effects = new Effects(assets);
    resetPatternCache();

    registerDiagnostics(api);

    return [
      freeze(createDraft(DEFAULT_SEED)),
      createDebugApi(() => {
        effects.clear();
      }),
    ];
  },

  update(state, api, dt) {
    const draft = thaw(state);

    // `simTime` accumulates the elapsed time of every update, whatever the
    // screen, so it stands outside the table of what each screen advances.
    draft.simTime += Math.max(0, dt);

    // Mute answers on every screen. The engine owns the bit; the state carries
    // the game's readable copy of it, refreshed at the end of every update.
    if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());

    const controls = readInput(api);

    // The simulation time this update is about to advance: the whole ticks the
    // accumulator holds once the frame's delta is added to it. It is what a held
    // turn action swings the aim against, so the aim turns by exactly the time
    // the hall moved by.
    const advancing = advancesSimulation(draft.screen);
    const pending = advancing ? draft.accumulator + Math.max(0, dt) : 0;
    const ticks = advancing ? Math.floor(pending / TICK_DT) : 0;

    const opening = newReport();
    readControls(draft, controls, ticks * TICK_DT, opening);
    emit(api, opening);

    if (advancesSimulation(draft.screen)) {
      draft.accumulator = pending - ticks * TICK_DT;
      for (let i = 0; i < ticks; i += 1) {
        const report = newReport();
        stepTick(draft, TICK_DT, report);
        emit(api, report);
        // A screen that stops advancing discards the delta left unconsumed.
        if (!advancesSimulation(draft.screen)) break;
      }
    }
    if (!advancesSimulation(draft.screen)) draft.accumulator = 0;

    syncBeds(api, draft);
    draft.muted = api.audio.muted();

    return freeze(draft);
  },

  render(state, api) {
    const dt = Math.max(0, api.frame().lastDeltaMs) / 1000;
    effects.update(dt);
    renderFrame(api.ctx, state, assets, effects, dt);
  },
};
