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
import { drawFrame } from "./drawFrame";
import { fetchRecording, type Recording } from "./format";
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
  /** Why there is no recording to show, written for a reviewer. */
  readonly error: string | null;
  /** Whether the fetch is still in flight. */
  readonly loading: boolean;
}

/**
 * Fetch and read the recording at `url`, or report why it cannot be played.
 *
 * A `null` url is not an error — it is the caller saying there is nothing on this
 * side, which is how the review pair renders a case that ships no reference
 * recording beside a run that produced one.
 */
export function useRecording(url: string | null): LoadedRecording {
  const [state, setState] = useState<LoadedRecording>({
    recording: null,
    error: null,
    loading: url !== null,
  });

  useEffect(() => {
    if (url === null) {
      setState({ recording: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ recording: null, error: null, loading: true });
    fetchRecording(url).then(
      (recording) => {
        if (!cancelled) setState({ recording, error: null, loading: false });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          recording: null,
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
  frame,
  label,
}: {
  recording: Recording;
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
    const report = drawFrame(ctx, recording, shown);
    // `setNote` with the identical string is a no-op in React, so a recording that
    // reproduces cleanly (or reproduces the same gap every frame) does not
    // re-render the tree sixty times a second while it plays.
    setNote(
      report.skipped === 0
        ? null
        : `${report.skipped} ${report.skipped === 1 ? "operation" : "operations"} in this frame could not be reproduced (${report.unreproducible.join(", ")}).`,
    );
  }, [recording, shown]);

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
 * A whole player for one recording: fetch it, draw it, and give the reviewer the
 * transport.
 *
 * This is what a lone replay renders as — a declared proof captured as a
 * recording, a reference shot that is one. The reviewer's side-by-side comparison
 * does not use it, because its two panes have to share one clock; it composes the
 * same parts itself.
 */
export function ReplayPlayer({ url, label }: { url: string; label: string }) {
  const { recording, error, loading } = useRecording(url);
  const timeline = useMemo(() => timelineFor([recording]), [recording]);
  const clock = useReplayClock(timeline);

  if (error !== null) {
    return (
      <p className={styles.error}>This replay cannot be played. {error}</p>
    );
  }
  if (loading || recording === null) {
    return <p className={styles.error}>Loading the replay…</p>;
  }
  if (recording.frames.length === 0) {
    return <p className={styles.error}>This replay recorded no frames.</p>;
  }

  return (
    <div className={styles.player}>
      <ReplayCanvas recording={recording} frame={clock.frame} label={label} />
      <ReplayTransport clock={clock} />
    </div>
  );
}
