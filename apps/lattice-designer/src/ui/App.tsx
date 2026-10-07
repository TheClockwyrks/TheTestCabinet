// The designer shell: owns all editor state (the design, the current tool, the
// selection, playback) and wires the toolbar, palette, grid, and inspector to it.
// The grid draws the live sim (via `useSimulation`); everything else mutates the
// design, and each mutation produces a NEW design object so the sim replays it.
//
// The rule this file is written to: a change that can cost the user work is STAGED
// and applied explicitly, and an apply that would take work off the board asks
// first. There is no undo anywhere in this tool, so nothing here may act on a
// keystroke, on a blur, or on any other side effect of the user simply moving
// around. The board size is staged in `<BoardSize>` and arrives here only through
// `applyBoardSize`; every path that discards or displaces authored components —
// resize, preset, Clear, Open, Import — routes through the themed confirmation in
// `useConfirm`, never `window.confirm()`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPlace,
  defaultTimeline,
  DEFAULT_TOOL_OPTIONS,
  entityAt,
  exportJson,
  fromScenario,
  makeEntity,
  occupancy,
  resizeBoard,
  rotateCW,
  timelineError,
  type AsideEntity,
  type Design,
  type DesignEntity,
  type Dir,
  type EntityKind,
  type Timeline,
  type ToolOptions,
} from "../model";
import {
  listScenarios,
  readScenario,
  writeScenario,
  type ScenarioSummary,
} from "../scenarioFiles";
import type { SimStatus } from "../sim";
import { useSimulation } from "../useSimulation";
import { count, resizeQuestion } from "./boardDraft";
import { useConfirm } from "./useConfirm";
import { Toolbar } from "./Toolbar";
import { Palette } from "./Palette";
import { Grid } from "./Grid";
import { Inspector } from "./Inspector";

/** The active tool: which kind to place (or `select`), its facing, and its options. */
export interface Tool {
  kind: EntityKind | "select";
  dir: Dir;
  opts: ToolOptions;
}

const INITIAL_DESIGN: Design = {
  grid: { width: 24, height: 16 },
  entities: [],
};

/** The run length a design that did not come from a file exports with. */
const DEFAULT_EXPORT_TICKS = 100_000;

/**
 * The scenario file currently open for editing, and the exact text it held when it
 * was opened or last saved. Keeping the text is what makes "unsaved changes" an
 * honest question rather than a guess: the design is compared by the bytes it would
 * write, so an edit that cancels itself out correctly reads as clean.
 */
interface OpenFile {
  name: string;
  savedText: string;
}

export function App() {
  const [design, setDesign] = useState<Design>(INITIAL_DESIGN);
  // Components a smaller board took off the board. Nothing in this tool can be
  // undone, so a shrink sets them aside instead of deleting them and growing the
  // board back over them puts them back. They are not part of the design: the sim
  // never sees them and an export never writes them.
  const [aside, setAside] = useState<AsideEntity[]>([]);
  // Start in the neutral Select mode: no placement tool armed, so the cursor moves
  // freely (no ghost) and right-click deletes without any risk of misplacing.
  const [tool, setTool] = useState<Tool>({
    kind: "select",
    dir: "E",
    opts: DEFAULT_TOOL_OPTIONS,
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [timeline, setTimeline] = useState<Timeline>(() =>
    defaultTimeline(DEFAULT_EXPORT_TICKS),
  );
  // `null` until the scenario list resolves, and stays `null` in a static build
  // where there is no dev server to open files through.
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);

  // The themed replacement for `window.confirm()`. `dialog` is rendered below; the
  // handlers just await `confirm(...)`. See `useConfirm.tsx`.
  const { confirm, dialog } = useConfirm();

  const onStatus = useCallback((s: SimStatus) => setStatus(s), []);

  // The live-sim canvas is owned here (so play/speed live with the rest of the
  // editor state) but rendered by <Grid>; the ref bridges the two.
  const simCanvasRef = useRef<HTMLCanvasElement>(null);
  useSimulation(simCanvasRef, design, playing, speed, onStatus);

  // --- Design mutations ----------------------------------------------------

  const place = useCallback(
    (x: number, y: number) => {
      setDesign((prev) => {
        const entity = makeEntity(
          tool.kind as EntityKind,
          x,
          y,
          tool.dir,
          tool.opts,
        );
        if (!canPlace(entity, prev.grid, occupancy(prev))) return prev;
        return { ...prev, entities: [...prev.entities, entity] };
      });
    },
    [tool],
  );

  const remove = useCallback((x: number, y: number) => {
    setDesign((prev) => {
      const idx = entityAt(prev, x, y);
      if (idx < 0) return prev;
      const entities = prev.entities.filter((_, i) => i !== idx);
      return { ...prev, entities };
    });
    // The selection is index-based; a delete shifts indices, so drop it.
    setSelected(null);
  }, []);

  const select = useCallback((x: number, y: number) => {
    setDesign((prev) => {
      const idx = entityAt(prev, x, y);
      setSelected(idx >= 0 ? idx : null);
      return prev;
    });
  }, []);

  const updateEntity = useCallback(
    (index: number, patch: Partial<DesignEntity>) => {
      setDesign((prev) => {
        const entities = prev.entities.slice();
        const current = entities[index];
        if (!current) return prev;
        entities[index] = { ...current, ...patch } as DesignEntity;
        return { ...prev, entities };
      });
    },
    [],
  );

  const deleteEntity = useCallback((index: number) => {
    setDesign((prev) => ({
      ...prev,
      entities: prev.entities.filter((_, i) => i !== index),
    }));
    setSelected(null);
  }, []);

  /**
   * Apply a board size.
   *
   * The only route a resize takes, whether it came from Apply, from Enter inside a
   * staged field, or from a preset button. Nothing calls it as a side effect of a
   * value changing — that is the point of staging the fields.
   *
   * The plan is computed BEFORE anything is asked and thrown away if the answer is
   * no. `resizeBoard` is a pure function of the design, the set-aside list and the
   * new size, so running it is how the consequences are known: `setAside` and
   * `restored` on the result say exactly what the resize would do, and no state is
   * touched until `setDesign` is reached. There is no copy to make and nothing to
   * roll back.
   */
  const applyBoardSize = useCallback(
    async (width: number, height: number) => {
      const unchanged =
        design.grid.width === width &&
        design.grid.height === height &&
        aside.length === 0;
      // Re-seating an unchanged board would replay the sim from empty for nothing
      // — the preset buttons are clickable while their preset is already active.
      if (unchanged) return;

      const plan = resizeBoard(design, aside, width, height);
      const question = resizeQuestion({ width, height }, plan);
      if (question) {
        const ok = await confirm({
          title: question.title,
          message: question.message,
          details: <Bullets lines={question.details} />,
          confirmLabel: question.confirmLabel,
          cancelLabel: "Keep the board as it is",
        });
        // The plan is simply dropped. The design, the set-aside list and the
        // selection were never touched.
        if (!ok) return;
      }

      setDesign(plan.design);
      setAside(plan.aside);
      setSelected(null);
      setFileNotice(resizeNotice(width, height, plan.setAside, plan.restored));
    },
    [design, aside, confirm],
  );

  const clearAll = useCallback(async () => {
    const total = design.entities.length + aside.length;
    // The one control that empties the board, and there is no undo behind it.
    if (total === 0) return;
    const ok = await confirm({
      title: "Clear the board",
      message: `${count(total, "component")} would be removed from this design.`,
      details: (
        <Bullets
          lines={[
            "This cannot be undone — the designer has no history.",
            aside.length > 0
              ? `${count(aside.length, "set-aside component")} goes too, so growing the board will not bring anything back.`
              : "Export or Copy first if you want to keep this layout.",
            openFile
              ? `The file on disk is unchanged until you Save over it.`
              : "This design belongs to no file, so nothing else has a copy of it.",
          ]}
        />
      ),
      confirmLabel: `Remove ${count(total, "component")}`,
    });
    if (!ok) return;
    setDesign((prev) => ({ ...prev, entities: [] }));
    setAside([]);
    setSelected(null);
  }, [design.entities.length, aside.length, openFile, confirm]);

  // --- Scenario files ------------------------------------------------------

  // The text this design would be saved as. Also the dirty check's comparison key.
  const currentText = useMemo(
    () => exportJson(design, timeline),
    [design, timeline],
  );
  const dirty = openFile !== null && currentText !== openFile.savedText;
  const timelineProblem = timelineError(timeline);
  // Work on the board that no file holds a copy of: a design that was never opened
  // from one. Losing it loses it for good, which is why replacing it asks.
  const unfiled =
    openFile === null && design.entities.length + aside.length > 0;

  // Ask the dev server what it can open. A `null` answer means this build has no
  // file API at all, which the toolbar renders as export-only rather than an error.
  useEffect(() => {
    let live = true;
    void listScenarios().then((found) => {
      if (live) setScenarios(found);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Ask before something replaces what is on the board.
   *
   * Both Open and Import throw the current layout away. That was guarded only by
   * `dirty`, which is false whenever no file is open — so an hour of unfiled work
   * could be replaced by a click with no question asked at all. The question now
   * follows the work rather than the file.
   */
  const confirmReplace = useCallback(
    async (action: string): Promise<boolean> => {
      if (dirty && openFile) {
        return confirm({
          title: "Discard unsaved changes?",
          message: `${action} replaces this design, and it has edits that have not been saved to ${openFile.name}.json.`,
          details: (
            <Bullets
              lines={[
                `${openFile.name}.json on disk is not changed — the edits are simply lost.`,
                "Cancel and press Save first to keep them.",
              ]}
            />
          ),
          confirmLabel: "Discard and continue",
        });
      }
      if (unfiled) {
        return confirm({
          title: "Discard this design?",
          message: `${action} replaces the ${count(design.entities.length + aside.length, "component")} on this board, and no file holds a copy of them.`,
          details: (
            <Bullets
              lines={[
                "This design was never opened from a scenario, so nothing else has it.",
                "Cancel and use Export or Copy to keep it.",
              ]}
            />
          ),
          confirmLabel: "Discard and continue",
        });
      }
      return true;
    },
    [confirm, dirty, openFile, unfiled, design.entities.length, aside.length],
  );

  const openScenario = useCallback(
    (name: string) => {
      void (async () => {
        if (!(await confirmReplace(`Opening ${name}.json`))) return;
        setFileNotice(null);
        try {
          const json = await readScenario(name);
          const loaded = fromScenario(json);
          setDesign(loaded.design);
          setTimeline(loaded.timeline);
          setSelected(null);
          // A different design entirely: anything the old one had set aside would
          // reappear on this one's first widening, which nobody asked for.
          setAside([]);
          setOpenFile({
            name,
            savedText: exportJson(loaded.design, loaded.timeline),
          });
          setFileNotice(`opened ${name}.json`);
        } catch (err: unknown) {
          setFileNotice(`could not open ${name}: ${describe(err)}`);
        }
      })();
    },
    [confirmReplace],
  );

  /**
   * Write the open scenario back to its file.
   *
   * Saving while components are set aside is the one way a set-aside component
   * becomes a real loss: they survive any amount of resizing in this tool, but the
   * file gets what is on the board, so an overwrite drops them from the only copy
   * that outlives the tab. The board says how many are set aside and the Save
   * button's tooltip repeats it, and neither is enough — a save is exactly the
   * moment somebody is not reading the toolbar — so it asks.
   */
  const saveScenario = useCallback(async () => {
    if (!openFile) return;
    // The engine rejects a schedule that runs past the end or does not ascend, and
    // a scored file is read by the validator, not just by this tool — so refuse
    // here rather than write something a run would choke on.
    if (timelineProblem) {
      setFileNotice(`cannot save: ${timelineProblem}`);
      return;
    }
    if (aside.length > 0) {
      const ok = await confirm({
        title: `Save ${openFile.name}.json without the set-aside components?`,
        message: `${count(aside.length, "component")} are set aside, and a save writes what is on the board.`,
        details: (
          <Bullets
            lines={[
              `${openFile.name}.json would be overwritten with the ${count(design.entities.length, "component")} currently on the board.`,
              "The set-aside components are not in it, and the file is the only copy that survives closing this tab.",
              `Cancel, grow the board back to at least the size they were placed on, and they return — then save.`,
            ]}
          />
        ),
        confirmLabel: "Save without them",
      });
      if (!ok) return;
    }
    const text = currentText;
    try {
      await writeScenario(openFile.name, text);
      setOpenFile({ name: openFile.name, savedText: text });
      setFileNotice(`saved ${openFile.name}.json`);
    } catch (err: unknown) {
      setFileNotice(`could not save ${openFile.name}: ${describe(err)}`);
    }
  }, [
    openFile,
    currentText,
    timelineProblem,
    aside.length,
    design.entities.length,
    confirm,
  ]);

  /**
   * Load a scenario's components onto the CURRENT board instead of adopting its
   * grid. The open file stays attached, so a later Save goes to the file being
   * edited, not to the one imported from.
   *
   * Anything whose footprint falls outside the board is SET ASIDE, not dropped.
   * This path used to `filter(inBounds)` — silently deleting the overhang, the
   * exact defect the resize path was fixed for — and the fix is the same one:
   * `resizeBoard` against the board's own size is precisely "keep what fits, set
   * the rest aside", so growing the board afterwards brings the rest in instead of
   * requiring the import to be redone at a bigger size.
   */
  const importScenario = useCallback(
    (name: string) => {
      void (async () => {
        if (!(await confirmReplace(`Importing ${name}.json`))) return;
        setFileNotice(null);
        try {
          const json = await readScenario(name);
          const grid = design.grid;
          const loaded = fromScenario(json).design.entities;
          const fitted = resizeBoard(
            { grid, entities: loaded },
            [],
            grid.width,
            grid.height,
          );
          setDesign(fitted.design);
          setAside(fitted.aside);
          setSelected(null);
          const size = `${grid.width}×${grid.height}`;
          const fit =
            fitted.setAside === 0
              ? `all ${loaded.length} components fit`
              : `${fitted.setAside} of ${loaded.length} did not fit ${size} and are set aside (not exported; grow the board to bring them in)`;
          const target = openFile
            ? `; Save still targets ${openFile.name}.json`
            : "";
          setFileNotice(`imported ${name}.json onto ${size} — ${fit}${target}`);
        } catch (err: unknown) {
          setFileNotice(`could not import ${name}: ${describe(err)}`);
        }
      })();
    },
    [confirmReplace, design.grid, openFile],
  );

  // Editing a design that came from a file makes it a new design, not an edit of
  // that file — so closing is explicit and leaves the layout on the board.
  const closeScenario = useCallback(() => {
    setOpenFile(null);
    setFileNotice(null);
  }, []);

  // --- Tool mutations ------------------------------------------------------

  // Selecting a kind arms it; clicking the armed kind again disarms back to Select,
  // so a placement tool is easy to put down.
  const setKind = useCallback(
    (kind: EntityKind | "select") =>
      setTool((t) => ({ ...t, kind: t.kind === kind ? "select" : kind })),
    [],
  );
  const deselect = useCallback(
    () => setTool((t) => ({ ...t, kind: "select" })),
    [],
  );
  const rotate = useCallback(
    () => setTool((t) => ({ ...t, dir: rotateCW(t.dir) })),
    [],
  );
  const setOpts = useCallback(
    (patch: Partial<ToolOptions>) =>
      setTool((t) => ({ ...t, opts: { ...t.opts, ...patch } })),
    [],
  );

  const selectedEntity = useMemo(
    () => (selected !== null ? (design.entities[selected] ?? null) : null),
    [design, selected],
  );

  // A tab close with work that has no other copy — unsaved edits to a committed
  // scenario, or a design that was never opened from one — would lose it, so ask.
  // (Browsers show their own wording, not this string.)
  const atRisk = dirty || unfiled;
  useEffect(() => {
    if (!atRisk) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [atRisk]);

  return (
    <div className="app">
      <Toolbar
        design={design}
        status={status}
        playing={playing}
        speed={speed}
        timeline={timeline}
        timelineProblem={timelineProblem}
        scenarios={scenarios}
        openFile={openFile?.name ?? null}
        dirty={dirty}
        notice={fileNotice}
        exportText={currentText}
        asideCount={aside.length}
        onApplySize={applyBoardSize}
        onTogglePlay={() => setPlaying((p) => !p)}
        onSpeed={setSpeed}
        onClear={clearAll}
        onTimeline={setTimeline}
        onOpen={openScenario}
        onImport={importScenario}
        onSave={saveScenario}
        onClose={closeScenario}
      />
      <div className="body">
        <Palette
          tool={tool}
          onKind={setKind}
          onRotate={rotate}
          onOpts={setOpts}
        />
        <Grid
          design={design}
          tool={tool}
          selected={selected}
          simCanvasRef={simCanvasRef}
          onPlace={place}
          onDelete={remove}
          onSelect={select}
          onRotate={rotate}
          onDeselect={deselect}
        />
        <Inspector
          index={selected}
          entity={selectedEntity}
          onUpdate={updateEntity}
          onDelete={deleteEntity}
        />
      </div>
      {dialog}
    </div>
  );
}

/** A confirmation's consequences, one per line. */
function Bullets({ lines }: { lines: string[] }) {
  return (
    <ul className="dialog-list">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** What a resize did with the components it moved, or `null` when it moved none. */
function resizeNotice(
  width: number,
  height: number,
  movedAside: number,
  restored: number,
): string | null {
  const moves: string[] = [];
  if (movedAside > 0) {
    moves.push(
      `${count(movedAside, "component")} set aside (not exported; grow the board and they come back)`,
    );
  }
  if (restored > 0) {
    moves.push(`${count(restored, "component")} restored`);
  }
  if (moves.length === 0) return null;
  return `board ${width}×${height} — ${moves.join("; ")}`;
}

/** A thrown value as something worth showing in the toolbar. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
