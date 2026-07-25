// The designer shell: owns all editor state (the design, the current tool, the
// selection, playback) and wires the toolbar, palette, grid, and inspector to it.
// The grid draws the live sim (via `useSimulation`); everything else mutates the
// design, and each mutation produces a NEW design object so the sim replays it.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  canPlace,
  DEFAULT_TOOL_OPTIONS,
  entityAt,
  inBounds,
  makeEntity,
  occupancy,
  rotateCW,
  type Design,
  type DesignEntity,
  type Dir,
  type EntityKind,
  type ToolOptions,
} from "../model";
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

export function App() {
  const [design, setDesign] = useState<Design>(INITIAL_DESIGN);
  const [tool, setTool] = useState<Tool>({
    kind: "belt",
    dir: "E",
    opts: DEFAULT_TOOL_OPTIONS,
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<SimStatus | null>(null);

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

  // --- Tool mutations ------------------------------------------------------

  const setKind = useCallback(
    (kind: EntityKind | "select") => setTool((t) => ({ ...t, kind })),
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

  return (
    <div className="app">
      <Toolbar
        design={design}
        status={status}
        playing={playing}
        speed={speed}
        onResize={resize}
        onTogglePlay={() => setPlaying((p) => !p)}
        onSpeed={setSpeed}
        onClear={clearAll}
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
