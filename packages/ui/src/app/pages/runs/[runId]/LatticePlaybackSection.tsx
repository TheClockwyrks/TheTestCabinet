import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  useGalleryData,
  type PerformanceScenarioView,
} from "../../../data/galleryContext";
import {
  Engine,
  loadSheet,
  Renderer,
  type Atlas,
  type Board,
  type Sheet,
  type Snapshot,
} from "../lattice/renderer";
import { formatInteger } from "../../../format";
import styles from "./LatticePlaybackSection.module.scss";

// The playback engine (lattice-core) and its sprite sheet ship with the bundle as
// one set, not per run — only the run-specific scenario is fetched per run. Vite
// resolves these vendored assets to emitted URLs / inlined JSON in each host build.
// The wasm/PNG never download until the visitor launches the player.
import latticeCoreWasmUrl from "../lattice/assets/lattice-core.wasm?url";
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

// Above this many ticks in a single frame we stop decoding what the engine returns
// and just advance it. The guest still serializes each tick internally, but skipping
// the JS-side decode/parse is what makes fast-forward affordable; a tick that is
// neither drawn nor a scheduled snapshot has nothing anyone reads.
const DRAW_EVERY_TICK_BELOW = 4;


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
 * A performance run's factory, replayed in the browser — shown on the Proof tab for
 * a run whose engine was correct.
 *
 * Playback re-simulates the scored scenario with the same `lattice-core` engine that
 * graded the run, rather than replaying recorded frames: a run records only its
 * scheduled snapshots, thousands of ticks apart, so there is nothing to interpolate
 * between. Because a submission is correct only when it reproduced those snapshots
 * bit for bit, re-stepping the engine reconstructs exactly the factory the run
 * computed.
 *
 * Renders nothing for a non-performance run, or one whose engine got no case right
 * (which records no scenario), so it is safe to mount unconditionally.
 */
export function LatticePlaybackSection({ run }: { run: RunRecord }) {
  const gallery = useGalleryData();
  const playback = gallery.performancePlaybackFor(run);
  const playable = playback?.scenarios.filter((s) => s.scenarioUrl) ?? [];
  if (!playback || playable.length === 0) return null;
  return <PlaybackSection scenarios={playable} />;
}

function PlaybackSection({
  scenarios,
}: {
  scenarios: PerformanceScenarioView[];
}) {
  // One player at a time (it covers the viewport), but every scored scenario gets
  // its own Launch control so the list shows what is available.
  const [launched, setLaunched] = useState<number | null>(null);
  const active = scenarios.find((s) => s.caseIndex === launched) ?? null;

  return (
    <Panel>
      <h2 className={styles.heading}>Factory playback</h2>
      <p className={styles.notice}>
        Each scored scenario the engine got right can be replayed here, simulated
        by the same engine that graded the run — so what you watch is the factory
        the run was graded on.
      </p>

      <ul className={styles.list}>
        {scenarios.map((scenario) => (
          <li key={scenario.caseIndex} className={styles.row}>
            <span className={styles.name}>{scenario.input}</span>
            <span className={styles.fuel}>
              {scenario.fuel === null ? "—" : `${formatInteger(scenario.fuel)} fuel`}
            </span>
            <button
              type="button"
              className={styles.launch}
              onClick={() => setLaunched(scenario.caseIndex)}
            >
              Launch
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <PlaybackOverlay
          scenario={active}
          onExit={() => setLaunched(null)}
        />
      ) : null}
    </Panel>
  );
}

function PlaybackOverlay({
  scenario,
  onExit,
}: {
  scenario: PerformanceScenarioView;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const boardRef = useRef<Board | null>(null);
  // The two ticks being interpolated between, and the continuous position.
  const prevRef = useRef<Snapshot | null>(null);
  const nextRef = useRef<Snapshot | null>(null);
  const posRef = useRef(0);
  // The tick `nextRef` is at. Tracked separately because a skipped tick is never
  // decoded, so its number cannot be read back off a snapshot.
  const tickRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tick, setTick] = useState(0);

  // Load the engine, the sheet, and this run's scenario, then position at tick 0.
  useEffect(() => {
    let cancelled = false;
    const url = scenario.scenarioUrl;
    if (!url) return;
    (async () => {
      try {
        const [wasm, sheetBlob, scenarioJson] = await Promise.all([
          fetchAssetBytes(latticeCoreWasmUrl),
          fetchAssetBlob(sheetPngUrl),
          fetch(url).then((r) => {
            if (!r.ok) throw new Error(`scenario ${r.status}`);
            return r.json();
          }),
        ]);
        if (cancelled) return;

        const engine = await Engine.instantiate(wasm);
        if (!engine.load(scenarioJson)) {
          throw new Error("the engine rejected this scenario");
        }
        const sheet: Sheet = await loadSheet(sheetBlob, atlas as unknown as Atlas);
        const board = engine.board();
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const size = new Renderer(
          canvas.getContext("2d")!,
          sheet,
        ).size(board);
        canvas.width = size.width;
        canvas.height = size.height;

        engineRef.current = engine;
        rendererRef.current = new Renderer(canvas.getContext("2d")!, sheet);
        boardRef.current = board;
        prevRef.current = null;
        nextRef.current = engine.step();
        tickRef.current = nextRef.current?.tick ?? 0;
        posRef.current = 0;
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scenario.scenarioUrl]);

  // Advance the engine by `count` ticks, decoding only the tick about to be drawn.
  // Everything in between is stepped blind — at 64x that is the difference between
  // a smooth fast-forward and a thousand JSON parses a second. Returns false once
  // the scenario is exhausted.
  const advance = useCallback((count: number): boolean => {
    const engine = engineRef.current;
    if (!engine) return false;
    let skipped = false;
    for (let i = 0; i < count; i++) {
      if (i < count - 1) {
        if (!engine.stepSkip()) return false;
        tickRef.current += 1;
        skipped = true;
        continue;
      }
      const snapshot = engine.step();
      if (!snapshot) return false;
      // A skipped run leaves no honest previous tick to interpolate from — the
      // last decoded state is many ticks behind — so drop it and draw this tick
      // as-is rather than tweening across a gap.
      prevRef.current = skipped ? null : nextRef.current;
      nextRef.current = snapshot;
      tickRef.current = snapshot.tick;
    }
    return true;
  }, []);

  // The animation clock. Ticks advance continuously; the renderer draws the factory
  // between the two nearest reconstructed ticks.
  useEffect(() => {
    if (!ready || !playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      posRef.current += dt * BASE_TICKS_PER_SECOND * speed;
      const whole = Math.floor(posRef.current);
      if (whole >= 1) {
        posRef.current -= whole;
        if (!advance(whole)) {
          setPlaying(false);
          return;
        }
      }
      const renderer = rendererRef.current;
      const board = boardRef.current;
      const next = nextRef.current;
      if (renderer && board && next) {
        const alpha = speed >= DRAW_EVERY_TICK_BELOW ? 1 : posRef.current;
        renderer.draw(board, prevRef.current, next, alpha, now / 1000);
        setTick(next.tick);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, playing, speed, advance]);


  const restart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.reset();
    prevRef.current = null;
    nextRef.current = engine.step();
    tickRef.current = nextRef.current?.tick ?? 0;
    posRef.current = 0;
    setTick(tickRef.current);
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
          <div className={styles.error}>Could not play this scenario: {error}</div>
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

