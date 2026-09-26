// The factory grid: two stacked canvases at the board's natural pixel size.
//
//   • the SIM canvas (ref owned by <App>) is drawn by the reused Renderer via the
//     Simulation — the running factory, sprites and items;
//   • the OVERLAY canvas on top is drawn here — the placement ghost, the invalid
//     tint, and the current selection — and it is the one that receives pointer
//     input, mapping pixels back to tiles.
//
// Interaction: left-click places the current tool (belt drags paint a line);
// right-click deletes whatever entity covers the tile (and, because the sim replays
// from the entity list, any items that were riding it vanish with it); with the
// Select tool, left-click picks an entity for the inspector. `R` rotates the tool.

import { useCallback, useEffect, useRef, useState } from "react";
import { CELL } from "../assets";
import {
  canPlace,
  footprint,
  isDirectional,
  makeEntity,
  occupancy,
  type Design,
  type Dir,
} from "../model";
import type { Tool } from "./App";

interface GridProps {
  design: Design;
  tool: Tool;
  selected: number | null;
  simCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onPlace: (x: number, y: number) => void;
  onDelete: (x: number, y: number) => void;
  onSelect: (x: number, y: number) => void;
  onRotate: () => void;
  onDeselect: () => void;
}

/** A tile under the cursor. */
interface Hover {
  x: number;
  y: number;
}

export function Grid({
  design,
  tool,
  selected,
  simCanvasRef,
  onPlace,
  onDelete,
  onSelect,
  onRotate,
  onDeselect,
}: GridProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // The tile most recently painted during a left-drag, so a belt drag places each
  // tile once instead of on every pointermove event over the same tile.
  const painting = useRef(false);
  const lastPainted = useRef<string | null>(null);

  const width = design.grid.width * CELL;
  const height = design.grid.height * CELL;

  // Map a pointer event to a tile, accounting for any CSS scaling of the canvas.
  const tileOf = useCallback(
    (e: React.PointerEvent): Hover | null => {
      const canvas = overlayRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const x = Math.floor(((e.clientX - rect.left) * sx) / CELL);
      const y = Math.floor(((e.clientY - rect.top) * sy) / CELL);
      if (x < 0 || y < 0 || x >= design.grid.width || y >= design.grid.height)
        return null;
      return { x, y };
    },
    [design.grid.width, design.grid.height],
  );

  const handleDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // left button only; right is the context menu
      const tile = tileOf(e);
      if (!tile) return;
      if (tool.kind === "select") {
        onSelect(tile.x, tile.y);
        return;
      }
      onPlace(tile.x, tile.y);
      // Belts paint in a stroke; other kinds place one per click.
      if (tool.kind === "belt") {
        painting.current = true;
        lastPainted.current = `${tile.x},${tile.y}`;
        overlayRef.current?.setPointerCapture(e.pointerId);
      }
    },
    [tool.kind, tileOf, onPlace, onSelect],
  );

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      const tile = tileOf(e);
      setHover(tile);
      if (!tile || !painting.current) return;
      const key = `${tile.x},${tile.y}`;
      if (key === lastPainted.current) return;
      lastPainted.current = key;
      onPlace(tile.x, tile.y);
    },
    [tileOf, onPlace],
  );

  const endPaint = useCallback(() => {
    painting.current = false;
    lastPainted.current = null;
  }, []);

  const handleContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const canvas = overlayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const x = Math.floor(((e.clientX - rect.left) * sx) / CELL);
      const y = Math.floor(((e.clientY - rect.top) * sy) / CELL);
      if (x < 0 || y < 0 || x >= design.grid.width || y >= design.grid.height)
        return;
      onDelete(x, y);
    },
    [design.grid.width, design.grid.height, onDelete],
  );

  // `R` rotates the current tool; `Escape` puts it down (back to Select).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        onRotate();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDeselect();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRotate, onDeselect]);

  // Redraw the overlay whenever what it shows changes.
  useEffect(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSelection(ctx, design, selected);
    drawGhost(ctx, design, tool, hover);
  }, [design, tool, selected, hover]);

  return (
    <div className="stage">
      <div className="board" style={{ width, height }}>
        <canvas
          ref={simCanvasRef}
          className="sim-canvas"
          width={width}
          height={height}
        />
        <canvas
          ref={overlayRef}
          className="overlay-canvas"
          width={width}
          height={height}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={endPaint}
          onPointerLeave={() => {
            setHover(null);
            endPaint();
          }}
          onContextMenu={handleContext}
        />
      </div>
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

/** Outline the selected entity's footprint. */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  design: Design,
  selected: number | null,
): void {
  if (selected === null) return;
  const entity = design.entities[selected];
  if (!entity) return;
  ctx.save();
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2;
  for (const [tx, ty] of footprint(entity)) {
    ctx.strokeRect(tx * CELL + 1, ty * CELL + 1, CELL - 2, CELL - 2);
  }
  ctx.restore();
}

/** Draw the placement ghost at the hovered tile: green where it fits, red where it
 * does not, with a facing arrow for directional kinds. Nothing while the Select
 * tool is active. */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  design: Design,
  tool: Tool,
  hover: Hover | null,
): void {
  if (!hover || tool.kind === "select") return;
  const entity = makeEntity(tool.kind, hover.x, hover.y, tool.dir, tool.opts);
  const ok = canPlace(entity, design.grid, occupancy(design));
  ctx.save();
  ctx.fillStyle = ok ? "rgba(74, 222, 128, 0.35)" : "rgba(248, 113, 113, 0.4)";
  ctx.strokeStyle = ok ? "#4ade80" : "#f87171";
  ctx.lineWidth = 1.5;
  for (const [tx, ty] of footprint(entity)) {
    ctx.fillRect(tx * CELL, ty * CELL, CELL, CELL);
    ctx.strokeRect(tx * CELL + 0.5, ty * CELL + 0.5, CELL - 1, CELL - 1);
  }
  if (isDirectional(tool.kind)) drawArrow(ctx, hover.x, hover.y, tool.dir);
  ctx.restore();
}

const ARROW: Record<Dir, [number, number]> = {
  E: [1, 0],
  W: [-1, 0],
  S: [0, 1],
  N: [0, -1],
};

/** A small arrow at the anchor tile centre, pointing `dir` (the flow direction). */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  dir: Dir,
): void {
  const cx = tx * CELL + CELL / 2;
  const cy = ty * CELL + CELL / 2;
  const [fx, fy] = ARROW[dir];
  // Perpendicular, for the arrowhead's base corners.
  const px = -fy;
  const py = fx;
  const tip = CELL * 0.34;
  const base = CELL * 0.14;
  ctx.beginPath();
  ctx.moveTo(cx + fx * tip, cy + fy * tip);
  ctx.lineTo(cx - fx * base + px * base, cy - fy * base + py * base);
  ctx.lineTo(cx - fx * base - px * base, cy - fy * base - py * base);
  ctx.closePath();
  ctx.fillStyle = "#0f172a";
  ctx.fill();
}
