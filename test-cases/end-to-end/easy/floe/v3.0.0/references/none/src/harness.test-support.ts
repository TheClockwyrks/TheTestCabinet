// Floe — what the build's own tests drive the game through.
//
// The rules are a pure function of the state, the tick's intents and the tick's
// length (`src/game.ts`), so a test needs no browser and no canvas: it poses a
// scenario through the same debugging surface `specs/instrumentation.md` gives a
// driver, advances a counted number of ticks, and reads the snapshot back.
//
// The clock here is the one difference from the browser. In the page the runtime
// owns it; in a test this harness is the clock, so `advance(n)` runs exactly `n`
// ticks of `TICK_DT` and nothing depends on the machine the test ran on.

import { START_COL, ROW_NEAR, TICK_DT, crossingTimer } from "./constants";
import { createDebugApi, type FloeDebugApi } from "./debug";
import {
  NO_INTENTS,
  createState,
  stepGame,
  type Bus,
  type Intents,
} from "./game";
import type { CueName } from "./constants";
import type { PointerEdge } from "./pointer";
import type { Facing, FloeState } from "./types";

/** A cue bus that records rather than sounds. */
export interface RecordingBus extends Bus {
  /** Every cue played since the last {@link RecordingBus.clear}. */
  readonly cues: CueName[];
  /** Forget what has been played. */
  clear(): void;
}

/** A bus that records every cue and holds a mute bit of its own. */
export function recordingBus(): RecordingBus {
  const cues: CueName[] = [];
  let muted = false;
  return {
    cues,
    clear: () => {
      cues.length = 0;
    },
    cue: (name) => {
      cues.push(name);
    },
    muted: () => muted,
    setMuted: (value) => {
      muted = value;
    },
  };
}

/** One of the eight keyboard edges a tick can carry. */
export type KeyEdge = keyof Omit<Intents, "held" | "pointer">;

/** One game, its surface, its cue bus, and a keyboard the test holds. */
export interface Harness {
  /** The live state every pose acts on. */
  state: FloeState;
  /** The surface, exactly as a driver reaches it. */
  api: FloeDebugApi;
  /** The cues the ticks played. */
  bus: RecordingBus;
  /** Hold a direction down, as a player would. */
  hold(facing: Facing | null): void;
  /** Arm one edge, consumed by the next tick that runs. */
  press(edge: KeyEdge): void;
  /** Queue a pointer or touch edge, consumed by the next tick that runs. */
  point(...edges: readonly PointerEdge[]): void;
  /** Run `ticks` whole ticks. */
  advance(ticks: number): void;
  /** Run the ticks covering `seconds` of game time, rounded up to a whole tick. */
  seconds(seconds: number): void;
}

/** Stand a game up, off the clock, with nothing held. */
export function harness(): Harness {
  const state = createState();
  const bus = recordingBus();
  let held: Facing | null = null;
  let edges = new Set<KeyEdge>();
  let pointer: PointerEdge[] = [];

  const advance = (ticks: number): void => {
    for (let i = 0; i < ticks; i += 1) {
      const intents: Intents = { ...NO_INTENTS, held, pointer };
      for (const edge of edges) intents[edge] = true;
      edges = new Set();
      pointer = [];
      stepGame(state, intents, TICK_DT, bus);
    }
  };

  const api = createDebugApi(state, {
    setAutoStep: () => undefined,
    advance,
  });

  return {
    state,
    api,
    bus,
    hold: (facing) => {
      held = facing;
    },
    press: (edge) => {
      edges.add(edge);
    },
    point: (...raised) => {
      pointer.push(...raised);
    },
    advance,
    seconds: (value) => advance(Math.ceil(value / TICK_DT)),
  };
}

/**
 * The empty, quiet strait every rules test starts from: the level laid out, then
 * cleared, every world gate off, and the critter on the near shore.
 *
 * The order matters. Setting the level lays the sixteen lanes out, so the clears
 * come after it or the strait fills straight back up.
 */
export function startCrossing(h: Harness, level = 1): void {
  h.api.reset();
  h.api.setLevel(level);
  h.api.clearVehicles();
  h.api.clearFloes();
  h.api.clearBears();
  h.api.clearBays();
  h.api.clearFish();
  h.api.setBearEmergence(false);
  h.api.setCatchTest(false);
  h.api.setFishCadence(false);
  h.api.setTimerRunning(false);
  h.api.setScreen("playing");
  h.api.setPhase("crossing");
  h.api.setPhaseTimer(0);
  h.api.setTimer(crossingTimer(level));
  h.api.addCritter(START_COL, ROW_NEAR);
  h.bus.clear();
}

/** The id of the last entity added to a roster, which is the one just posed. */
export function lastId(items: readonly { id: number }[]): number {
  return items[items.length - 1].id;
}
