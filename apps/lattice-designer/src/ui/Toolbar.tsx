// The top toolbar: the open scenario file, board size, playback controls, the
// timeline, live status, and export.
//
// Two ways out of the tool, side by side. A scenario opened from the case's `cases/`
// folder is edited and SAVED back to that file — the dev server does the write (see
// `../scenario-api.ts`). Anything else is handed over by Export/Copy, the path for a
// design that is not yet a committed scenario.
//
// The timeline (`ticks` + `snapshots`) is shown and edited here rather than
// generated on the way out. A scored scenario's snapshot schedule is load-bearing —
// the case grades at those exact ticks — so it is displayed for review and written
// back as-is, never silently recomputed.

import { GRID_PRESETS, type Design, type Timeline } from "../model";
import type { ScenarioSummary } from "../scenarioFiles";
import type { SimStatus } from "../sim";

const SPEEDS = [0.5, 1, 2, 4] as const;
const MIN_DIM = 4;
const MAX_DIM = 120;

interface ToolbarProps {
  design: Design;
  status: SimStatus | null;
  playing: boolean;
  speed: number;
  timeline: Timeline;
  /** Why the timeline would be rejected by the engine, or `null` when it is fine. */
  timelineProblem: string | null;
  /** The scenarios that can be opened, or `null` when this build has no file API. */
  scenarios: ScenarioSummary[] | null;
  /** The file being edited, if any. */
  openFile: string | null;
  dirty: boolean;
  notice: string | null;
  /** The exact JSON a save/export would write. */
  exportText: string;
  onResize: (width: number, height: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  onClear: () => void;
  onTimeline: (timeline: Timeline) => void;
  onOpen: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function Toolbar({
  design,
  status,
  playing,
  speed,
  timeline,
  timelineProblem,
  scenarios,
  openFile,
  dirty,
  notice,
  exportText,
  onResize,
  onTogglePlay,
  onSpeed,
  onClear,
  onTimeline,
  onOpen,
  onSave,
  onClose,
}: ToolbarProps) {
  const download = () => {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = openFile ? `${openFile}.json` : "scenario.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = () => {
    void navigator.clipboard.writeText(exportText);
  };

  const clampDim = (v: number) =>
    Math.max(MIN_DIM, Math.min(MAX_DIM, Math.floor(v) || MIN_DIM));

  return (
    <header className="toolbar">
      <div className="brand">Lattice Designer</div>

      {scenarios !== null && (
        <div className="group file">
          <select
            value={openFile ?? ""}
            onChange={(e) => {
              if (e.target.value) onOpen(e.target.value);
            }}
            title="Open a scenario from the case's cases/ folder"
          >
            <option value="">open scenario…</option>
            {scenarios.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} · {s.grid.width}×{s.grid.height} · {s.entities}{" "}
                components
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onSave}
            disabled={!openFile || !dirty || timelineProblem !== null}
            title={
              openFile
                ? `Overwrite cases/${openFile}.json`
                : "Open a scenario first"
            }
          >
            {dirty ? "Save •" : "Save"}
          </button>
          {openFile && (
            <button
              type="button"
              onClick={onClose}
              title="Stop editing this file (the layout stays on the board)"
            >
              Close
            </button>
          )}
        </div>
      )}

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
        {notice && <span className="notice">{notice}</span>}
      </div>

      <div className="group export">
        <label
          className="inline"
          title="The run length written to the file. A scored scenario's is set by the case."
        >
          ticks
          <input
            type="number"
            min={1}
            style={{ width: 88 }}
            value={timeline.ticks}
            onChange={(e) =>
              onTimeline({
                ...timeline,
                ticks: Math.max(1, Math.floor(Number(e.target.value)) || 1),
              })
            }
          />
        </label>
        <label
          className={timelineProblem ? "inline bad" : "inline"}
          title={
            timelineProblem ??
            "The ticks this scenario is checksummed at, comma separated. A scored schedule is graded at exactly these."
          }
        >
          snapshots
          <input
            type="text"
            style={{ width: 280 }}
            value={timeline.snapshots.join(", ")}
            onChange={(e) =>
              onTimeline({ ...timeline, snapshots: parseTicks(e.target.value) })
            }
          />
        </label>
        <button type="button" onClick={download}>
          Export
        </button>
        <button type="button" onClick={copy}>
          Copy
        </button>
        <button type="button" className="danger" onClick={onClear}>
          Clear
        </button>
      </div>
    </header>
  );
}

/**
 * A comma-separated tick list as numbers, keeping whatever the field currently says
 * — including a list that is out of order or past the end. Validation belongs to
 * `timelineError`, which reports it and blocks the save; silently repairing the text
 * as it is typed would fight the person editing it.
 */
function parseTicks(text: string): number[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Math.floor(Number(part)))
    .filter((n) => Number.isFinite(n));
}
