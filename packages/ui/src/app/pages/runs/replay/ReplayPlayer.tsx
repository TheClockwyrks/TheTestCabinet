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

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LoadingState } from "../../../components/LoadingState";
import { drawFrame, prepareRecording, type ReplayResources } from "./drawFrame";
import type { Replay3dResources } from "./drawFrame3d";
import { fetchRecording, type AnyRecording, type Recording } from "./format";
import {
  REPLAY_SPEEDS,
  timelineFor,
  useReplayClock,
  type ReplayClock,
} from "./useReplayClock";
import styles from "./ReplayPlayer.module.scss";

// The 3D pane brings `three`, a glTF parser and a scene drawer with it, so it
// is fetched only by a page that actually has a 3D recording to show — the
// same split the console's other three-backed viewers use. A 2D replay never
// pays for it.
const Replay3dCanvas = lazy(() => import("./Replay3dCanvas"));

/** A recording being fetched, the recording, or the reason there is none. */
export interface LoadedRecording {
  /** The recording, once it has arrived and been read. */
  readonly recording: AnyRecording | null;
  /**
   * What it draws with, decoded — set with the recording, so the two never
   * disagree. A 2D recording's images or a 3D one's assets, matching its
   * space: the loader below is the only thing that builds the pair, and it
   * builds both halves from the one document.
   */
  readonly resources: ReplayResources | Replay3dResources | null;
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
 * a missing sprite costs the sprite rather than the replay. Only a bitmap can fail
 * that way; a pixel buffer carries its own bytes and is rebuilt from them.
 *
 * A `null` url is not an error — it is the caller saying there is nothing on this
 * side, which is how the review pair renders a case that ships no reference
 * recording beside a run that produced one.
 */
export function useRecording(url: string | null): LoadedRecording {
  const [state, setState] = useState<LoadedRecording>({
    recording: null,
    resources: null,
    error: null,
    loading: url !== null,
  });

  useEffect(() => {
    if (url === null) {
      setState({
        recording: null,
        resources: null,
        error: null,
        loading: false,
      });
      return;
    }
    let cancelled = false;
    setState({ recording: null, resources: null, error: null, loading: true });
    fetchRecording(url)
      .then(async (recording) => {
        if (recording.space === "3d") {
          // Fetched rather than imported, so that everything three brings with
          // it — the renderer, the glTF parser, the scene drawer — lands in
          // the chunk the 3D pane is in rather than in the entry bundle.
          const { prepare3dReplay } = await import("./threeSceneDrawer");
          return { recording, resources: await prepare3dReplay(recording) };
        }
        return { recording, resources: await prepareRecording(recording) };
      })
      .then(
        ({ recording, resources }) => {
          if (!cancelled) {
            setState({ recording, resources, error: null, loading: false });
          }
        },
        (err: unknown) => {
          if (cancelled) return;
          setState({
            recording: null,
            resources: null,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

/**
 * One recording, drawn at one frame, whichever space it was drawn in.
 *
 * This is the whole of the player's dispatch, and it is per RECORDING rather
 * than per page: a document that states no space is drawn on a 2D canvas, and
 * one that states `"3d"` is drawn by the scene drawer, so every mount point —
 * the lone player below, both panes of the reviewer's validation pair — gets
 * both spaces without knowing there are two. A document whose space this
 * player does not draw never reaches here at all: `parseRecording` refuses it
 * by name, and the refusal surfaces as the error paragraph a failed fetch
 * does.
 *
 * There are no hooks here on purpose. The two bodies below have their own, and
 * a component that branched before its hooks would be calling a different
 * number of them for a 2D recording than for a 3D one.
 */
export function ReplayCanvas({
  recording,
  resources,
  frame,
  label,
}: {
  recording: AnyRecording;
  /** What the loader decoded for THIS recording, in this recording's space. */
  resources: ReplayResources | Replay3dResources;
  frame: number;
  /** Accessible label for the canvas (what is being replayed). */
  label: string;
}) {
  // The pair is built by one loader from one document, so a half that does not
  // match its recording is unreachable — but the two halves are still checked
  // against each other here, because the alternative to a sentence is a pane
  // drawing a recording against another one's pictures.
  if (recording.space === "3d") {
    if (!("assets" in resources)) return <MismatchedResources />;
    return (
      <Suspense fallback={<p className={styles.error}>Loading the replay…</p>}>
        <Replay3dCanvas
          recording={recording}
          resources={resources}
          frame={frame}
          label={label}
        />
      </Suspense>
    );
  }
  if (!("images" in resources)) return <MismatchedResources />;
  return (
    <Replay2dCanvas
      recording={recording}
      resources={resources}
      frame={frame}
      label={label}
    />
  );
}

/** What a pane says when its recording and its decoded values disagree. */
function MismatchedResources() {
  return (
    <p className={styles.error}>
      This replay cannot be played. The player decoded it in a drawing space
      other than the one it states.
    </p>
  );
}

/**
 * One 2D recording, drawn at one frame.
 *
 * The frame asked for is clamped into the recording, which is what lets a pane
 * hold on its last frame while the pane beside it — a longer recording of the same
 * scenario — plays on. The canvas is sized from the surface the frame was recorded
 * into rather than the recording's logical design size: the operations are in that
 * surface's device pixels (the engine's own letterbox transform is the first thing
 * every frame does), so a backing store of exactly that size reproduces the picture
 * the build drew, letterbox included, and CSS scales it to the pane.
 */
function Replay2dCanvas({
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
}: {
  url: string;
  label: string;
  presentation?: ReplayPresentation;
}) {
  const showcase = presentation === "showcase";
  const { recording, resources, error, loading } = useRecording(url);
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
    return <LoadingState size="section" label="Loading the replay…" />;
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
