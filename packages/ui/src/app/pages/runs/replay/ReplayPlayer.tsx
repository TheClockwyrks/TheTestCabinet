// The engine replay player: the pieces a page composes to put a recording on
// screen, and the self-contained player that composes them for one recording.
//
// The pieces are separate from the whole on purpose. A single recording — a
// declared proof, a reference clip — wants a canvas with its own transport under
// it, which is `ReplayPlayer`. A reviewer's automated-validation comparison wants
// TWO canvases under ONE transport, so that scrubbing moves the case's reference
// and this run's build to the same frame together (see `ValidationReplayPair`).
// Both are the same three parts — a clock, a canvas per recording, one transport —
// wired differently, so a change to how a frame is drawn or how playback is paced
// reaches both.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createAssetCache, useCachedAsset } from "../../../data/assetCache";
import { LoadingState } from "../../../components/LoadingState";
import {
  drawFrame,
  prepareRecording,
  type ReplayResources,
  type StoredImageResolver,
} from "./drawFrame";
import { fetchRecording, recordingBytes, type Recording } from "./format";
import {
  REPLAY_SPEEDS,
  timelineFor,
  useReplayClock,
  type ReplayClock,
} from "./useReplayClock";
import styles from "./ReplayPlayer.module.scss";

/** A recording being fetched, the recording, or the reason there is none. */
export interface LoadedRecording {
  /** The recording, once it has arrived and been read. */
  readonly recording: Recording | null;
  /** Its images, decoded — set with the recording, so the two never disagree. */
  readonly resources: ReplayResources | null;
  /** Why there is no recording to show, written for a reviewer. */
  readonly error: string | null;
  /** Whether the fetch is still in flight. */
  readonly loading: boolean;
}

/**
 * Fetch the recording at `url`, decode what it draws with, or report why it
 * cannot be played.
 *
 * The decode is part of the load rather than part of the draw: a recording's
 * bitmaps are PNG data URLs, turning one back into pixels is asynchronous, and
 * drawing a frame has to be synchronous for a scrub to keep up with a dragged
 * thumb. So the recording is not handed on until its images are ready, and the two
 * are held together — a canvas asked to draw a recording with another one's
 * resources would resolve its sprites to the wrong pictures.
 *
 * A recording whose images do not decode still plays: `prepareRecording` reports a
 * failed entry as `null` and the operations naming it are skipped and counted, so
 * a missing sprite costs the sprite rather than the replay.
 *
 * `resolveStored` is how an entry that keeps its pixels beside the recording is
 * reached: it turns the flat file name the entry carries into a URL, and it is the
 * caller's business because it is the caller that knew where the recording itself
 * came from — the same `(runId | subject, file) => url` function resolved both. A
 * caller that supplies none, or one that answers `null`, does not break the replay:
 * those entries resolve to `null` like an undecodable PNG and the operations naming
 * them are skipped and named under the canvas.
 *
 * THE URL ALONE DRIVES THE FETCH. `resolveStored` is deliberately kept OUT of the
 * dependencies and read through a ref, because the resolver is a property of the
 * recording's own namespace and cannot meaningfully change without the URL changing
 * — while its identity changes constantly. The console's gallery context is rebuilt
 * on every render of the app shell, so every entry it hands out carries a freshly
 * minted closure; listing that closure would restart the load on each of them and
 * blank the player to its loading state. A reviewer scrubbing a validation pair
 * would watch both panes reset to a spinner and re-download their recordings — and
 * every stored image beside them — each time a run finished anywhere in the console.
 * A caller therefore does NOT have to memoize the resolver.
 *
 * A RECORDING ALREADY LOADED IS NOT LOADED AGAIN, and a mount that finds one
 * reports `loading: false` on its very first frame. Every tab of a run's detail page
 * is its own route, so leaving the Play tab unmounts the player whole; the prepared
 * pair is held by URL in a process-wide cache, so coming back draws the picture
 * immediately instead of refetching a document and re-decoding every PNG in it. Two
 * panes that name the same URL share one load for the same reason.
 *
 * A `null` url is not an error — it is the caller saying there is nothing on this
 * side, which is how the review pair renders a case that ships no reference
 * recording beside a run that produced one.
 */
export function useRecording(
  url: string | null,
  resolveStored?: StoredImageResolver | null,
): LoadedRecording {
  // The resolver is a property of the recording's own namespace and cannot
  // meaningfully change without the URL changing, so it is passed as the cache's
  // per-call loader — held in a ref by `useCachedAsset`, never depended on.
  const load = useCallback(
    (target: string) =>
      fetchRecording(target).then(async (recording) => ({
        recording,
        // Nothing is published until every image is resolved — a stored entry's
        // fetch included — because `drawFrame` is synchronous and a scrub has to
        // keep up with a dragged thumb.
        resources: await prepareRecording(
          recording,
          undefined,
          resolveStored ?? undefined,
        ),
      })),
    [resolveStored],
  );
  const { data, loading, error } = useCachedAsset(
    preparedRecordings,
    url,
    load,
  );
  // A fresh object every render would re-seed the canvas's own memos forever, so
  // the two halves are handed on together and only when one of them moves.
  return useMemo(
    () => ({
      recording: data?.recording ?? null,
      resources: data?.resources ?? null,
      error,
      loading,
    }),
    [data, error, loading],
  );
}

/** A recording and its decoded images — the pair a canvas can be handed. */
interface PreparedRecording {
  readonly recording: Recording;
  readonly resources: ReplayResources;
}

/**
 * What one prepared recording costs, in bytes.
 *
 * The decoded images are the expensive half and the only half that can be measured:
 * an `ImageData` reports its buffer, and a decoded bitmap costs four bytes per pixel
 * of the size the platform decoded it at. The recording's own bytes are counted too,
 * because a prepared entry holds the parsed document alive whether or not the
 * recording cache still lists it.
 */
function weighPrepared(prepared: PreparedRecording): number {
  let bytes = recordingBytes(prepared.recording);
  for (const image of prepared.resources.images) {
    if (image === null) continue;
    if (typeof ImageData === "function" && image instanceof ImageData) {
      bytes += image.data.byteLength;
      continue;
    }
    // Every other decoded form reports its size under one of these names — a
    // decoded `<img>` under `natural*`, a bitmap or canvas under the bare pair, a
    // video frame under `display*` — and a form that reports none is counted as
    // nothing rather than guessed at.
    const sized = image as {
      naturalWidth?: number;
      naturalHeight?: number;
      width?: number;
      height?: number;
      displayWidth?: number;
      displayHeight?: number;
    };
    const width = sized.naturalWidth ?? sized.width ?? sized.displayWidth ?? 0;
    const height =
      sized.naturalHeight ?? sized.height ?? sized.displayHeight ?? 0;
    bytes += width * height * 4;
  }
  return bytes;
}

// The prepared recordings, by URL: what the player actually draws from.
//
// This is the cache the reported bug is about. Every tab of a run's detail page is
// its own route, so clicking from the Play tab to the images and back unmounts the
// player whole; without this, coming back re-downloaded the recording and re-decoded
// every PNG in it, and put a spinner over a picture the reviewer had just been
// looking at.
//
// Bounded at 192 MB, an order of magnitude above the recordings themselves because
// a decoded picture is RGBA in memory while the document carried it as compressed
// base64 — one full-surface frame is 8 MB. That holds both panes of a validation
// pair, the run's own proofs, and the run beside it, which is everything a reviewer
// has in play at once; the count cap keeps a case with many small clips from
// holding all of them.
const preparedRecordings = createAssetCache<PreparedRecording>({
  name: "prepared replay",
  maxEntries: 8,
  maxBytes: 192 * 1024 * 1024,
  weigh: weighPrepared,
});

/** Drop every prepared recording. For tests; one is never invalidated. */
export function clearPreparedRecordingCache(): void {
  preparedRecordings.clear();
}

/**
 * One recording, drawn at one frame.
 *
 * The frame asked for is clamped into the recording, which is what lets a pane
 * hold on its last frame while the pane beside it — a longer recording of the same
 * scenario — plays on. The canvas is sized from the surface the frame was recorded
 * into rather than the recording's logical design size: the operations are in that
 * surface's device pixels (the engine's own letterbox transform is the first thing
 * every frame does), so a backing store of exactly that size reproduces the picture
 * the build drew, letterbox included, and CSS scales it to the pane.
 */
export function ReplayCanvas({
  recording,
  resources,
  frame,
  label,
}: {
  recording: Recording;
  /** What `prepareRecording` returned for THIS recording. */
  resources: ReplayResources;
  frame: number;
  /** Accessible label for the canvas (what is being replayed). */
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const shown = Math.max(0, Math.min(frame, recording.frames.length - 1));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const shot = recording.frames[shown];
    if (shot === undefined) return;
    // A recording taken before the canvas was ever laid out carries a zero-sized
    // surface; the logical design size is the only other size it states.
    const width = shot.surface.width > 0 ? shot.surface.width : recording.width;
    const height =
      shot.surface.height > 0 ? shot.surface.height : recording.height;
    // Assigning either dimension wipes the canvas and resets the context, so it is
    // done only when the size actually changed — a recording whose surface never
    // moves resizes once, on its first frame.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      setNote("This browser did not give the player a 2D canvas to draw into.");
      return;
    }
    const report = drawFrame(ctx, recording, resources, shown);
    // "Parts" rather than "operations": the count covers the frame's own operations
    // and the parts of the state it inherited alike — a style property, a step of a
    // clip or a path, a transform, a dash — and calling all of them operations would
    // have a reviewer looking for something in the frame's drawing that is not
    // there.
    //
    // `setNote` with the identical string is a no-op in React, so a recording that
    // reproduces cleanly (or reproduces the same gap every frame) does not
    // re-render the tree sixty times a second while it plays.
    setNote(
      report.skipped === 0
        ? null
        : `${report.skipped} ${report.skipped === 1 ? "part" : "parts"} of this frame could not be reproduced (${report.unreproducible.join(", ")}).`,
    );
  }, [recording, resources, shown]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        // The intrinsic size until the first frame is drawn, so the pane reserves
        // the right shape rather than collapsing and then jumping.
        width={recording.width}
        height={recording.height}
        aria-label={label}
        role="img"
      />
      {note !== null && <p className={styles.note}>{note}</p>}
    </>
  );
}

/**
 * The transport for a clock: play/pause, the frame scrubber, where it is, and how
 * fast it runs.
 *
 * It drives the clock, not a canvas, so one row of these controls moves every pane
 * the clock feeds.
 */
export function ReplayTransport({ clock }: { clock: ReplayClock }) {
  const id = useId();
  const empty = clock.frames === 0;
  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={styles.control}
        onClick={clock.toggle}
        disabled={empty}
        aria-pressed={clock.playing}
      >
        {clock.playing ? "⏸ Pause" : clock.atEnd ? "▶ Replay" : "▶ Play"}
      </button>
      <label className={styles.controlLabel} htmlFor={`${id}-frame`}>
        frame
      </label>
      <input
        id={`${id}-frame`}
        className={styles.scrub}
        type="range"
        min={0}
        max={Math.max(0, clock.frames - 1)}
        step={1}
        value={clock.frame}
        disabled={empty}
        onChange={(e) => clock.seek(Number(e.target.value))}
      />
      <span className={styles.position}>
        {clock.frame + 1} / {clock.frames}
      </span>
      <label className={styles.controlLabel} htmlFor={`${id}-speed`}>
        speed
      </label>
      <select
        id={`${id}-speed`}
        className={styles.speed}
        value={clock.speed}
        disabled={empty}
        onChange={(e) => clock.setSpeed(Number(e.target.value))}
      >
        {REPLAY_SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The scrubber alone, laid over the bottom of a canvas.
 *
 * It appears while the pointer is over the replay or the control has focus, and
 * takes no space of its own, so a carousel stepping between a picture and a replay
 * keeps one height.
 */
function ReplayScrub({ clock, label }: { clock: ReplayClock; label: string }) {
  return (
    <input
      className={styles.overlayScrub}
      type="range"
      min={0}
      max={Math.max(0, clock.frames - 1)}
      step={1}
      value={clock.frame}
      disabled={clock.frames === 0}
      aria-label={`Scrub ${label}`}
      onChange={(e) => clock.seek(Number(e.target.value))}
    />
  );
}

/** How a player presents one recording. */
export type ReplayPresentation =
  /** Stopped on frame 0 under the full transport: play/pause, scrub, speed. */
  | "transport"
  /** Playing on a loop, with the scrubber laid over the canvas on hover. */
  | "showcase";

/**
 * A whole player for one recording: fetch it, draw it, and drive it.
 *
 * This is what a lone replay renders as: a declared proof captured as a recording,
 * a reference shot that is one, an entry in a run's showcase carousel. The
 * reviewer's side-by-side comparison does not use it, because its two panes have
 * to share one clock; it composes the same parts itself.
 *
 * The `showcase` presentation is for a replay standing in for a screenshot. It
 * plays itself, loops, and keeps the transport out of the layout: what the visitor
 * came for is the game moving, and a bar under it both invites a decision nobody
 * needs to make and changes the stage's height as the carousel steps.
 */
export function ReplayPlayer({
  url,
  label,
  presentation = "transport",
  storeUrl,
}: {
  url: string;
  label: string;
  presentation?: ReplayPresentation;
  /**
   * Where to find an image this recording keeps beside itself, by file name.
   *
   * Optional, and absent for every showcase replay: those are authored by hand and
   * carry their pixels inline, so there is nothing beside them to reach. An entry
   * that somehow arrived stored without one degrades to a named skip rather than to
   * a wrong picture. Memoize it — it drives the fetch effect.
   */
  storeUrl?: StoredImageResolver | null;
}) {
  const showcase = presentation === "showcase";
  const { recording, resources, error, loading } = useRecording(url, storeUrl);
  const timeline = useMemo(() => timelineFor([recording]), [recording]);
  const clock = useReplayClock(timeline, {
    autoPlay: showcase,
    loop: showcase,
  });

  if (error !== null) {
    return (
      <p className={styles.error}>This replay cannot be played. {error}</p>
    );
  }
  if (loading || recording === null || resources === null) {
    // A showcase replay plays on a stage whose geometry is already fixed (16:9,
    // clipped), so the wait has to fit that box rather than reserve a section's
    // worth of room inside it; anywhere else the player stands in page flow.
    return (
      <LoadingState
        size={showcase ? "fill" : "section"}
        label="Loading the replay…"
      />
    );
  }
  if (recording.frames.length === 0) {
    return <p className={styles.error}>This replay recorded no frames.</p>;
  }

  const canvas = (
    <ReplayCanvas
      recording={recording}
      resources={resources}
      frame={clock.frame}
      label={label}
    />
  );

  if (showcase) {
    return (
      // Scrubbing stops the clock, so leaving the replay hands it back: the
      // visitor gets the moving picture they arrived at without pressing anything.
      <div
        className={styles.stage}
        onPointerLeave={() => {
          if (!clock.playing) clock.toggle();
        }}
      >
        {canvas}
        <ReplayScrub clock={clock} label={label} />
      </div>
    );
  }

  return (
    <div className={styles.player}>
      {canvas}
      <ReplayTransport clock={clock} />
    </div>
  );
}
