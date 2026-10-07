import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  loadSheet,
  Renderer,
  type Atlas,
  type Board,
  type Sheet,
  type Snapshot,
} from "../lattice/renderer";
import type { PerformanceSnapshotCheck } from "@clockwyrks/run-record";
import { firstDrift } from "../lattice/drift";
import { fitZoom, MAX_ZOOM, MIN_ZOOM, stepZoom } from "../lattice/zoom";
import type { PlaybackWorkerResponse } from "../lattice/playbackWorker";
import { formatInteger } from "../../../format";
import {
  fetchAssetBlob,
  fetchAssetBytes,
  fetchAssetJson,
} from "../../../data/producedAssets";
import styles from "./LatticePlaybackSection.module.scss";

// The sprite sheet ships with the bundle as one set, not per run — rendering is the
// same for every run, only the run-specific engine module and scenario are fetched
// per run. Vite resolves these vendored assets to emitted URLs / inlined JSON in
// each host build. The PNG/JSON never download until the visitor launches the player.
import sheetPngUrl from "../lattice/assets/sheet.png?url";
import atlas from "../lattice/assets/sheet.json";

// Simulation ticks advanced per real second at 1x. Deliberately modest: items are
// drawn at INTERPOLATED positions between ticks, so a low tick rate reads as smooth
// motion rather than a blur.
const BASE_TICKS_PER_SECOND = 20;

// A scored scenario runs for tens of thousands of ticks and playback shows its first
// couple of thousand — so the high multipliers are not a novelty, they are how a
// viewer reaches the window's graded checkpoint (or the onset of steady state)
// without waiting minutes.
const SPEEDS = [0.5, 1, 2, 4, 16, 64] as const;

// At or above this multiplier we stop interpolating between two cached frames and
// snap to the nearer one: at 64x the tween is invisible and a whole-frame draw reads
// as a clean fast-forward.
const DRAW_EVERY_TICK_BELOW = 4;

// How long to wait for the engine to load and step its first frames before giving
// up. On a run's playback the module is the submission's arbitrary engine — its
// `playback_load` runs the scored window up front and can trap, spin, or OOM — so a
// module that never posts `ready` is abandoned rather than left hanging the player
// forever. (The reference engine always starts; the timeout simply never fires for
// it.)
const LOAD_TIMEOUT_MS = 8000;

/** Clamp a normalized fraction, so an anchor point outside the board still names a
 * point on it. */
function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * A Lattice factory replayed full-viewport in the browser: one wasm engine
 * (`moduleUrl`) stepped over one scenario (`scenarioUrl`), drawn tick by
 * interpolated tick.
 *
 * The player is deliberately engine-agnostic — the playback ABI is the same whichever
 * module drives it — and both of its callers matter:
 *
 *   • A run's Results tab launches it per scored scenario against the RUN'S OWN
 *     module (the submission's compiled `engine.wasm`), reconstructing exactly the
 *     factory that submission computed, divergences and all. A run records only its
 *     scheduled snapshots, thousands of ticks apart, so there is nothing to replay
 *     directly; re-stepping the run's engine is the only faithful reconstruction, and
 *     there is no reference fallback — a run whose module will not start is simply
 *     not playable, never quietly shown the reference's factory instead. Passing the
 *     run's recorded checksums in as `graded` is what lets the player say when that
 *     reconstruction stops matching the run it claims to show.
 *   • The case's Reference tab launches it against the vendored reference engine
 *     (`lattice-core.wasm`) over the case's own windowed scenarios, to show what the
 *     factories are supposed to look like. That is a property of the case, not of any
 *     run — see `../lattice/reference.ts`.
 *
 * A run's module is arbitrary code, so whatever the caller, it runs in a Web Worker
 * under a load timeout: `playback_load` runs the whole window and could trap or OOM,
 * which on the main thread would take the tab down. The worker streams decoded frames
 * back; this component caches them and does all rendering (canvas, sprite sheet)
 * itself.
 */
export function PlaybackOverlay({
  scenarioUrl,
  moduleUrl,
  label,
  graded,
  onExit,
}: {
  /** Loadable URL of the scenario to step, or null when none can be served. */
  scenarioUrl: string | null;
  /** Loadable URL of the engine module to step it with, or null when none exists. */
  moduleUrl: string | null;
  /** What is being watched, shown in the overlay bar — a scored scenario's path on a
   * run, the factory's name on the case's reference. */
  label: string;
  /**
   * The checksums this engine produced at each graded tick when the run was scored,
   * enabling the drift gate below. Omitted by the case's Reference tab, which plays
   * the authoritative engine against no run at all and so has nothing to drift from.
   */
  graded?: PerformanceSnapshotCheck[];
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The scrolling stage the canvas sits in. Zooming reads its box (to fit a board to
  // it) and writes its scroll offsets (to hold the anchor point still).
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const boardRef = useRef<Board | null>(null);
  // The frames the worker has streamed so far, appended batch by batch. The window
  // is bounded, so it is cached in full and the play loop just reads from it.
  const framesRef = useRef<Snapshot[]>([]);
  // Whether the worker has posted every frame (the window is exhausted). Only then
  // does running off the end of `framesRef` mean the run is over rather than the
  // buffer merely lagging behind playback.
  const completeRef = useRef(false);
  // The continuous frame-index position: `Math.floor(posRef)` is the frame drawn,
  // its fractional part the tween toward the next.
  const posRef = useRef(0);
  // The run's graded checksums, held in a ref so the drift gate always reads the
  // current ones without the loader effect depending on the array's identity —
  // a new array from a parent re-render must not tear down and restart the worker.
  const gradedRef = useRef(graded);
  gradedRef.current = graded;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The first graded tick where the frames disagree with the run's record, if any.
  const [drift, setDrift] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tick, setTick] = useState(0);
  // The board's native pixel size, known once the engine posts its board. The canvas
  // always renders at this resolution and is only *displayed* at `scale`, so zooming
  // restyles one element and never re-draws or re-steps the factory.
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // The stage's content box, tracked so Fit follows a resized window instead of
  // freezing at the size it opened at.
  const [viewport, setViewport] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // The zoom the viewer chose, or null while following the fit-to-stage scale — the
  // default, because the two large factories do not come close to fitting a viewport
  // at a legible zoom. Before this the board was drawn at a fixed 2x and the only way
  // to see the far side of a 72x40 factory was to scroll to it, a screenful at a time,
  // with no way to take the whole thing in.
  const [zoom, setZoom] = useState<number | null>(null);

  const scale = zoom ?? fitZoom(natural, viewport);
  // The wheel handler is bound once (it must be non-passive; see below), so it reads
  // the live scale from a ref rather than closing over a stale one.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Load the sheet and the engine module + scenario, then hand the module to a worker
  // to step. There is NO fallback in either direction: without both a module and a
  // scenario there is nothing faithful to draw, so the player says so rather than
  // substituting another engine's factory.
  useEffect(() => {
    if (!moduleUrl || !scenarioUrl) {
      // Which of the two is missing is the whole content of this failure, and the
      // surrounding chrome already says playback could not happen.
      setError(
        !moduleUrl && !scenarioUrl
          ? "no engine module and no scenario recorded"
          : !moduleUrl
            ? "no engine module recorded"
            : "no scenario recorded",
      );
      return;
    }

    let cancelled = false;
    let worker: Worker | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    setError(null);
    setDrift(null);
    setReady(false);
    framesRef.current = [];
    completeRef.current = false;
    posRef.current = 0;
    setNatural(null);

    (async () => {
      try {
        // All three go through the shared produced-asset caches
        // (`../../../data/producedAssets`), which decode a `data:` URL themselves —
        // WKWebView cannot `fetch()` one and Vite inlines the sprite sheet — and
        // check the status before any body is read, so a run whose engine module was
        // never published reports the miss rather than handing an error page to
        // `WebAssembly.instantiate` for a cryptic "failed to match magic number".
        //
        // A submission's module and a case's scenarios are fixed once produced, so
        // stepping to the next scored scenario of the same run, or relaunching one
        // just watched, re-reads the cache instead of the network — the module is
        // the same file for every scenario of the run.
        const [wasm, sheetBlob, scenarioJson] = await Promise.all([
          fetchAssetBytes(moduleUrl, "engine module"),
          fetchAssetBlob(sheetPngUrl, "sprite sheet"),
          fetchAssetJson<unknown>(scenarioUrl, "scenario"),
        ]);
        if (cancelled) return;
        const sheet: Sheet = await loadSheet(
          sheetBlob,
          atlas as unknown as Atlas,
        );
        if (cancelled) return;

        // The submission's engine — arbitrary code — runs off the main thread so a
        // trap or runaway load cannot freeze the tab; the worker can be terminated.
        worker = new Worker(
          new URL("../lattice/playbackWorker.ts", import.meta.url),
          { type: "module" },
        );
        workerRef.current = worker;

        // Abandon a module that never starts. Once `ready` lands this is cleared;
        // frames arrive fast afterward (the window is cached), so no second timer.
        timeout = setTimeout(() => {
          worker?.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          // The budget is the datum that makes the report actionable, so it is
          // carried rather than left as "in time".
          setError(
            `the engine did not start within ${LOAD_TIMEOUT_MS / 1000}s`,
          );
        }, LOAD_TIMEOUT_MS);

        // The drift gate (see `../lattice/drift.ts` for what it does and does not
        // prove): a frame at a graded tick must carry the checksum the run recorded
        // there, or the factory on screen is not the one the verdict covers. Reported
        // once — the first disagreement is the informative one, and every later frame
        // descends from it.
        let reported = false;
        const checkDrift = (batch: Snapshot[]): void => {
          if (reported) return;
          const drifted = firstDrift(gradedRef.current, batch);
          if (!drifted) return;
          reported = true;
          setDrift(
            `At tick ${formatInteger(drifted.tick)} this playback computed ${
              drifted.played
            }, but the graded run recorded ${
              drifted.recorded
            } — what you are watching is not the state this run was scored on.`,
          );
        };

        worker.onmessage = (event: MessageEvent<PlaybackWorkerResponse>) => {
          const msg = event.data;
          if (msg.type === "ready") {
            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }
            const board = msg.board as Board;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const renderer = new Renderer(canvas.getContext("2d")!, sheet);
            const size = renderer.size(board);
            canvas.width = size.width;
            canvas.height = size.height;
            setNatural(size);
            boardRef.current = board;
            rendererRef.current = renderer;
            setReady(true);
          } else if (msg.type === "frames") {
            for (const frame of msg.batch) framesRef.current.push(frame);
            checkDrift(msg.batch);
          } else if (msg.type === "complete") {
            completeRef.current = true;
          } else if (msg.type === "fail") {
            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }
            setError(msg.message || "the engine failed");
          }
        };

        // A COPY of the module is what gets transferred, never the cached buffer
        // itself. Transferring detaches the buffer on this side, so handing the
        // worker the cached one would empty the cache entry and leave the next
        // launch of this run instantiating zero bytes. The copy is a memcpy of a few
        // megabytes against a download that is orders of magnitude dearer, and the
        // worker still owns its buffer outright.
        const owned = wasm.slice(0);
        worker.postMessage(
          { type: "init", wasm: owned, scenario: scenarioJson },
          [owned],
        );
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [moduleUrl, scenarioUrl]);

  // The animation clock. Position advances continuously; the renderer draws the
  // factory between the two nearest cached frames. Frames stream in fast (the window
  // is cached in the worker), so drawing starts as soon as two exist.
  useEffect(() => {
    if (!ready || !playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      posRef.current += dt * BASE_TICKS_PER_SECOND * speed;

      const renderer = rendererRef.current;
      const board = boardRef.current;
      const frames = framesRef.current;
      if (renderer && board && frames.length > 0) {
        const i = Math.floor(posRef.current);
        const cur = frames[i];
        const nxt = frames[i + 1];
        if (cur && nxt) {
          const alpha = speed >= DRAW_EVERY_TICK_BELOW ? 1 : posRef.current - i;
          renderer.draw(board, cur, nxt, alpha, now / 1000);
          setTick(cur.tick);
        } else {
          // We have outrun the buffer — either the window ended or the next batch
          // has not landed yet. Hold on the last frame we have rather than freezing
          // on a gap.
          const lastFrame = frames[frames.length - 1]!;
          renderer.draw(board, null, lastFrame, 1, now / 1000);
          setTick(lastFrame.tick);
          if (completeRef.current && i + 1 >= frames.length) {
            // The whole window is streamed and we are at its end: playback is done.
            setPlaying(false);
            return;
          }
          // More frames are still coming: park at the last one so playback resumes
          // smoothly the moment the next batch arrives instead of skipping ahead.
          if (i + 1 >= frames.length) posRef.current = frames.length - 1;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, playing, speed]);

  // Lock document scroll for the overlay's lifetime so the fixed overlay never
  // scrolls the page underneath it — which, on a run's Results tab, also leaves the
  // page's own scrollbar standing beside a factory that is fitted to the window and
  // has nothing to scroll. Matches the adversarial replay overlay and the playable
  // embed, the other two full-viewport players.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Track the stage's content box so Fit is a live scale, not a one-off measurement.
  // `contentRect` excludes the stage's padding, which is exactly the space the board
  // has to fit into.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) setViewport({ width: box.width, height: box.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Where the next zoom should keep the picture pinned, captured before the re-render
  // (which is what changes the canvas's size) and applied after it.
  const anchorRef = useRef<{
    fx: number;
    fy: number;
    px: number;
    py: number;
  } | null>(null);

  /**
   * Change the zoom (null to resume following Fit) while keeping whatever the viewer
   * was looking at under the same point on screen: the cursor for a wheel zoom, the
   * middle of the stage for the buttons.
   *
   * Without this, zooming into a factory that overflows the stage lands wherever the
   * scroll offsets happened to be — usually the top-left corner — so magnifying the
   * machine you were watching scrolls it off screen instead.
   */
  const zoomTo = useCallback(
    (next: number | null, at?: { clientX: number; clientY: number }) => {
      const el = viewportRef.current;
      const canvas = canvasRef.current;
      if (el && canvas) {
        const view = el.getBoundingClientRect();
        const board = canvas.getBoundingClientRect();
        const px = (at?.clientX ?? view.left + view.width / 2) - view.left;
        const py = (at?.clientY ?? view.top + view.height / 2) - view.top;
        // As a fraction of the board, which is the one coordinate that survives the
        // resize — the canvas's own pixels are unchanged by zooming.
        if (board.width > 0 && board.height > 0) {
          anchorRef.current = {
            fx: clamp01((px + view.left - board.left) / board.width),
            fy: clamp01((py + view.top - board.top) / board.height),
            px,
            py,
          };
        }
      }
      setZoom(next);
    },
    [],
  );

  // Put the anchor point back under the pointer once the resized canvas has been laid
  // out. `offsetLeft`/`offsetTop` are measured from the stage's padding edge (it is
  // the positioned ancestor) and are unaffected by scrolling, so they compose with the
  // target scroll offset directly.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const el = viewportRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    el.scrollLeft =
      canvas.offsetLeft + anchor.fx * canvas.offsetWidth - anchor.px;
    el.scrollTop =
      canvas.offsetTop + anchor.fy * canvas.offsetHeight - anchor.py;
  });

  // Ctrl/Cmd + wheel — which is also what a trackpad pinch sends — zooms about the
  // cursor, the gesture every map and canvas app answers to. Bound by hand rather than
  // as `onWheel` because React registers wheel listeners passively, where the
  // `preventDefault` that stops the browser zooming the whole console instead is
  // ignored.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo(stepZoom(scaleRef.current, event.deltaY < 0 ? 1 : -1), event);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const restart = useCallback(() => {
    posRef.current = 0;
    setTick(framesRef.current[0]?.tick ?? 0);
    setPlaying(true);
  }, []);

  const total = boardRef.current?.ticks ?? 0;

  return (
    <div className={styles.overlay} role="dialog" aria-label="Factory playback">
      <div className={styles.overlayBar}>
        <button type="button" className={styles.exit} onClick={onExit}>
          Back
        </button>
        {/* Which factory this is. The player covers the viewport, so without it a
            viewer who launched one of several scenarios has nothing on screen
            telling them which one they are watching. */}
        <span className={styles.overlayLabel}>{label}</span>
      </div>
      <div className={styles.stage}>
        {/* The scroller. A board zoomed in past the stage is panned by scrolling this,
            which is why the drift banner is its sibling rather than its child: pinned
            to the stage, it stays on screen wherever the viewer has panned to. */}
        <div
          className={styles.viewport}
          ref={viewportRef}
          // A scroll container is only reachable by keyboard if something in it can
          // take focus, and a canvas cannot — so without this, a zoomed-in factory
          // could be panned by pointer only.
          tabIndex={0}
          role="region"
          aria-label="Factory, scrollable when zoomed in"
        >
          {error ? (
            <div className={styles.error}>
              Could not play this scenario: {error}
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              // Sized in CSS pixels only — the canvas keeps its native resolution and
              // the browser scales the drawn frame, so zooming costs nothing per frame.
              // Floored so a fitted board can never round up past the stage and raise
              // the scrollbars that would shrink the stage and refit it, smaller, on a
              // loop.
              style={
                natural
                  ? {
                      width: `${Math.floor(natural.width * scale)}px`,
                      height: `${Math.floor(natural.height * scale)}px`,
                    }
                  : undefined
              }
              className={
                // Nearest-neighbour is right for pixel art magnified, and wrong for it
                // shrunk: at the sub-1x zooms the large factory needs to fit, dropping
                // pixels drops whole belt lanes, where filtering keeps them as a tint.
                scale >= 1
                  ? `${styles.canvas} ${styles.canvasPixelated}`
                  : styles.canvas
              }
            />
          )}
        </div>
        {/* Drift is a warning, not a failure: the factory keeps playing (seeing the
            divergence is the point), with a standing banner saying it is not the
            graded state. */}
        {drift ? (
          <div className={styles.drift} role="status">
            Playback drift — {drift}
          </div>
        ) : null}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.control}
          onClick={() => setPlaying((on) => !on)}
          disabled={!ready}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className={styles.control}
          onClick={restart}
          disabled={!ready}
        >
          Restart
        </button>
        <span className={styles.tick}>
          tick {formatInteger(tick)} / {formatInteger(total)}
        </span>
        {/* Zoom. Fit is the default and the way back to it: a viewer who has zoomed
            into a corner of the large factory needs one click to see the whole board
            again, not a hunt back down the ladder. */}
        <span className={styles.zoom}>
          <button
            type="button"
            className={styles.control}
            onClick={() => zoomTo(stepZoom(scale, -1))}
            disabled={!ready || scale <= MIN_ZOOM}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <span className={styles.zoomLevel}>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className={styles.control}
            onClick={() => zoomTo(stepZoom(scale, 1))}
            disabled={!ready || scale >= MAX_ZOOM}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className={zoom === null ? styles.speedOn : styles.control}
            onClick={() => zoomTo(null)}
            disabled={!ready}
            aria-pressed={zoom === null}
            title="Scale the whole factory to the window"
          >
            Fit
          </button>
        </span>
        <span className={styles.speeds}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={s === speed ? styles.speedOn : styles.speed}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
