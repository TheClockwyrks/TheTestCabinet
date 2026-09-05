// Facet — the browser faculties a headless engine run needs. CASE-PROVIDED.
//
// SHARED FILE. Byte-identical in `validation/simple-2d/` and
// `validation/structured-2d/`, the two directories a headless engine run lives
// in. It is copied between them rather than re-derived, so a build stood up
// under one engine is given exactly the faculties a build under the other is
// given and no check can turn on which shim it got. An edit belongs in both
// copies at once; two copies that differ are a defect in the case.
//
// The suites in this directory run the build IN PROCESS, in Node, over an
// `@napi-rs/canvas` canvas. The engine takes every measurement through the
// `SurfaceMetrics` the harness supplies, so it needs no DOM — but four globals
// a browser has and Node does not are still reached for, by the ENGINE and by
// the packages a Facet build is entitled to use, while a frame runs. Each is
// installed here, and each is the CASE's responsibility rather than the
// build's: without them the build would fail checks over a fault this harness
// created.
//
// 1. `fetch`. The engine's asset loader resolves every path under `assets/` and
//    fetches it (`AssetLoader.resolve`, `attempt`). A Facet build's gems, break
//    sheets, particle systems, sounds and music are ALL produced files
//    (specs/assets.md), so with no transport not one of them loads and every
//    check that reads the board's drawing would be deciding a question about
//    Node rather than about the build. This one serves the build's own tree off
//    disk, and answers a file that is not there with a 404 rather than a throw,
//    which is what the loader's own failure path expects.
// 2. `createImageBitmap`. The loader decodes an image with it and rejects by
//    name where the host has none. `@napi-rs/canvas`'s `loadImage` is the
//    decoder Node has.
// 3. `AudioContext`. This one is load-bearing in a way that is easy to miss.
//    `api.audio.load(cue, file)` decodes through `AudioContext.decodeAudioData`,
//    and a rejected load leaves the cue UNDECLARED — after which the engine's
//    `play` THROWS ("unknown audio cue ...") from inside the build's own
//    `update`, failing every check in the suite over a fault the harness
//    created. The stub decodes to a buffer-shaped value and builds inert nodes,
//    so the bus declares its cues, announces every `cue:played` exactly as it
//    would in a browser, and makes no sound.
// 4. `OffscreenCanvas`, and a `document` that can make a canvas.
//    `@clockwyrks/particle-runtime` composites through a context it owns, and
//    a build is entitled to ask the platform for that second surface.
//
// EVERY SHIM IS INSTALLED BY `setup.ts`, through vitest's `setupFiles`, because
// that is the only moment they are in place before a test file's import of
// `../src/game` is evaluated. `installDomShims` returns the function that puts
// every previous global back.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The workspace this validator project sits in.
 *
 * Derived from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/simple-2d/`, and the `validation/` the runner
 * stages that directory to inside the build's tree.
 */
const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where a produced file is looked for, in order.
 *
 * The built output first, because that is what a player is served and what an
 * asset check is really about; `public/` last, because a build whose `dist/` is
 * missing a produced file it committed has a fault worth seeing rather than
 * papering over — the built tree is consulted first and only a build that has
 * not been built at all falls through to the source tree.
 */
const ASSET_DIRS = ["dist", "build", "out", "public"] as const;

/** Whether the disk transport is currently serving. */
let serving = true;

/**
 * Turn the disk transport on or off.
 *
 * `createHarness({ assets: false })` uses it for the one kind of check that is
 * about a build surviving assets that never arrive. It is process-global, so a
 * harness built that way must be the only one alive.
 */
export function setAssetTransport(enabled: boolean): void {
  serving = enabled;
}

/** The build's own tree, served to the engine's asset loader. */
async function diskFetch(input: unknown): Promise<Response> {
  const url = String(input);
  if (!serving) {
    return new Response(null, { status: 503, statusText: "no transport" });
  }
  for (const dir of ASSET_DIRS) {
    try {
      const body = await readFile(join(WORKSPACE, dir, url));
      return new Response(new Uint8Array(body), { status: 200 });
    } catch {
      // Not under this root; try the next.
    }
  }
  return new Response(null, { status: 404, statusText: "Not Found" });
}

/** `createImageBitmap` over `@napi-rs/canvas`, which Node can decode with. */
async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  return (await loadImage(bytes)) as unknown as ImageBitmap;
}

/** An audio parameter that accepts every schedule the engine writes to one. */
function audioParam(value: number): Record<string, unknown> {
  const param = {
    value,
    setValueAtTime: () => param,
    linearRampToValueAtTime: () => param,
    exponentialRampToValueAtTime: () => param,
    setTargetAtTime: () => param,
    cancelScheduledValues: () => param,
  };
  return param;
}

/** A node that accepts a graph being built around it and makes no sound. */
function audioNode(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    connect: (destination: unknown) => destination,
    disconnect: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    onended: null,
    ...extra,
  };
}

/**
 * A context that decodes and builds a graph, and plays nothing.
 *
 * Its whole job is to let the engine's audio bus behave exactly as it does in a
 * browser — declare a file-backed cue, announce it when it plays, apply the
 * mute — while no sound is made and nothing is scheduled on a real clock.
 */
class StubAudioContext {
  currentTime = 0;
  sampleRate = 48_000;
  state = "running";
  destination = audioNode();

  decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    const length = Math.max(1, Math.floor(data.byteLength / 4));
    return Promise.resolve({
      duration: length / this.sampleRate,
      length,
      numberOfChannels: 1,
      sampleRate: this.sampleRate,
      getChannelData: () => new Float32Array(length),
    });
  }

  createGain(): Record<string, unknown> {
    return audioNode({ gain: audioParam(1) });
  }

  createOscillator(): Record<string, unknown> {
    return audioNode({
      type: "sine",
      frequency: audioParam(440),
      detune: audioParam(0),
    });
  }

  createBufferSource(): Record<string, unknown> {
    return audioNode({
      buffer: null,
      loop: false,
      playbackRate: audioParam(1),
    });
  }

  createBuffer(channels: number, length: number, rate: number): unknown {
    return {
      duration: length / rate,
      length,
      numberOfChannels: channels,
      sampleRate: rate,
      getChannelData: () => new Float32Array(length),
    };
  }

  createStereoPanner(): Record<string, unknown> {
    return audioNode({ pan: audioParam(0) });
  }

  createBiquadFilter(): Record<string, unknown> {
    return audioNode({
      type: "lowpass",
      frequency: audioParam(350),
      Q: audioParam(1),
      gain: audioParam(0),
    });
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

/**
 * A canvas the size asked for, over `@napi-rs/canvas`.
 *
 * The real `getContext` is bound before the shadowing one is assigned: the
 * assignment shadows the prototype method, so a wrapper that called
 * `canvas.getContext` would call itself. It is still called lazily rather than
 * captured, because a caller is entitled to resize the canvas after making it
 * and a context read before that would be the wrong size.
 */
function scratchCanvas(width: number, height: number): unknown {
  const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
  const context = canvas.getContext.bind(canvas) as (
    kind: "2d",
  ) => SKRSContext2D;
  return Object.assign(canvas, {
    style: {},
    getContext: (): SKRSContext2D => context("2d"),
  });
}

/** An `OffscreenCanvas`-shaped class over `@napi-rs/canvas`. */
class StubOffscreenCanvas {
  private readonly surface: { getContext: () => SKRSContext2D };
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.surface = scratchCanvas(width, height) as {
      getContext: () => SKRSContext2D;
    };
  }

  getContext(): SKRSContext2D {
    return this.surface.getContext();
  }
}

/** The globals this module installs, by name. */
type Shimmed =
  | "fetch"
  | "createImageBitmap"
  | "AudioContext"
  | "OffscreenCanvas"
  | "document";

/**
 * Install every shim, and hand back the function that puts what was there back.
 *
 * A global that already exists is left exactly as it is: a host that really has
 * one is a better answer than a stub of it, and `setup.ts` may be run in an
 * environment that provides some of these.
 */
export function installDomShims(): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, unknown>();
  const install = (name: Shimmed, value: unknown): void => {
    if (globals[name] !== undefined) return;
    previous.set(name, globals[name]);
    globals[name] = value;
  };

  // `fetch` is replaced even where Node has one: Node's would reach the network
  // for a relative path it cannot resolve, and the build's assets are on disk.
  previous.set("fetch", globals.fetch);
  globals.fetch = diskFetch;

  install("createImageBitmap", decodeImage);
  install("AudioContext", StubAudioContext);
  install("OffscreenCanvas", StubOffscreenCanvas);
  install("document", {
    createElement: (tag: string): unknown => {
      if (tag !== "canvas") {
        throw new Error(
          `Facet's validation harness makes no <${tag}>: only a canvas`,
        );
      }
      return scratchCanvas(300, 150);
    },
  });

  return (): void => {
    for (const [name, value] of previous) {
      if (value === undefined) delete globals[name];
      else globals[name] = value;
    }
    previous.clear();
    serving = true;
  };
}
