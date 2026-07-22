// The Lattice performance-playback engine worker.
//
// A performance run publishes its OWN `engine.wasm` (the submission's engine), and
// browser playback reconstructs the factory by stepping THAT module — not the
// vendored reference engine. The submission's engine is arbitrary code: its
// `playback_load` runs the whole scored window up front and can trap, spin, or grow
// memory until it OOMs. Running it on the main thread would freeze the tab (or take
// it down) with no way to intervene, so the engine lives here in a Web Worker that
// the overlay can `terminate()` on a load timeout or on exit.
//
// The worker owns nothing but the wasm: it instantiates the engine, loads the
// scenario, then steps it to exhaustion and streams the decoded snapshots back in
// batches. The main thread caches those frames and does all rendering (canvas,
// sprite sheet) itself — the Engine is pure wasm with no DOM, so it runs unchanged
// in a worker, but the Renderer needs a canvas and stays on the main thread.

import { Engine, type Snapshot } from "./renderer";

/** A message the overlay posts to the worker. */
export type PlaybackWorkerRequest = {
  type: "init";
  /** The run's `engine.wasm` bytes (transferred). */
  wasm: ArrayBuffer;
  /** The scored scenario JSON to load and step. */
  scenario: unknown;
};

/** A message the worker posts back to the overlay. */
export type PlaybackWorkerResponse =
  | { type: "ready"; board: unknown }
  | { type: "frames"; batch: Snapshot[] }
  | { type: "complete" }
  | { type: "fail"; message: string };

// Snapshots per posted message. Frames are small and the whole window is stepped as
// fast as the engine allows, so batching keeps the message count (and the structured
// clone overhead) down without letting the main thread wait long for its first draw.
const BATCH = 64;

function post(message: PlaybackWorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

async function run(wasm: ArrayBuffer, scenario: unknown): Promise<void> {
  let engine: Engine;
  try {
    engine = await Engine.instantiate(wasm);
  } catch (err) {
    // The module failed to instantiate — a malformed or incompatible wasm.
    post({ type: "fail", message: messageOf(err) });
    return;
  }

  try {
    if (!engine.load(scenario)) {
      post({ type: "fail", message: "the engine rejected this scenario" });
      return;
    }
    post({ type: "ready", board: engine.board() });

    let batch: Snapshot[] = [];
    for (;;) {
      const frame = engine.step();
      if (!frame) break;
      batch.push(frame);
      if (batch.length >= BATCH) {
        post({ type: "frames", batch });
        batch = [];
      }
    }
    if (batch.length > 0) post({ type: "frames", batch });
    post({ type: "complete" });
  } catch (err) {
    // A trap while loading or stepping the submission's engine (e.g. it ran the
    // window out of fuel or grew memory past the limit and faulted).
    post({ type: "fail", message: messageOf(err) });
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

self.addEventListener("message", (event: MessageEvent<PlaybackWorkerRequest>) => {
  const data = event.data;
  if (data.type === "init") {
    void run(data.wasm, data.scenario);
  }
});
