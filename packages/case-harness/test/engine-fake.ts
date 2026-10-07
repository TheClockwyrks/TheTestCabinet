// A fake engine, satisfying the structural contract and nothing more.
//
// The package names no engine — that is the whole design — so its own suite
// cannot exercise the kit against a real one either without taking exactly the
// dependency the design refuses. What it can do is stand up an object of the
// SHAPE `../src/engine/contract` declares, and drive the kit against that: if
// the kit reaches for anything the four engines do not all carry, it fails here.
//
// The fake is a real little game: a clock-driven frame counter, a state a pose
// can move, a canvas the render really draws on, and cues announced
// synchronously from inside a frame — which is what lets the cue stamping be
// checked against the frame that was running when the cue sounded.

import type { SKRSContext2D } from "@napi-rs/canvas";
import type {
  AssetFailurePayload,
  CuePayload,
  EngineClock,
  EngineEventMap,
  EngineFrameInfo,
  EngineSurfaceMetrics,
  EngineViewport,
} from "../src/engine/contract";

/**
 * The state the fake game holds, which a pose replaces and a reading reports.
 *
 * `kind` is here to keep the snapshot from being STRUCTURALLY ASSIGNABLE to the
 * state, and that is not incidental. `PureDriver` tells a pose from a reading by
 * whether the member's return type satisfies the state — the only discriminator
 * a type has, since which members are readings is a run-time list — so a case
 * whose snapshot happens to be assignable to its state would see its readings
 * typed as poses. Every real case's snapshot names fields its state does not, so
 * the hazard does not arise there; the fake has to be as unlike its snapshot as
 * a real state is or it would be testing something no case does.
 */
export interface FakeState {
  kind: "state";
  screen: string;
  count: number;
}

/** The snapshot a check reads, after the case's own projection. */
export interface FakeSnapshot {
  screen: string;
  count: number;
  frame: number;
}

/** The pure surface a simple-engine-shaped build returns beside its state. */
export interface FakeSurface {
  setScreen(state: Readonly<FakeState>, name: string): FakeState;
  bump(state: Readonly<FakeState>, by: number): FakeState;
  snapshot(state: Readonly<FakeState>): FakeSnapshot;
  version: number;
}

export const FAKE_READINGS: readonly string[] = ["snapshot"];

/** How the fake is built, so a spec can pose the faults it wants. */
export interface FakeOptions {
  /** What `engine.debug` holds after `initialize`. Defaults to a real surface. */
  debug?: unknown;
  /** A cue to play on every frame, announced from inside the frame. */
  cuePerFrame?: string;
  /** An asset failure to announce during `initialize`. */
  failAsset?: { path: string; reason: string };
  /** What the render draws each frame. */
  render?: (ctx: SKRSContext2D, state: Readonly<FakeState>) => void;
  /** The stage the viewport is fitted to. */
  stage?: { width: number; height: number };
}

type Listener = (payload: never) => void;

/** The engine the kit drives, structural member for structural member. */
export class FakeEngine {
  readonly events: {
    on<K extends keyof EngineEventMap>(
      event: K,
      handler: (payload: EngineEventMap[K]) => void,
    ): () => void;
  };
  /** Every key and pointer event the harness dispatched, oldest first. */
  readonly received: Event[] = [];
  /** How many times `destroy` was called. */
  destroyed = 0;
  /** Whether the recorder is armed, and every frame it has kept. */
  recordingFrames: number[] = [];

  private held: FakeState = { kind: "state", screen: "title", count: 0 };
  private info: EngineFrameInfo = { count: 0, timeMs: 0, lastDeltaMs: 0 };
  private armed = false;
  private readonly listeners = new Map<string, Listener[]>();
  private readonly ctx: SKRSContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly clock: EngineClock,
    private readonly surface: EngineSurfaceMetrics,
    private readonly options: FakeOptions,
  ) {
    this.ctx = (
      canvas as unknown as { getContext(id: "2d"): SKRSContext2D }
    ).getContext("2d");
    const listeners = this.listeners;
    this.events = {
      on(event, handler) {
        const held = listeners.get(event) ?? [];
        held.push(handler as Listener);
        listeners.set(event, held);
        return () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((one) => one !== handler),
          );
        };
      },
    };
    for (const type of [
      "keydown",
      "keyup",
      "pointerdown",
      "pointermove",
      "pointerup",
    ]) {
      this.surface.events().addEventListener(type, (event) => {
        this.received.push(event);
      });
    }
  }

  private emit<K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ): void {
    for (const handler of this.listeners.get(event) ?? []) {
      (handler as (value: EngineEventMap[K]) => void)(payload);
    }
  }

  get state(): Readonly<FakeState> {
    return this.held;
  }

  get debug(): unknown {
    return "debug" in this.options ? this.options.debug : FAKE_SURFACE;
  }

  apply(transition: (state: Readonly<FakeState>) => FakeState): unknown {
    this.held = transition(this.held);
    return this.held;
  }

  async initialize(): Promise<string> {
    if (this.options.failAsset !== undefined) {
      this.emit("asset:failed", {
        path: this.options.failAsset.path,
        url: `/${this.options.failAsset.path}`,
        reason: this.options.failAsset.reason,
      } satisfies AssetFailurePayload);
    }
    return "initialized";
  }

  async advance(frames: number): Promise<void> {
    for (let i = 0; i < frames; i += 1) {
      const delta = this.clock.delta(this.info.timeMs);
      if (delta === null) continue;
      this.info = {
        count: this.info.count + 1,
        timeMs: this.info.timeMs + delta,
        lastDeltaMs: delta,
      };
      if (this.armed) this.recordingFrames.push(this.info.count);
      // Announced from INSIDE the frame, synchronously, which is what every
      // engine does and what makes the stamp exact.
      if (this.options.cuePerFrame !== undefined) {
        this.emit("cue:played", {
          cue: this.options.cuePerFrame,
          t: this.info.timeMs,
          gain: 1,
        } satisfies CuePayload);
      }
      const render = this.options.render;
      if (render !== undefined) render(this.ctx, this.held);
    }
  }

  setClock(): void {
    /* The fake takes its clock at construction; nothing here replaces it. */
  }

  frame(): EngineFrameInfo {
    return { ...this.info };
  }

  viewport(): EngineViewport {
    const stage = this.options.stage ?? { width: 200, height: 100 };
    const cssScale = Math.min(
      this.surface.cssWidth() / stage.width,
      this.surface.cssHeight() / stage.height,
    );
    const scale = cssScale * this.surface.dpr();
    return {
      width: stage.width,
      height: stage.height,
      scale,
      offsetX: (this.canvas.width - stage.width * scale) / 2,
      offsetY: (this.canvas.height - stage.height * scale) / 2,
    };
  }

  diagnostics(): readonly unknown[] {
    return [];
  }

  recording(): boolean {
    return this.armed;
  }

  startRecording(): void {
    this.armed = true;
    this.recordingFrames = [];
  }

  stopRecording(): {
    format: number;
    width: number;
    height: number;
    background: string | null;
    images: readonly unknown[];
    resources: readonly unknown[];
    ops: readonly unknown[];
    states: readonly unknown[];
    frames: readonly unknown[];
  } {
    this.armed = false;
    return {
      format: 1,
      width: 200,
      height: 100,
      background: null,
      images: [],
      resources: [],
      ops: [{ op: "call", method: "fillRect", args: [0, 0, 1, 1] }],
      states: [
        {
          properties: {},
          transform: null,
          lineDash: null,
          clip: [],
          path: [],
        },
      ],
      frames: this.recordingFrames.map((count) => ({
        count,
        timeMs: count * 16,
        deltaMs: 16,
        surface: { width: 200, height: 100 },
        state: 0,
        stack: [],
        ops: [0],
      })),
    };
  }

  destroy(): void {
    this.destroyed += 1;
  }
}

/** The pure surface the fake build returns. */
export const FAKE_SURFACE: FakeSurface = {
  setScreen: (state, name) => ({ ...state, screen: name }),
  bump: (state, by) => ({ ...state, count: state.count + by }),
  snapshot: (state) => ({ screen: state.screen, count: state.count, frame: 0 }),
  version: 1,
};

/** A clock of one fixed delta, which is what every engine harness defaults to. */
export class FixedClock implements EngineClock {
  constructor(private readonly ms: number) {}
  delta(): number {
    return this.ms;
  }
}
