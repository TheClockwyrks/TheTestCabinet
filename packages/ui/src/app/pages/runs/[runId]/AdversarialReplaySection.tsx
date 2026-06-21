import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  useGalleryData,
  type ReplayResultView,
} from "../../../data/galleryContext";
import {
  Engine,
  loadSheet,
  Renderer,
  type Atlas,
  type Palette,
  type Snapshot,
} from "../foray/renderer";
import detailStyles from "./RunDetailPages.module.scss";
import styles from "./AdversarialReplaySection.module.scss";

// The replay engine (foray-core) and its sprite sheet ship with the bundle as
// one set, not per run — only the run-specific `replay.json` is fetched per run.
// Vite resolves these vendored assets to emitted URLs / inlined JSON in each host
// build (`?url` for the binaries; the atlas + palette are small enough to import
// directly). The wasm/PNG never download until the visitor launches the player.
import forayCoreWasmUrl from "../foray/assets/foray-core.wasm?url";
import sheetPngUrl from "../foray/assets/sheet.png?url";
import atlas from "../foray/assets/sheet.json";
import palette from "../foray/assets/palette.json";

// Baseline playback rate at 1× speed, matching the bundle's own player.
const BASE_TICKS_PER_SECOND = 30;
const SPEEDS = [0.5, 1, 2, 4, 8] as const;

/**
 * The adversarial result, shown at the top of the Verdict tab for an adversarial
 * run: the canonical match's record (outcome, winner, scores, how/when it ended)
 * and a gated, embeddable replay player that reconstructs the match in-browser
 * with the same foray-core wasm engine the CLI scored it with.
 *
 * Renders nothing for a non-adversarial run (its `validation.adversarial` is
 * absent), so it is safe to mount unconditionally.
 */
export function AdversarialReplaySection({ run }: { run: RunRecord }) {
  const gallery = useGalleryData();
  const replay = gallery.replayResultFor(run);
  if (!replay) return null;
  return <ReplaySection run={run} replay={replay} />;
}

function ReplaySection({
  run,
  replay,
}: {
  run: RunRecord;
  replay: ReplayResultView;
}) {
  const [launched, setLaunched] = useState(false);

  const outcomeClass =
    replay.outcome === "win"
      ? styles.win
      : replay.outcome === "draw"
        ? styles.draw
        : styles.loss;

  const winnerLabel = replay.winner
    ? replay.winner === "red"
      ? "Red (submission)"
      : "Blue (opponent)"
    : "Draw";

  return (
    <Panel>
      <h2 className={detailStyles.section}>Canonical match</h2>

      {/* The recorded match record: how the single scored match resolved. */}
      <dl className={styles.record}>
        <dt className={styles.recordTerm}>Outcome</dt>
        <dd className={outcomeClass}>{replay.outcome}</dd>

        <dt className={styles.recordTerm}>Opponent</dt>
        <dd>{replay.opponent} (Blue)</dd>

        <dt className={styles.recordTerm}>Winner</dt>
        <dd>{winnerLabel}</dd>

        <dt className={styles.recordTerm}>Score</dt>
        <dd>
          <span className={styles.scoreRed}>Red {replay.redScore}</span>
          {" — "}
          <span className={styles.scoreBlue}>Blue {replay.blueScore}</span>
        </dd>

        <dt className={styles.recordTerm}>Ended</dt>
        <dd>
          {replay.ended} · {replay.ticks} ticks
        </dd>
      </dl>

      {replay.detail ? (
        <p className={styles.detail}>{replay.detail}</p>
      ) : null}

      {replay.replayUrl === null ? (
        <p className={styles.detail}>
          The replay for this run is not available to play here.
        </p>
      ) : !launched ? (
        // Gate the launch behind a short caveat. The replay reconstructs the
        // model's controller exactly as it played; the engine is only loaded on
        // click so the wasm never downloads for a visitor who doesn't watch.
        <div className={styles.gate}>
          <p className={styles.notice}>
            This replays the match the model&rsquo;s controller actually played,
            reconstructed in your browser by the same engine that scored it.
          </p>
          <button
            type="button"
            className={styles.launch}
            onClick={() => setLaunched(true)}
          >
            Launch replay
          </button>
        </div>
      ) : (
        <ReplayOverlay
          run={run}
          replayUrl={replay.replayUrl}
          onExit={() => setLaunched(false)}
        />
      )}
    </Panel>
  );
}

// The near-fullscreen replay player. It mirrors PlayableSection's overlay (a slim
// Back bar, document-scroll lock for its lifetime, Esc to exit) but embeds a
// <canvas> driven by the vendored foray-core wasm engine rather than a
// cross-origin iframe — so, unlike the iframe case, the parent keeps the
// keyboard and the lock is purely to keep the fixed overlay from scrolling.
function ReplayOverlay({
  run,
  replayUrl,
  onExit,
}: {
  run: RunRecord;
  replayUrl: string;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // All reconstructed frames, buffered up front. The canonical match is bounded,
  // so buffering makes scrubbing instant and lets the result show immediately.
  const framesRef = useRef<Snapshot[]>([]);
  const rendererRef = useRef<Renderer | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Lock document scroll for the overlay's lifetime so the fixed overlay never
  // scrolls the page underneath it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Esc exits the overlay, matching the visible Back control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onExit]);

  // Load the replay, instantiate foray-core, reconstruct every frame, and wire
  // the renderer to the canvas. Runs once on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [replay, wasm, sheetBlob] = await Promise.all([
          fetch(replayUrl).then((r) => r.json()),
          fetch(forayCoreWasmUrl).then((r) => r.arrayBuffer()),
          fetch(sheetPngUrl).then((r) => r.blob()),
        ]);

        const engine = await Engine.instantiate(wasm);
        if (!engine.load(replay)) {
          throw new Error("foray-core rejected the replay");
        }
        const board = engine.board();
        const sheet = await loadSheet(sheetBlob, atlas as Atlas, palette as Palette);

        const frames: Snapshot[] = [];
        let snap: Snapshot | null;
        while ((snap = engine.step()) !== null) frames.push(snap);

        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        framesRef.current = frames;
        rendererRef.current = new Renderer(canvas, sheet, board, 2);
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [replayUrl]);

  // Draw the frame at `cursor` whenever it (or readiness) changes. Facings are
  // derived from frame-to-frame motion, so clear them before each draw — a scrub
  // must not carry a stale direction across a discontinuity.
  useEffect(() => {
    if (!ready) return;
    const frame = framesRef.current[cursor];
    const renderer = rendererRef.current;
    if (!frame || !renderer) return;
    renderer.resetFacing();
    renderer.draw(frame);
  }, [ready, cursor]);

  // The playback loop: advance the cursor at the chosen rate, pausing at the end.
  useEffect(() => {
    if (!playing || !ready) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const total = framesRef.current.length;
    const loop = (now: number) => {
      acc += ((now - last) / 1000) * BASE_TICKS_PER_SECOND * speed;
      last = now;
      let next = cursor;
      while (acc >= 1) {
        acc -= 1;
        next += 1;
        if (next >= total - 1) {
          setCursor(total - 1);
          setPlaying(false);
          return;
        }
      }
      if (next !== cursor) setCursor(next);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready, speed, cursor]);

  const togglePlay = useCallback(() => {
    setPlaying((on) => {
      // Restart from the top if play is pressed at the end of the match.
      if (!on && cursor >= framesRef.current.length - 1) setCursor(0);
      return !on;
    });
  }, [cursor]);

  const restart = useCallback(() => {
    setPlaying(false);
    setCursor(0);
  }, []);

  const frames = framesRef.current;
  const current = ready ? frames[cursor] : undefined;
  const lastTick = frames.length > 0 ? frames[frames.length - 1]!.tick : 0;
  const result = current?.result;
  const resultClass = result
    ? result.winner
      ? result.winner === "red"
        ? styles.scoreRed
        : styles.scoreBlue
      : styles.draw
    : undefined;

  return (
    <div className={styles.overlay} role="dialog" aria-label="Match replay">
      <div className={styles.overlayBar}>
        <button type="button" className={styles.overlayExit} onClick={onExit}>
          Back
        </button>
      </div>
      <div className={styles.overlayStage}>
        {error ? (
          <div className={styles.error}>Could not play the replay: {error}</div>
        ) : (
          <>
            <div className={styles.scoreboard}>
              <span className={styles.scoreRed}>
                RED {current ? current.score.red : 0}
              </span>
              <span className={styles.tickLabel}>
                tick {current ? current.tick : 0} / {lastTick}
              </span>
              <span className={styles.scoreBlue}>
                BLUE {current ? current.score.blue : 0}
              </span>
            </div>

            <canvas
              ref={canvasRef}
              className={styles.canvas}
              aria-label={`Match replay for ${run.id}`}
            />

            <div className={styles.controls}>
              <button
                type="button"
                className={styles.control}
                onClick={togglePlay}
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
              <label className={styles.controlLabel} htmlFor="replay-scrub">
                tick
              </label>
              <input
                id="replay-scrub"
                className={styles.scrub}
                type="range"
                min={0}
                max={Math.max(0, frames.length - 1)}
                value={cursor}
                step={1}
                disabled={!ready}
                onChange={(e) => {
                  setPlaying(false);
                  setCursor(Number(e.target.value));
                }}
              />
              <label className={styles.controlLabel} htmlFor="replay-speed">
                speed
              </label>
              <select
                id="replay-speed"
                className={styles.speed}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>

            {result ? (
              <div className={`${styles.result} ${resultClass ?? ""}`}>
                {(result.winner ? result.winner.toUpperCase() : "DRAW") +
                  ` · ${result.ended} · red ${result.score.red} – blue ${result.score.blue} · ${result.ticks} ticks`}
              </div>
            ) : (
              <div className={styles.result} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
