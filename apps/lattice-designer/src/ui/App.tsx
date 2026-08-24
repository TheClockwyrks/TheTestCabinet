// The designer shell: owns all editor state (the design, the current tool, the
// selection, playback) and wires the toolbar, palette, grid, and inspector to it.
// The grid draws the live sim (via `useSimulation`); everything else mutates the
// design, and each mutation produces a NEW design object so the sim replays it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPlace,
  defaultTimeline,
  DEFAULT_TOOL_OPTIONS,
  entityAt,
  exportJson,
  fromScenario,
  inBounds,
  makeEntity,
  occupancy,
  rotateCW,
  timelineError,
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

  const resize = useCallback((width: number, height: number) => {
    setDesign((prev) => {
      const grid = { width, height };
      // Drop anything whose footprint no longer fits, so the design stays valid.
      const entities = prev.entities.filter((e) => inBounds(e, grid));
      return { grid, entities };
    });
    setSelected(null);
  }, []);

  const clearAll = useCallback(() => {
    setDesign((prev) => ({ ...prev, entities: [] }));
    setSelected(null);
  }, []);

  // --- Scenario files ------------------------------------------------------

  // The text this design would be saved as. Also the dirty check's comparison key.
  const currentText = useMemo(
    () => exportJson(design, timeline),
    [design, timeline],
  );
  const dirty = openFile !== null && currentText !== openFile.savedText;
  const timelineProblem = timelineError(timeline);

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

  const openScenario = useCallback(
    (name: string) => {
      if (dirty && !window.confirm("Discard unsaved changes and open " + name + "?")) {
        return;
      }
      setFileNotice(null);
      void readScenario(name)
        .then((json) => {
          const loaded = fromScenario(json);
          setDesign(loaded.design);
          setTimeline(loaded.timeline);
          setSelected(null);
          setOpenFile({
            name,
            savedText: exportJson(loaded.design, loaded.timeline),
          });
          setFileNotice(`opened ${name}.json`);
        })
        .catch((err: unknown) => {
          setFileNotice(`could not open ${name}: ${describe(err)}`);
        });
    },
    [dirty],
  );

  const saveScenario = useCallback(() => {
    if (!openFile) return;
    // The engine rejects a schedule that runs past the end or does not ascend, and
    // a scored file is read by the validator, not just by this tool — so refuse
    // here rather than write something a run would choke on.
    if (timelineProblem) {
      setFileNotice(`cannot save: ${timelineProblem}`);
      return;
    }
    const text = currentText;
    void writeScenario(openFile.name, text)
      .then(() => {
        setOpenFile({ name: openFile.name, savedText: text });
        setFileNotice(`saved ${openFile.name}.json`);
      })
      .catch((err: unknown) => {
        setFileNotice(`could not save ${openFile.name}: ${describe(err)}`);
      });
  }, [openFile, currentText, timelineProblem]);

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

  // A tab close with unsaved edits to a committed scenario would lose work that has
  // no other copy, so ask. (Browsers show their own wording, not this string.)
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
        onResize={resize}
        onTogglePlay={() => setPlaying((p) => !p)}
        onSpeed={setSpeed}
        onClear={clearAll}
        onTimeline={setTimeline}
        onOpen={openScenario}
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
    </div>
  );
}

/** A thrown value as something worth showing in the toolbar. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
