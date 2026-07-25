// The top toolbar: board size, playback controls, live status, and export.
//
// Export projects the design to a `scenario.json` and hands it over — download or
// clipboard. The run length + snapshot schedule it writes are placeholders (this
// tool designs the LAYOUT; the scored ticks are set when the real case is wired), so
// the export ticks are a single editable number defaulting high enough to be a
// sensible steady-state length.

import { useState } from "react";
import { exportJson, GRID_PRESETS, type Design } from "../model";
import type { SimStatus } from "../sim";

const SPEEDS = [0.5, 1, 2, 4] as const;
const MIN_DIM = 4;
const MAX_DIM = 120;
const DEFAULT_EXPORT_TICKS = 100_000;

interface ToolbarProps {
  design: Design;
  status: SimStatus | null;
  playing: boolean;
  speed: number;
  onResize: (width: number, height: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  onClear: () => void;
}

export function Toolbar({
  design,
  status,
  playing,
  speed,
  onResize,
  onTogglePlay,
  onSpeed,
  onClear,
}: ToolbarProps) {
  const [ticks, setTicks] = useState(DEFAULT_EXPORT_TICKS);
  const [copied, setCopied] = useState(false);

  const download = () => {
    const blob = new Blob([exportJson(design, ticks)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scenario.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = () => {
    void navigator.clipboard.writeText(exportJson(design, ticks)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  const clampDim = (v: number) =>
    Math.max(MIN_DIM, Math.min(MAX_DIM, Math.floor(v) || MIN_DIM));

  return (
    <header className="toolbar">
      <div className="brand">Lattice Designer</div>

      <div className="group">
        <label className="inline">
          W
          <input
            type="number"
            min={MIN_DIM}
            max={MAX_DIM}
            value={design.grid.width}
            onChange={(e) =>
              onResize(clampDim(Number(e.target.value)), design.grid.height)
            }
          />
        </label>
        <label className="inline">
          H
          <input
            type="number"
            min={MIN_DIM}
            max={MAX_DIM}
            value={design.grid.height}
            onChange={(e) =>
              onResize(design.grid.width, clampDim(Number(e.target.value)))
            }
          />
        </label>
        <div className="presets">
          {GRID_PRESETS.map((p) => {
            const active =
              design.grid.width === p.width && design.grid.height === p.height;
            return (
              <button
                key={p.name}
                type="button"
                className={active ? "preset active" : "preset"}
                title={`${p.name} scored grid: ${p.width}×${p.height}`}
                onClick={() => onResize(p.width, p.height)}
              >
                {p.name} {p.width}×{p.height}
              </button>
            );
          })}
        </div>
      </div>

      <div className="group">
        <button type="button" onClick={onTogglePlay}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <div className="speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={s === speed ? "speed active" : "speed"}
              onClick={() => onSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="group status">
        <span className={status && !status.valid ? "invalid" : "ok"}>
          {status && !status.valid ? "invalid layout" : "running"}
        </span>
        <span>tick {status?.tick ?? 0}</span>
        <span>{design.entities.length} components</span>
      </div>

      <div className="group export">
        <label
          className="inline"
          title="Placeholder run length written into the export; set the real scored length when wiring the case."
        >
          ticks
          <input
            type="number"
            min={1}
            style={{ width: 88 }}
            value={ticks}
            onChange={(e) =>
              setTicks(Math.max(1, Math.floor(Number(e.target.value)) || 1))
            }
          />
        </label>
        <button type="button" onClick={download}>
          Export scenario.json
        </button>
        <button type="button" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
        <button type="button" className="danger" onClick={onClear}>
          Clear
        </button>
      </div>
    </header>
  );
}
