// Floe — the state contract and the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once, before any frame, and returns the
// state and the surface together as `[state, debug]`. `update` and `render` then run
// once each per frame, `update` first, with the frame's delta time in SECONDS.
//
// THE STATE SHAPE BELOW IS THE CONTRACT `specs/state.md` FIXES. Every field it
// declares is declared here under its declared name and type; every one of them is
// `readonly` and every array a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape. `initialize` builds
// the whole state in one go, so no field is optional and no frame can observe a
// half-built state. There is no module-level game state in this build and no closure
// over mutable data, which is what makes the surface's `reset` enough to replay a
// scenario exactly.
//
// SEVEN FIELDS GO BEYOND THAT DECLARATION, and `specs/state.md` asks for them there:
// "anything else the game must keep from one tick to the next is a field you add to
// `FloeState`, rather than a module-level variable or a closure". They are
// `frameCarry` (the remainder of a frame's delta the fixed step carries),
// `animTime` (the clock a two-frame pair alternates on, which a pause suspends and
// `simTime` does not), `nextId` (the counter every entity's id comes off),
// `slots` (the hunt's two slots and how long each empty one has left before it
// fills), `fishTimer` and `lastFishBay` (the bonus catch's own cadence), `request`
// (the direction the frame's input is asking for, which the ticks consume), and
// `lunge` (where a bear that caught the critter was, so `specs/assets.md`'s lunge
// frames are drawn there on the tick of the catch — every bear leaves the strait on
// that tick, so the bear itself is gone by the time anything draws).
//
// The one field beyond the game is `sprites`, the seeded art loaded once by
// `initialize`. It carries no decision the simulation makes, it is the same in every
// run, `reset` leaves it alone, and the snapshot does not report it. It lives in the
// state because `render` is handed the state and nothing else.
//
// HOW A FRAME IS BUILT. `update` copies the state it was handed into a working
// value, advances that, and returns it; the state it was handed is never written,
// and the compiler enforces that because the view is read-only. The working value is
// `Sim` in `src/sim.ts`, a field-for-field mutable mirror of the record below, so the
// advance reads as the arithmetic it is instead of as a chain of spreads, and the
// result is assignable to `FloeState` because the only difference between the two is
// the `readonly` markers.

import { defineCues } from "./audio";
import { loadSprites, type Sprites } from "./assets";
import { createDebugApi, type FloeDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import { readInput, registerActions } from "./input";
import { renderGame } from "./render";
import { handleInput } from "./screens";
import { advanceFrame } from "./simulate";
import { newTickEvents, toSim } from "./sim";
import { BACKGROUND as STAGE_BACKGROUND } from "./theme";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface's type belongs beside the state it poses, so it is exported from here
// whichever module implements it.
export type { FloeDebugApi };
export type { FloeSnapshot } from "./snapshot";
export type { Sprites };

/**
 * The stage background, a CSS colour string. `src/main.ts` hands it to the engine as
 * the colour the canvas is cleared to each frame, so the letterbox bars around the
 * stage match the strait itself.
 */
export const BACKGROUND: string = STAGE_BACKGROUND;

// ---- The declared state (specs/state.md) ---------------------------------

export type Screen =
  "title" | "howto" | "playing" | "paused" | "victory" | "gameover";

export type Phase = "crossing" | "dying" | "clearing";

export type Facing = "up" | "down" | "left" | "right";

export type LaneDir = 1 | -1;

export type VehicleKind = "plow" | "dogsled" | "car";

export type FloeKind = "pan" | "raft3" | "raft4";

/** What the critter is standing on (`specs/strait.md`). Derived, never stored. */
export type Footing = "solid" | "floe" | "water";

export interface CritterState {
  readonly present: boolean;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly hopCooldown: number;
  readonly bestRow: number;
}

export interface BearState {
  readonly id: number;
  readonly col: number;
  readonly row: number;
  readonly stepCol: number;
  readonly stepRow: number;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly target: { readonly col: number; readonly row: number };
  readonly sense: boolean;
  readonly routing: boolean;
  readonly travel: boolean;
  /**
   * The travel this bear has left over from the tick it settled on a tile centre.
   *
   * `specs/hunter.md` requires it: "the bear settles exactly on that centre for that
   * tick and the travel left over is added to the next tick's travel, so no distance
   * is lost at a tile centre". It is the bear's own bookkeeping and the snapshot does
   * not report it.
   */
  readonly carry: number;
}

export interface LaneState {
  readonly row: number;
  readonly dir: LaneDir;
  readonly speed: number;
}

export interface VehicleState {
  readonly id: number;
  readonly row: number;
  readonly kind: VehicleKind;
  readonly x: number;
  readonly len: number;
}

export interface FloeItemState {
  readonly id: number;
  readonly row: number;
  readonly kind: FloeKind;
  readonly x: number;
  readonly len: number;
}

export interface GateState {
  readonly bearEmergence: boolean;
  readonly catchTest: boolean;
  readonly fishCadence: boolean;
  readonly timerRunning: boolean;
}

/** One of the hunt's slots: the bear filling it, and an empty one's own delay. */
export interface SlotState {
  readonly bearId: number | null;
  readonly fillIn: number;
}

/** Where a bear that caught the critter was, and how long its lunge is drawn for. */
export interface LungeState {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly timer: number;
}

export interface FloeState {
  readonly screen: Screen;
  readonly phase: Phase;
  readonly phaseTimer: number;
  readonly menuIndex: number;

  readonly level: number;
  readonly reachedLevel: number;
  readonly lives: number;
  readonly score: number;
  readonly timer: number;

  readonly bays: readonly boolean[];
  readonly fishBay: number | null;

  readonly critter: CritterState;
  readonly bears: readonly BearState[];

  readonly iceLanes: readonly LaneState[];
  readonly waterLanes: readonly LaneState[];
  readonly vehicles: readonly VehicleState[];
  readonly floes: readonly FloeItemState[];

  readonly gates: GateState;

  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;

  // ---- Beyond the declaration, as `specs/state.md` permits -----------------

  /** The remainder of a frame's delta the fixed step carries into the next frame. */
  readonly frameCarry: number;
  /** The clock a two-frame pair alternates on. A pause suspends it. */
  readonly animTime: number;
  /** The counter every bear's, vehicle's and floe's id comes off. */
  readonly nextId: number;
  /** The hunt's slots, one per bear that ever hunts at once. */
  readonly slots: readonly SlotState[];
  /** Seconds until the bonus catch's next appearance, or its departure. */
  readonly fishTimer: number;
  /** The bay the previous bonus catch held, which the next one avoids. */
  readonly lastFishBay: number | null;
  /** The direction this frame's input is asking the critter to hop. */
  readonly request: Facing | null;
  /** The lunge left where a bear caught the critter. */
  readonly lunge: LungeState | null;

  /**
   * The seeded sprite art, loaded once by `initialize` and never changed after.
   *
   * It is not part of the game: it holds no decision the simulation makes, it is the
   * same in every run, `reset` leaves it exactly as it is, and the snapshot does not
   * report it. A frame that could not be loaded is drawn as the shape it falls back
   * to.
   */
  readonly sprites: Sprites;
}

// ---- The game ------------------------------------------------------------

/** The game the engine drives. */
export const game: Game<FloeState, FloeDebugApi> = {
  async initialize(
    api: InitApi<FloeState>,
  ): Promise<[FloeState, FloeDebugApi]> {
    registerActions(api);
    defineCues(api);
    registerDiagnostics(api);

    // Awaited here, so every frame of the seeded art is a plain image value by the
    // time the first frame draws.
    const sprites = await loadSprites(api.assets);

    return [openingState(sprites), createDebugApi()];
  },

  update(
    state: DeepReadonly<FloeState>,
    api: UpdateApi,
    dt: number,
  ): FloeState {
    const sim = toSim(state);

    // Read before the input is: a crossing advances only on a frame that BOTH began
    // and ended on the `playing` screen, so the frame a menu starts a run on leaves
    // the fresh crossing it laid down exactly as it laid it.
    const wasPlaying = sim.screen === "playing";

    // Input is resolved once per frame: an edge fires once per press, and a held
    // direction is left on the state as the request the ticks consume.
    const frame = newTickEvents();
    const outcome = handleInput(sim, readInput(api), frame);

    // Muting is the engine's bit and the game's binding, so the toggle happens here,
    // where the audio bus is reachable, and `muted` mirrors the result.
    if (outcome.toggleMute) api.audio.setMuted(!api.audio.muted());

    const advanced = advanceFrame(sim, dt, wasPlaying);

    sim.muted = api.audio.muted();
    for (const cue of frame.cues) api.audio.play(cue);
    for (const cue of advanced.cues) api.audio.play(cue);
    return sim;
  },

  render(state: DeepReadonly<FloeState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
