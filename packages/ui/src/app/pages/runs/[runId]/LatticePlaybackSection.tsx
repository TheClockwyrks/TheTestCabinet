import { useCallback, useEffect, useRef, useState } from "react";
import type { PerformanceScenarioView } from "../../../data/galleryContext";
import {
  loadSheet,
  Renderer,
  type Atlas,
  type Board,
  type Sheet,
  type Snapshot,
} from "../lattice/renderer";
import type { PlaybackWorkerResponse } from "../lattice/playbackWorker";
import { formatInteger } from "../../../format";
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

// A scored scenario runs for tens of thousands of ticks, and its first scheduled
// snapshot is thousands in — so the high multipliers are not a novelty, they are how
// a viewer reaches a checkpoint (or steady state) without waiting minutes.
const SPEEDS = [0.5, 1, 2, 4, 16, 64] as const;

// At or above this multiplier we stop interpolating between two cached frames and
// snap to the nearer one: at 64x the tween is invisible and a whole-frame draw reads
// as a clean fast-forward.
const DRAW_EVERY_TICK_BELOW = 4;

// How long to wait for the run's own engine to load and step its first frames before
// giving up. The module is the submission's arbitrary engine — its `playback_load`
// runs the scored window up front and can trap, spin, or OOM — so a run that never
// posts `ready` is abandoned rather than left hanging the player forever.
const LOAD_TIMEOUT_MS = 8000;

// Load a bundled `?url` asset's bytes, tolerating both emitted file URLs and inlined
// `data:` URLs. WebKit's WKWebView (the macOS Tauri webview) cannot `fetch()` a
// `data:` URL, so decoding them ourselves keeps Vite's inlining while letting the
// player work in the desktop shell. Mirrors the adversarial player.
function decodeDataUrl(url: string): {
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
} {
  const comma = url.indexOf(",");
  const meta = url.slice("data:".length, comma);
  const isBase64 = /;base64$/i.test(meta);
  const mime = meta.replace(/;base64$/i, "") || "application/octet-stream";
  const data = url.slice(comma + 1);
  const source = isBase64
    ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(data));
  return { mime, bytes: new Uint8Array(source) };
}

async function fetchAssetBytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith("data:")) return decodeDataUrl(url).bytes.buffer;
  return fetch(url).then((r) => r.arrayBuffer());
}

async function fetchAssetBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    const { mime, bytes } = decodeDataUrl(url);
    return new Blob([bytes], { type: mime });
  }
  return fetch(url).then((r) => r.blob());
}

/**
 * A performance run's factory for one scored scenario, replayed full-viewport in the
 * browser. Launched per scenario from that scenario's row on the run's Results tab.
 *
 * Playback steps the RUN'S OWN engine module (`moduleUrl` — the submission's compiled
 * `engine.wasm`) over the scored scenario, reconstructing exactly the factory the
 * submission computed — divergences and all — rather than re-simulating with the
 * reference engine. A run records only its scheduled snapshots, thousands of ticks
 * apart, so there is nothing to replay directly; re-stepping the run's engine is the
 * only faithful reconstruction, and there is no reference fallback.
 *
 * The module is arbitrary code, so it runs in a Web Worker under a load timeout: its
 * `playback_load` runs the whole window and could trap or OOM, which on the main
 * thread would take the tab down. The worker streams decoded frames back; this
 * component caches them and does all rendering (canvas, sprite sheet) itself.
 */
export function PlaybackOverlay({
  scenario,
  moduleUrl,
  onExit,
}: {
  scenario: PerformanceScenarioView;
  moduleUrl: string | null;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tick, setTick] = useState(0);

  // Load the sheet and this run's engine module + scenario, then hand the module to a
  // worker to step. There is NO reference fallback: without a module (or a scenario)
  // the run is simply not playable.
  useEffect(() => {
    const scenarioUrl = scenario.scenarioUrl;
    if (!moduleUrl || !scenarioUrl) {
      setError("Playback is unavailable for this run.");
      return;
    }

    let cancelled = false;
    let worker: Worker | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    setError(null);
    setReady(false);
    framesRef.current = [];
    completeRef.current = false;
    posRef.current = 0;

    (async () => {
      try {
        const [wasm, sheetBlob, scenarioJson] = await Promise.all([
          fetchAssetBytes(moduleUrl),
          fetchAssetBlob(sheetPngUrl),
          fetch(scenarioUrl).then((r) => {
            if (!r.ok) throw new Error(`scenario ${r.status}`);
            return r.json();
          }),
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
          setError("The engine did not start in time.");
        }, LOAD_TIMEOUT_MS);

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
            boardRef.current = board;
            rendererRef.current = renderer;
            setReady(true);
          } else if (msg.type === "frames") {
            for (const frame of msg.batch) framesRef.current.push(frame);
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

        // Transfer the wasm buffer — the main thread has no further use for it.
        worker.postMessage(
          { type: "init", wasm, scenario: scenarioJson },
          [wasm],
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
  }, [moduleUrl, scenario.scenarioUrl]);

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
      </div>
      <div className={styles.stage}>
        {error ? (
          <div className={styles.error}>
            Could not play this scenario: {error}
          </div>
        ) : (
          <canvas ref={canvasRef} className={styles.canvas} />
        )}
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
