// Wireworm — what the build's own tests stand the game up on.
//
// Not part of the game: nothing under `src/` imports this except a `*.test.ts`
// file. It exists so every test drives the REAL runtime, the REAL game, and the
// REAL debug surface rather than a re-implementation of any of them — the same
// three objects `src/main.ts` wires together, over a canvas from
// `@napi-rs/canvas`, a surface of the test's own, and a clock the test moves
// with `advance`.
//
// Three things a browser supplies and Node does not are supplied here:
//
//   * A KEYBOARD EVENT. Node has `Event` but not `KeyboardEvent`, and
//     `src/keyboard.ts` narrows structurally on `code` precisely so an event
//     from any realm reaches an action. {@link keyEvent} is that event.
//   * AN AUDIO CONTEXT. {@link recordingAudio} is a fake one that counts the
//     sources the bus starts, which is the same thing a browser probe can
//     observe from outside an engineless build: that a sound was emitted, and on
//     which frame.
//   * THE SEEDED ART. The browser fetches it page-relative; a Node process has
//     no page to resolve against, so {@link loadTestSprites} reads the frames off
//     the project's own `assets/` tree.

import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { FOLDERS, type Sprites } from "./assets";
import { STAGE_H, STAGE_W } from "./constants";
import { createDebugApi, type WirewormDebugApi } from "./debug";
import { advance, createGame, createInitialState } from "./game";
import { IDLE_POINTER, type PointerFrame } from "./pointer";
import { createRuntime, type Runtime, type UpdateApi } from "./runtime";
import { COLOR } from "./theme";
import type { CueSink, WirewormState, Worm } from "./types";

/** An event carrying a `code`, which is all `src/keyboard.ts` reads. */
export function keyEvent(type: string, code: string): Event {
  const event = new Event(type);
  Object.assign(event, { code, repeat: false });
  return event;
}

/** A cue sink that remembers the names it was played, in order. */
export class CueLog implements CueSink {
  readonly played: string[] = [];

  play(cue: string): void {
    this.played.push(cue);
  }

  /** How many times `cue` was played. */
  count(cue: string): number {
    return this.played.filter((name) => name === cue).length;
  }

  clear(): void {
    this.played.length = 0;
  }
}

/** What {@link recordingAudio} hands back beside the context source. */
export interface AudioProbe {
  /** How many sources the bus has started since the page loaded. */
  started(): number;
  /** Forget the count, so a test can read one frame's worth. */
  reset(): void;
  /** The source `createRuntime` is handed. */
  source(): AudioContext | null;
}

/**
 * A fake audio context that counts started sources.
 *
 * It answers the same question the injected browser probe answers — was a sound
 * emitted, and when — without synthesizing anything.
 */
export function recordingAudio(): AudioProbe {
  let started = 0;
  const param = (): AudioParam =>
    ({
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    }) as unknown as AudioParam;
  const node = {
    connect(next: unknown) {
      return next;
    },
  };
  const context = {
    currentTime: 0,
    destination: node,
    createOscillator: () => ({
      ...node,
      type: "sine",
      frequency: param(),
      start: () => {
        started += 1;
      },
      stop: () => undefined,
    }),
    createGain: () => ({ ...node, gain: param() }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as AudioContext;
  return {
    started: () => started,
    reset: () => {
      started = 0;
    },
    source: () => context,
  };
}

/** Decode every seeded frame off the project's own `assets/` tree. */
export async function loadTestSprites(): Promise<Sprites> {
  const folders = Object.entries(FOLDERS) as [keyof Sprites, number][];
  const loaded = await Promise.all(
    folders.map(async ([folder, count]) => {
      const frames = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          loadImage(
            fileURLToPath(
              new URL(`../assets/${folder}/${index}.png`, import.meta.url),
            ),
          ),
        ),
      );
      return [folder, frames as unknown as Sprites[keyof Sprites]] as const;
    }),
  );
  return Object.fromEntries(loaded) as unknown as Sprites;
}

/** A game stood up over a canvas, a surface, and a clock the test owns. */
export interface Rig {
  runtime: Runtime<WirewormState>;
  state: WirewormState;
  debug: WirewormDebugApi;
  audio: AudioProbe;
  /** The canvas the frames are drawn to. */
  canvas: Canvas;
  /** The target key events are dispatched at. */
  keys: EventTarget;
  /** Press a key down. */
  down(code: string): void;
  /** Let a key up. */
  up(code: string): void;
  /** Press and release a key, which is one edge. */
  press(code: string): void;
  /** The color at a logical stage point, as `[r, g, b]`. */
  sample(x: number, y: number): [number, number, number];
  /** Drop the listeners. */
  dispose(): void;
}

/**
 * Stand the whole build up: the real runtime, the real game, and the real debug
 * surface, off the wall clock from the first frame.
 *
 * The canvas is the logical stage at a scale of one, so a logical point and a
 * device pixel coincide and {@link Rig.sample} can read a color straight off it.
 */
export function createRig(sprites: Sprites): Rig {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const keys = new EventTarget();
  const audio = recordingAudio();
  const runtime = createRuntime<WirewormState>({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: STAGE_W,
    height: STAGE_H,
    game: createGame(sprites),
    background: COLOR.bg,
    surface: {
      cssWidth: () => STAGE_W,
      cssHeight: () => STAGE_H,
      origin: () => ({ x: 0, y: 0 }),
      dpr: () => 1,
      events: () => keys,
    },
    audioContext: audio.source,
  });
  const state = runtime.initialize();
  // A gesture, because a browser opens no audio context without one and this
  // build honors that. It is what the browser-side harness does with a real
  // mouse press before it reads a cue.
  keys.dispatchEvent(new Event("pointerdown"));
  runtime.setAutoStep(false);
  const debug = createDebugApi(state, runtime);

  return {
    runtime,
    state,
    debug,
    audio,
    canvas,
    keys,
    down: (code) => {
      keys.dispatchEvent(keyEvent("keydown", code));
    },
    up: (code) => {
      keys.dispatchEvent(keyEvent("keyup", code));
    },
    press: (code) => {
      keys.dispatchEvent(keyEvent("keydown", code));
      keys.dispatchEvent(keyEvent("keyup", code));
    },
    sample: (x, y) => {
      const context = canvas.getContext("2d");
      const data = context.getImageData(
        Math.round(x),
        Math.round(y),
        1,
        1,
      ).data;
      return [data[0], data[1], data[2]];
    },
    dispose: () => runtime.destroy(),
  };
}

/**
 * Pose a live, empty board with every world gate off — the shape almost every
 * mechanic test starts from.
 *
 * Turning the three gates off is what makes a posed scenario hold: without them
 * the level's own spawners would put a glitch on the board within twelve seconds
 * and the banner would bring in a worm of its own, and the cursor parked at the
 * band's center would cost a life the moment anything reached it.
 */
export function startPlaying(rig: Rig, level = 1): void {
  const { debug } = rig;
  debug.reset({ seed: 1 });
  debug.setFoeSpawning(false);
  debug.setWormEntry(false);
  debug.setCursorContact(false);
  debug.setLevel(level);
  debug.setScreen("playing");
  debug.setPhase("active");
  debug.setPhaseTimer(0);
}

/** The average color over a tile, as `[r, g, b]`. */
export function tileAverage(
  rig: Rig,
  left: number,
  top: number,
  size: number,
): [number, number, number] {
  const data = rig.canvas
    .getContext("2d")
    .getImageData(left, top, size, size).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const pixels = data.length / 4;
  return [r / pixels, g / pixels, b / pixels];
}

/**
 * A live, empty board with every world gate off, built without a canvas.
 *
 * The rules modules are checked against this rather than through the runtime,
 * because what they decide is decided from the board alone: no canvas, no frame
 * loop, and no wall clock take any part in it, which is the render-free core
 * `specs/instrumentation.md` requires.
 */
export function posedState(level = 1): WirewormState {
  const state = createInitialState();
  state.foeSpawning = false;
  state.wormEntry = false;
  state.cursor.contact = false;
  state.level = level;
  state.screen = "playing";
  state.phase = "active";
  state.phaseTimer = 0;
  return state;
}

/**
 * Lay a worm on the board, head first, exactly as the debug surface's `addWorm`
 * and `appendSegment` would build it.
 */
export function layWorm(
  state: WirewormState,
  tiles: readonly (readonly [number, number])[],
  options: Partial<Omit<Worm, "id" | "segments">> = {},
): Worm {
  const worm: Worm = {
    id: state.nextId,
    segments: tiles.map(([c, r]) => ({ c, r })),
    dh: 1,
    dv: 1,
    diving: false,
    stepping: true,
    body: true,
    stepClock: 0,
    ...options,
  };
  state.nextId += 1;
  state.worms.push(worm);
  return worm;
}

/** The frame's input and audio, as a test decides them. */
export interface StubApi extends UpdateApi {
  /** The actions held for the whole of the next frame. */
  hold(...actions: string[]): void;
  /** Let every held action up. */
  release(): void;
  /** Arm an edge for exactly the next read. */
  tap(...actions: string[]): void;
  /** Hand the next frame this pointer report, in logical stage units. */
  point(frame: PointerFrame): void;
}

/** An `UpdateApi` a test drives directly, over a cue log of its own. */
export function stubApi(cues: CueSink): StubApi {
  const heldActions = new Set<string>();
  const edges = new Set<string>();
  let pointerFrame: PointerFrame = IDLE_POINTER;
  let muted = false;
  return {
    input: {
      value: (name) => (heldActions.has(name) ? 1 : 0),
      pressed: (name) => {
        if (!edges.has(name)) return false;
        edges.delete(name);
        return true;
      },
    },
    pointer: {
      frame: () => pointerFrame,
      forget: () => {
        pointerFrame = IDLE_POINTER;
      },
    },
    audio: {
      play: (cue) => cues.play(cue),
      setMuted: (next) => {
        muted = next;
      },
      muted: () => muted,
    },
    hold: (...actions) => {
      for (const action of actions) heldActions.add(action);
    },
    release: () => heldActions.clear(),
    tap: (...actions) => {
      for (const action of actions) edges.add(action);
    },
    point: (frame) => {
      pointerFrame = frame;
    },
  };
}

/**
 * Run `frames` whole frames covering `seconds` of game time through the game's
 * own `advance` — the very function the runtime's frame loop calls.
 */
export function run(
  state: WirewormState,
  api: UpdateApi,
  cues: CueSink,
  seconds: number,
  frames = 1,
): void {
  const step = seconds / frames;
  for (let i = 0; i < frames; i += 1) advance(state, api, step, cues);
}

/** One `drawImage` the build issued, as a check reads it back. */
export interface DrawnImage {
  /** The image source the build handed the call — an identity, not a copy. */
  image: unknown;
  /** Where the call put it, in the space the transform was carrying. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The horizontal scale in force, whose sign says whether it was mirrored. */
  scaleX: number;
}

/** A running record of the `drawImage` calls the build issues. */
export interface DrawLog {
  /** Every call since the log was armed. */
  calls: DrawnImage[];
  /** Forget them, so a check can read one frame's worth. */
  clear(): void;
  /** Put the context back as it was. */
  stop(): void;
}

/**
 * Watch the image draws the build makes.
 *
 * This is the in-process counterpart of the recorder a browser check installs:
 * it reads the IMAGE SOURCE handed to each `drawImage`, so a check can assert
 * that a node was drawn from a frame of the seeded art rather than from a
 * picture the build made for itself.
 */
export function captureDraws(rig: Rig): DrawLog {
  const context = rig.canvas.getContext("2d") as unknown as {
    drawImage: (...args: unknown[]) => void;
    getTransform?: () => { a: number };
  };
  const original = context.drawImage.bind(context);
  const calls: DrawnImage[] = [];
  context.drawImage = (...args: unknown[]): void => {
    const [image, x, y, w, h] = args as [
      unknown,
      number,
      number,
      number,
      number,
    ];
    calls.push({
      image,
      x,
      y,
      w,
      h,
      scaleX: context.getTransform?.().a ?? 1,
    });
    original(...args);
  };
  return {
    calls,
    clear: () => {
      calls.length = 0;
    },
    stop: () => {
      context.drawImage = original;
    },
  };
}

/** The separation between two colors, out of 441 (`3 * 255`, summed per channel). */
export function separation(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** The brightness of a color, as the sum of its channels. */
export function brightness(color: readonly [number, number, number]): number {
  return color[0] + color[1] + color[2];
}
