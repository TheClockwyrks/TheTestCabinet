import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  useGalleryData,
  type ReplayMatchView,
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

// Simulation ticks advanced per real second at 1× speed, matching the bundle's
// own player (`replay/index.html`). Deliberately slow: agents are drawn at
// INTERPOLATED positions between ticks, so a modest tick rate reads as smooth
// motion that is easy to follow, not a blur.
const BASE_TICKS_PER_SECOND = 8;
const SPEEDS = [0.5, 1, 2, 4, 8] as const;

// Load a bundled `?url` asset's bytes, tolerating both emitted file URLs and
// inlined `data:` URLs. Vite inlines any asset under its `assetsInlineLimit`
// (4 KB by default) as a base64 `data:` URL — the sprite sheet (~2 KB) is one,
// while the larger wasm (~230 KB) is emitted as a file. WebKit's WKWebView (the
// macOS Tauri webview) cannot `fetch()` a `data:` URL: it rejects with
// `TypeError: Load failed`, which is what surfaces as "Could not play the replay:
// Load failed" in the desktop app. Decoding data URLs ourselves keeps the
// inlining (a win for the browser hosts) while letting the player work in the
// desktop shell too.
function decodeDataUrl(url: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } {
  const comma = url.indexOf(",");
  const meta = url.slice("data:".length, comma);
  const isBase64 = /;base64$/i.test(meta);
  const mime = meta.replace(/;base64$/i, "") || "application/octet-stream";
  const data = url.slice(comma + 1);
  const source = isBase64
    ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(data));
  // Copy into a fresh, plain-`ArrayBuffer`-backed view: `TextEncoder`/`atob`
  // results are typed as `ArrayBufferLike`, but the wasm/Blob consumers want a
  // concrete `ArrayBuffer`.
  const bytes = new Uint8Array(source);
  return { mime, bytes };
}

async function fetchAssetBytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith("data:")) {
    return decodeDataUrl(url).bytes.buffer;
  }
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
 * The adversarial result, shown on the Proof tab for an adversarial run: the run's
 * **proof matches** — one per reference opponent the submission was auto-replayed
 * against (the three baselines plus the hidden `fuel-probe`). Every match is listed
 * with its record (outcome, winner, scores, how/when it ended) and its own Launch
 * control that opens an embeddable replay player reconstructing that match
 * in-browser with the same foray-core wasm engine the CLI scored it with. These
 * replays are the run's evidence of play — they replace proof-of-implementation for
 * adversarial cases.
 *
 * Renders nothing for a non-adversarial run (its `validation.adversarial` is
 * absent), so it is safe to mount unconditionally.
 */
export function AdversarialReplaySection({ run }: { run: RunRecord }) {
  const gallery = useGalleryData();
  const replay = gallery.replayResultFor(run);
  if (!replay || replay.replays.length === 0) return null;
  return <ReplaySection run={run} replay={replay} />;
}

function ReplaySection({
  run,
  replay,
}: {
  run: RunRecord;
  replay: ReplayResultView;
}) {
  const matches = replay.replays;
  // The opponent of the match currently being watched, or null when none is. Only
  // one player is open at a time (it covers the viewport), but every match has its
  // own Launch control, so the section lists them all rather than gating behind a
  // selector.
  const [launched, setLaunched] = useState<string | null>(null);
  const active = matches.find((m) => m.opponent === launched) ?? null;

  return (
    <Panel>
      <h2 className={styles.heading}>Proof matches</h2>

      <p className={styles.notice}>
        The submission was auto-replayed against each reference opponent. Launch
        any match below to watch the model&rsquo;s controller actually play it.
      </p>

      <ul className={styles.matchList}>
        {matches.map((match) => (
          <li key={match.opponent} className={styles.matchItem}>
            <MatchRecord match={match} />

            {match.detail ? (
              <p className={styles.detail}>{match.detail}</p>
            ) : null}

            {match.replayUrl === null ? (
              <p className={styles.detail}>
                The replay for this match is not available to play here.
              </p>
            ) : (
              // The replay reconstructs the model's controller exactly as it
              // played; the engine is only loaded on click so the wasm never
              // downloads for a visitor who doesn't watch.
              <button
                type="button"
                className={styles.launch}
                onClick={() => setLaunched(match.opponent)}
              >
                Launch replay vs {match.opponent}
              </button>
            )}
          </li>
        ))}
      </ul>

      {active && active.replayUrl !== null ? (
        <ReplayOverlay
          // Key on the opponent so launching a different match tears down and
          // rebuilds the player for the newly chosen replay.
          key={active.opponent}
          label={`Match replay for ${run.id} vs ${active.opponent}`}
          replayUrl={active.replayUrl}
          onExit={() => setLaunched(null)}
        />
      ) : null}
    </Panel>
  );
}

/** The recorded result of one proof match, from the submission's perspective. */
function MatchRecord({ match }: { match: ReplayMatchView }) {
  const outcomeClass =
    match.outcome === "win"
      ? styles.win
      : match.outcome === "draw"
        ? styles.draw
        : styles.loss;

  const winnerLabel = match.winner
    ? match.winner === "red"
      ? "Red (submission)"
      : "Blue (opponent)"
    : "Draw";

  return (
    <dl className={styles.record}>
      <dt className={styles.recordTerm}>Outcome</dt>
      <dd className={outcomeClass}>
        {match.outcome}
        {match.scored ? "" : " · exhibition (unscored)"}
      </dd>

      <dt className={styles.recordTerm}>Opponent</dt>
      <dd>{match.opponent} (Blue)</dd>

      <dt className={styles.recordTerm}>Winner</dt>
      <dd>{winnerLabel}</dd>

      <dt className={styles.recordTerm}>Score</dt>
      <dd>
        <span className={styles.scoreRed}>Red {match.redScore}</span>
        {" — "}
        <span className={styles.scoreBlue}>Blue {match.blueScore}</span>
      </dd>

      <dt className={styles.recordTerm}>Ended</dt>
      <dd>
        {match.ended} · {match.ticks} ticks
      </dd>
    </dl>
  );
}

// The near-fullscreen replay player. It mirrors PlayableSection's overlay (a slim
// Back bar, document-scroll lock for its lifetime, Esc to exit) but embeds a
// <canvas> driven by the vendored foray-core wasm engine rather than a
// cross-origin iframe — so, unlike the iframe case, the parent keeps the
// keyboard and the lock is purely to keep the fixed overlay from scrolling.
//
// It plays either a replay fetched from `replayUrl` (a run-detail canonical match
// or a persisted tournament match) or an inline `replayData` object handed in
// directly (the arena's transient quick match, whose replay is never stored).
// Exported so the arena pages reuse the exact same player. Exactly one of
// `replayUrl`/`replayData` is supplied.
export function ReplayOverlay({
  label,
  replayUrl,
  replayData,
  onExit,
}: {
  /** Accessible label for the canvas (e.g. "Match replay for <id>"). */
  label: string;
  /** URL to fetch the replay JSON from, when it is stored. */
  replayUrl?: string;
  /** The replay object to play directly, when it is not stored (a quick match). */
  replayData?: unknown;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // All reconstructed frames, buffered up front. The canonical match is bounded,
  // so buffering makes scrubbing instant and lets the result show immediately.
  const framesRef = useRef<Snapshot[]>([]);
  const rendererRef = useRef<Renderer | null>(null);
  // Playback position as a CONTINUOUS tick coordinate: the integer part is the
  // current tick, the fraction is progress toward the next — what the renderer
  // interpolates over. The canvas is painted imperatively from this each animation
  // frame; `cursor` (below) only mirrors its integer part to drive the React chrome
  // (scoreboard, scrub) without re-rendering the tree 60× a second.
  const tRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // A live mirror of `cursor` for the rAF loop, so the loop can compare the
  // current integer tick without resubscribing every time the tick advances.
  const cursorRef = useRef(0);
  cursorRef.current = cursor;

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
        // The replay is either fetched from its URL or supplied inline; the wasm
        // engine and sprite sheet always come from the bundle (via WKWebView-safe
        // loaders — see `fetchAssetBytes`/`fetchAssetBlob`). A failed replay fetch
        // is reported as such: without the status check a 404's JSON error body
        // parses cleanly and is then handed to the engine, which rejects it —
        // surfacing the misleading "foray-core rejected the replay" for what is
        // really a missing/unservable replay.
        const [replay, wasm, sheetBlob] = await Promise.all([
          replayUrl !== undefined
            ? fetch(replayUrl).then((r) => {
                if (!r.ok) {
                  throw new Error(
                    `could not fetch the replay (HTTP ${r.status})`,
                  );
                }
                return r.json();
              })
            : Promise.resolve(replayData),
          fetchAssetBytes(forayCoreWasmUrl),
          fetchAssetBlob(sheetPngUrl),
        ]);

        const engine = await Engine.instantiate(wasm);
        if (!engine.load(replay)) {
          // The engine rejects a replay it cannot reproduce: re-running the
          // recorded ticks disagreed with the committed result. Showing nothing is
          // deliberate — the alternative is rendering a match that never happened,
          // with a running score that contradicts the recorded one beside it.
          throw new Error(
            "this replay could not be reproduced by the playback engine, so it cannot be shown; the recorded result above still stands",
          );
        }
        const board = engine.board();
        const sheet = await loadSheet(
          sheetBlob,
          atlas as Atlas,
          palette as Palette,
        );

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
  }, [replayUrl, replayData]);

  // Paint the canvas at a continuous tick position `t`: split into the current
  // tick `i` and the fraction toward the next, and let the renderer interpolate
  // the agents between snapshot `i` and `i+1`. Pure canvas work — no React state —
  // so it is safe to call every animation frame.
  const paint = useCallback((t: number) => {
    const frames = framesRef.current;
    const renderer = rendererRef.current;
    if (!renderer || frames.length === 0) return;
    const lastTick = frames.length - 1;
    const clamped = Math.max(0, Math.min(lastTick, t));
    const i = Math.floor(clamped);
    const frac = i < lastTick ? clamped - i : 0;
    renderer.draw(frames[i]!, frames[Math.min(i + 1, lastTick)], frac);
  }, []);

  // Paint a still frame whenever playback is paused (initial ready, a scrub, a
  // restart, or the end of a run). The rAF loop owns painting while playing, so
  // this stays out of its way. Facings are derived from frame-to-frame motion, so
  // clear them first — a scrub must not carry a stale direction across a jump.
  useEffect(() => {
    if (!ready || playing) return;
    tRef.current = cursor;
    rendererRef.current?.resetFacing();
    paint(cursor);
  }, [ready, playing, cursor, paint]);

  // The playback loop: advance the continuous position at the chosen rate,
  // painting the interpolated canvas every animation frame and mirroring the
  // integer tick into `cursor` only when it changes (to refresh the chrome),
  // pausing at the end.
  useEffect(() => {
    if (!playing || !ready) return;
    let raf = 0;
    let last = performance.now();
    const lastTick = framesRef.current.length - 1;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const t = tRef.current + dt * BASE_TICKS_PER_SECOND * speed;
      if (t >= lastTick) {
        tRef.current = lastTick;
        paint(lastTick);
        setCursor(lastTick);
        setPlaying(false);
        return;
      }
      tRef.current = t;
      paint(t);
      const tick = Math.floor(t);
      if (tick !== cursorRef.current) setCursor(tick);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready, speed, paint]);

  const togglePlay = useCallback(() => {
    setPlaying((on) => {
      // Restart from the top if play is pressed at the end of the match. Reset
      // the continuous position too, or the loop would resume past the end and
      // stop immediately.
      if (!on && cursor >= framesRef.current.length - 1) {
        tRef.current = 0;
        rendererRef.current?.resetFacing();
        setCursor(0);
      }
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
              aria-label={label}
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
