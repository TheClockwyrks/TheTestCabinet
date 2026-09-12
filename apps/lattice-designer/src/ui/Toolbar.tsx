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
//
// Every field up here changes the SHAPE of the design or of the run, and the tool
// has no undo, so none of them commits from a keystroke. They divide in two by what
// a wrong commit costs:
//
//   • the run length and the snapshot schedule are held until the field is left or
//     Enter is pressed, Escape abandoning the edit — a wrong one is simply retyped;
//   • the board size is not committed by this toolbar at all. It is staged in
//     `<BoardSize>` and applied by an explicit button, because applying it takes
//     components off the board and off the saved file. See `boardDraft.ts`.

import { useState, type KeyboardEvent } from "react";
import type { Design, Timeline } from "../model";
import type { ScenarioSummary } from "../scenarioFiles";
import type { SimStatus } from "../sim";
import { BoardSize } from "./BoardSize";
import { NumberInput } from "./NumberInput";
import { commitTickList, formatTicks } from "./tickList";

const SPEEDS = [0.5, 1, 2, 4] as const;

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
  /** How many components a shrink has set aside, waiting for the board to grow. */
  asideCount: number;
  /**
   * Apply a board size. Never called by a field changing — only by Apply, by Enter
   * inside a staged field, or by a preset click. The handler plans the resize and
   * asks before committing one that would set components aside.
   */
  onApplySize: (width: number, height: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  onClear: () => void;
  onTimeline: (timeline: Timeline) => void;
  onOpen: (name: string) => void;
  onImport: (name: string) => void;
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
  asideCount,
  onApplySize,
  onTogglePlay,
  onSpeed,
  onClear,
  onTimeline,
  onOpen,
  onImport,
  onSave,
  onClose,
}: ToolbarProps) {
  // Which scenario Open and Import act on, which is not necessarily the file being
  // edited: an import leaves `openFile` alone.
  const [chosen, setChosen] = useState("");

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

  return (
    <header className="toolbar">
      <div className="brand">Lattice Designer</div>

      {scenarios !== null && (
        <div className="group file">
          <select
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            title="A scenario from the case's cases/ folder"
          >
            <option value="">choose scenario…</option>
            {scenarios.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} · {s.grid.width}×{s.grid.height} · {s.entities}{" "}
                components
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onOpen(chosen)}
            disabled={!chosen}
            title="Load it for editing, grid and all, and edit that file"
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => onImport(chosen)}
            disabled={!chosen}
            title={`Load its components onto the current ${design.grid.width}×${design.grid.height} board. Anything that does not fit is set aside rather than dropped — grow the board to bring it back. Whatever file is open stays the save target.`}
          >
            Import here
          </button>
          <span className="editing">
            {openFile ? `editing ${openFile}.json` : "no file"}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={!openFile || !dirty || timelineProblem !== null}
            title={
              openFile
                ? `Overwrite cases/${openFile}.json${
                    asideCount > 0
                      ? ` — ${asideCount} component${asideCount === 1 ? "" : "s"} are set aside and will NOT be written; grow the board to bring them back first`
                      : ""
                  }`
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

      <BoardSize grid={design.grid} onApply={onApplySize} />

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
        {asideCount > 0 && (
          <span
            className="aside"
            title="Components a smaller board set aside. They are not exported, and they come back when the board grows over them again."
          >
            +{asideCount} set aside
          </span>
        )}
        {notice && <span className="notice">{notice}</span>}
      </div>

      <div className="group export">
        <label
          className="inline"
          title="The run length written to the file. A scored scenario's is set by the case. Applied when you leave the field or press Enter."
        >
          ticks
          <NumberInput
            label="The run length"
            min={1}
            style={{ width: 88 }}
            ariaLabel="Run length in ticks"
            commit="blur"
            value={timeline.ticks}
            onCommit={(ticks) => onTimeline({ ...timeline, ticks })}
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
          <SnapshotsInput
            snapshots={timeline.snapshots}
            onCommit={(snapshots) => onTimeline({ ...timeline, snapshots })}
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
 * The snapshot schedule, edited as text.
 *
 * The field is controlled by the TYPING while an edit is in progress and by the
 * committed schedule the rest of the time. Controlling it by the parsed list meant
 * a comma vanished as it was typed (so a second checkpoint could not be added) and
 * clearing the field destroyed the schedule a keystroke at a time. The parsing
 * itself is unchanged and still permissive — `timelineError` is what reports a
 * schedule the engine would refuse, and what blocks the save on it.
 */
function SnapshotsInput({
  snapshots,
  onCommit,
}: {
  snapshots: number[];
  onCommit: (snapshots: number[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const next = commitTickList(draft, snapshots);
    setDraft(null);
    if (next) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
    }
  };

  return (
    <input
      type="text"
      style={{ width: 280 }}
      aria-label="Snapshot ticks"
      value={draft ?? formatTicks(snapshots)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
