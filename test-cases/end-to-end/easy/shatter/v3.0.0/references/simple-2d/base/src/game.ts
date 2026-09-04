// Shatter — the state contract and the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the
// game hands to the engine. `initialize` runs once, before any frame, and
// returns the state and the surface together as `[state, debug]`. `update` and
// `render` then run once each per frame, `update` first, with the frame's delta
// time in SECONDS.
//
// THE STATE SHAPE BELOW IS THE CONTRACT `specs/state.md` fixes. Every field is
// declared here under its declared name, type and meaning; every one of them is
// `readonly` and every array a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape. `initialize`
// builds the whole state in one go, so no field is optional and no frame can
// observe a half-built state. Nothing authoritative lives anywhere else: there
// is no module-level game state in this build and no closure over mutable data,
// which is what makes the debug surface's `reset` enough to replay a scenario
// exactly.
//
// One field stands beside the declared ones, which `specs/state.md` allows:
// `extraLifeNotice`, the seconds left on the on-field announcement
// `specs/scoring.md` requires when an extra ship is granted. `reset` leaves it
// consistent with the fields it restores, and the snapshot does not report it.
//
// HOW A FRAME IS BUILT. `update` copies the state it was handed into a working
// value, advances that, and returns it; the state it was handed is never
// written, and the compiler enforces that because the view is read-only. The
// working value is `Sim` in `src/sim.ts`, a field-for-field mutable mirror of
// the record below, so the advance reads as the arithmetic it is instead of as
// a chain of spreads, and the result is assignable to `ShatterState` because
// the only difference between the two is the `readonly` markers.

import { CUES, FIELD_H, FIELD_W, TICK_DT, type RockSize } from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type ShatterDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import {
  readInput,
  registerActions,
  withoutEdges,
  type FrameInput,
} from "./input";
import { renderGame } from "./render";
import { newTickEvents, toSim, type Sim } from "./sim";
import { stepTick } from "./simulate";
import { BACKGROUND as FIELD_BACKGROUND } from "./theme";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface's type belongs beside the state it poses, so it is exported from
// here whichever module implements it.
export type { ShatterDebugApi };
export type { ShatterSnapshot } from "./debug";

/**
 * The field's background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the field match the field itself.
 */
export const BACKGROUND: string = FIELD_BACKGROUND;

// ---- The declared state (specs/state.md) ---------------------------------

export type Screen = "title" | "howto" | "playing" | "paused" | "gameover";

export interface ShipState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly thrusting: boolean;
  readonly invuln: number;
  readonly collision: boolean;
  readonly fireCooldown: number;
}

export interface BulletState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly life: number;
}

export interface RockState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly size: RockSize;
  readonly spin: number;
}

export interface SaucerState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly mind: boolean;
  readonly gun: boolean;
  readonly travel: boolean;
  readonly fireClock: number;
  readonly weaveClock: number;
  readonly age: number;
}

export interface ShatterState {
  readonly screen: Screen;
  readonly menuIndex: number;

  readonly score: number;
  readonly lives: number;
  readonly wave: number;
  readonly waveBanner: number;

  readonly ship: ShipState;
  readonly bullets: readonly BulletState[];
  readonly rocks: readonly RockState[];
  readonly saucer: SaucerState | null;
  readonly enemyBullets: readonly BulletState[];

  readonly waveSpawning: boolean;
  readonly saucerSpawning: boolean;
  readonly saucerClock: number;
  readonly saucerDue: number;

  readonly tickClock: number;
  readonly nextId: number;
  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;

  /**
   * The seconds left on the extra-ship announcement `specs/scoring.md` asks
   * for. It is this build's own field beside the declared ones: it holds no
   * rule the specification fixes, `reset` clears it with the score it belongs
   * to, and the snapshot does not report it.
   */
  readonly extraLifeNotice: number;
}

// ---- The game ------------------------------------------------------------

/**
 * How much of a frame's delta may be spent on ticks.
 *
 * A frame that arrives after the tab was hidden carries a very large delta, and
 * running every tick of it at once would stall the loop for as long as the gap
 * lasted. The engine's own `WallClock` already clamps a frame to 100 ms; this is
 * the same defence one layer down, for a clock that does not.
 */
const MAX_TICKS_PER_FRAME = 240;

/** Whole ticks worth of accumulated time are run in order; the rest is carried. */
function runTicks(
  sim: Sim,
  input: FrameInput,
  dt: number,
  play: (cues: Iterable<string>) => void,
): void {
  sim.tickClock += dt;

  let ticks = 0;
  // Each tick is worth exactly TICK_DT, whatever the frame's delta was, so the
  // same interval of game time reaches the same state however it was divided.
  while (sim.tickClock >= TICK_DT - 1e-9 && ticks < MAX_TICKS_PER_FRAME) {
    sim.tickClock -= TICK_DT;
    if (sim.tickClock < 0) sim.tickClock = 0;
    ticks += 1;

    // The edges belong to the frame that read them, so they act on its first
    // tick alone; the holds apply to every tick the frame runs.
    const tickInput = ticks === 1 ? input : withoutEdges(input);
    const events = newTickEvents();
    stepTick(sim, tickInput, events);
    play(events.cues);
  }

  if (ticks >= MAX_TICKS_PER_FRAME) sim.tickClock = 0;
}

/** The game the engine drives. */
export const game: Game<ShatterState, ShatterDebugApi> = {
  initialize(api: InitApi<ShatterState>): [ShatterState, ShatterDebugApi] {
    registerActions(api);
    defineCues(api);
    registerDiagnostics(api);

    return [openingState(), createDebugApi()];
  },

  update(
    state: DeepReadonly<ShatterState>,
    api: UpdateApi,
    dt: number,
  ): ShatterState {
    const sim = toSim(state);

    // Muting is the engine's bit and the game's binding, so the toggle happens
    // here, where the audio bus is reachable, and `muted` mirrors the result.
    const input = readInput(api);
    if (input.mute) api.audio.setMuted(!api.audio.muted());

    // Cues are gathered per tick rather than played as they happen, so a tick
    // that raises one twice still plays it once.
    runTicks(sim, input, dt, (cues) => {
      for (const cue of cues) api.audio.play(cue);
    });

    // The thrust cue is HELD rather than struck: it sounds for as long as the
    // burn lasts and stops when it ends, which is a loop on the engine's bus
    // rather than a cue played per tick.
    const burning = sim.screen === "playing" && sim.ship.thrusting;
    if (burning && !api.audio.looping(CUES.thrust)) api.audio.loop(CUES.thrust);
    if (!burning && api.audio.looping(CUES.thrust)) api.audio.stop(CUES.thrust);

    sim.muted = api.audio.muted();
    return sim;
  },

  render(state: DeepReadonly<ShatterState>, api: RenderApi): void {
    renderGame(state, api.ctx, FIELD_W, FIELD_H);
  },
};
