// The replay a 2D engine's own recorder produces. 2D ONLY.
//
// A 2D engine carries an opt-in draw-command recorder: `startRecording` arms it,
// `stopRecording` hands back a document of every operation the rendering pipeline
// issued, frame by frame, and the console's player re-issues those operations
// against a context of its own to reproduce the picture. That document is
// STRUCTURALLY the format `../replay/format` already declares — the engines'
// version says `readonly` where the package's does not, and is otherwise the same
// document — so the thinning and re-tabling this package already ships apply to
// it unchanged, and the copy each engine harness carried of them does not have to.
//
// A 3D ENGINE'S RECORDING IS A DIFFERENT THING ENTIRELY: `stopRecording` there
// answers a PROMISE of VP9 video, and `DrawOp`, `DrawState`, `PathSegment` and
// `CapturedImage` do not exist in its contract at all. So this module is 2D-only
// and nothing neutral imports it. A 3D case captures stills through
// `./capture`'s neutral writers and documents that it has no replay — which is
// what the two 3D harnesses in the tree already do.

import { gzipSync } from "node:zlib";
import type { Recording } from "../replay/format";
import { thinReplay } from "../replay/retable";
import { captureAround } from "./capture";

/**
 * A recording as a 2D ENGINE hands it back.
 *
 * The engines declare every table `readonly`, which the package's own
 * {@link Recording} does not, so an engine's value is not assignable to it
 * directly even though it is the same document. Rather than force a case to cast
 * at its own call site — where the cast would have to be repeated once per case
 * and would be the kind of thing that quietly stops being true — the boundary is
 * declared here, once, as what it actually is: the same nine fields, with the
 * tables opaque, which is all this module needs to know to hand the value on.
 */
export interface EngineRecording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: readonly unknown[];
  resources: readonly unknown[];
  ops: readonly unknown[];
  states: readonly unknown[];
  frames: readonly unknown[];
}

/** As much of a 2D engine as capturing a replay needs. */
export interface RecordingEngine {
  /** Begin capturing draw commands; capture starts at the next frame. */
  startRecording(): void;
  /** Stop capturing and hand back everything captured since `startRecording`. */
  stopRecording(): EngineRecording;
}

/**
 * A recording, thinned to the cap and re-expressed against tables of its own, as
 * the gzipped bytes that land on disk — or `null` when there is nothing to look
 * at.
 *
 * WHAT LANDS IS GZIP RATHER THAN RAW JSON. A recording is text made almost
 * entirely of numbers, index lists and field names repeated once per frame, which
 * is close to the shape gzip is best at, and that is what keeps a run's whole set
 * of recordings to a few megabytes. Every host that serves one declares the
 * encoding, so the browser inflates it before the player sees it and the document
 * inside is the same one.
 *
 * A capture that closed no frames answers `null`. There is no picture in it, and
 * a file holding an empty frame list would be collected as an output that turned
 * up — the run would tell the reviewer there is a replay to watch and the player
 * would open on nothing.
 */
export function replayBytes(recording: EngineRecording): Uint8Array | null {
  if (recording.frames.length === 0) return null;
  // The two documents are the same nine fields; the engines' is `readonly` and
  // the package's is not, and nothing downstream writes to what it was handed —
  // `thinReplay` builds every table it answers with fresh.
  const document = recording as unknown as Recording;
  return gzipSync(JSON.stringify(thinReplay(document)));
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * await captureReplay(h, "extend", async () => {
 *   h.debug.pointerMove(x, y);
 *   await h.advance(12);
 * });
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 */
export async function captureEngineReplay<T>(
  slug: string,
  projectRoot: string,
  engine: RecordingEngine,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return captureAround(
    slug,
    projectRoot,
    outputId,
    "json.gz",
    () => {
      engine.startRecording();
    },
    () => replayBytes(engine.stopRecording()),
    scenario,
  );
}

/**
 * {@link captureEngineReplay} bound to one case, which is what a case's
 * `harness.ts` exports as its own `captureReplay`.
 *
 * The kit does not carry this member and deliberately: a still is a PNG off a
 * canvas and every engine harness has one, while a replay is a 2D engine's
 * draw-op log — a 3D engine answers VP9 video from `stopRecording` and none of
 * the thinning above applies to it. Binding it here keeps the kit, and everything
 * that imports the kit, clear of the 2D replay stack.
 */
export function makeReplayCapture(
  slug: string,
  projectRoot: string,
): <T>(
  h: { readonly engine: unknown },
  outputId: string,
  scenario: () => T | Promise<T>,
) => Promise<T> {
  return (h, outputId, scenario) =>
    captureEngineReplay(
      slug,
      projectRoot,
      h.engine as RecordingEngine,
      outputId,
      scenario,
    );
}
