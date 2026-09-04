// Shatter — the state contract and the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the
// game hands to the engine. `initialize` runs once, before any frame, and
// returns the state and the surface together as `[state, debug]`. `update` and
// `render` then run once each per frame, `update` first, with the frame's delta
// time in SECONDS.
//
// THE STATE SHAPE BELOW IS THE CONTRACT `specs/state.md` fixes. Every declared
// field is here under its declared name, type and meaning; every one of them is
// `readonly` and every array a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape. `initialize`
// builds the whole state in one go, so no field is optional and no frame can
// observe a half-built state. Nothing authoritative lives anywhere else: there
// is no module-level game state in this build and no closure over mutable data,
// which is what makes the debug surface's `reset` enough to replay a scenario
// exactly.
//
// TWO FIELDS SIT BESIDE THE DECLARED ONES, which `specs/state.md` leaves to the
// build. `trails` holds the recent travel each bullet's tail is drawn along, and
// `extraLifeFlash` the seconds left on the award announcement. Both are drawing
// alone: neither decides anything the simulation does, `reset` returns both to
// their opening values, and the snapshot reports neither. `trails` is rebuilt
// against the bullet roster at the top of every tick, so a roster a debug pose
// added to or emptied leaves it consistent without the pose knowing about it.
//
// HOW A FRAME IS BUILT. `update` copies the state it was handed into a working
// value, advances that, and returns it; the state it was handed is never
// written, and the compiler enforces that because the view is read-only. The
// working value is `Sim` in `src/sim.ts`, a field-for-field mutable mirror of
// the record below, so the advance reads as the arithmetic it is instead of as
// a chain of spreads, and the result is assignable to `ShatterState` because the
// only difference between the two is the `readonly` markers.

import { FIELD_H, FIELD_W, type RockSize } from "./constants";
import { defineCues } from "./audio";
import { createDebugApi, type ShatterDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import { readInput, registerActions } from "./input";
import { renderGame } from "./render";
import { newFrameEvents, toSim } from "./sim";
import { stepFrame } from "./simulate";
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
 * The field background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the field match the field itself.
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
  readonly health: number;
  readonly flash: number;
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

export interface TorpedoState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly heading: number;
  readonly life: number;
  readonly homing: boolean;
}

/**
 * One bullet's recent travel, as offsets from where that bullet is NOW, oldest
 * first. Offsets rather than positions is what makes a tail follow its bullet
 * across a seam instead of smearing back across the field: the whole tail moves
 * with the bullet, so a wrap moves it too.
 *
 * Beside the declared state, and drawing alone. See the header.
 */
export interface TrailState {
  readonly id: number;
  readonly points: readonly { readonly dx: number; readonly dy: number }[];
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
  readonly torpedoes: readonly TorpedoState[];
  readonly torpedoCharge: number;

  readonly waveSpawning: boolean;
  readonly saucerSpawning: boolean;
  readonly saucerClock: number;
  readonly saucerDue: number;

  readonly tickClock: number;
  readonly nextId: number;
  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;

  /** Beside the declared state: the tail drawn behind each bullet. */
  readonly trails: readonly TrailState[];
  /** Beside the declared state: seconds left on the extra-ship announcement. */
  readonly extraLifeFlash: number;
}

// ---- The game ------------------------------------------------------------

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

    // Cues are gathered rather than played as they happen, so a frame that
    // raises one twice still plays it once.
    const events = newFrameEvents();
    stepFrame(sim, input, dt, events);

    sim.muted = api.audio.muted();
    for (const cue of events.cues) api.audio.play(cue);

    // The thrust cue is HELD rather than struck: it sounds for as long as thrust
    // is applied and stops within a tick of its release (`specs/audio.md`).
    if (events.thrusting) {
      if (!api.audio.looping("thrust")) api.audio.loop("thrust");
    } else if (api.audio.looping("thrust")) {
      api.audio.stop("thrust");
    }

    return sim;
  },

  render(state: DeepReadonly<ShatterState>, api: RenderApi): void {
    renderGame(state, api.ctx, FIELD_W, FIELD_H);
  },
};
