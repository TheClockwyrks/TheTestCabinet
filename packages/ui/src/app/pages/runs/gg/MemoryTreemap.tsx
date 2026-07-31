// The memory treemap: every memory the agent ever held, as a tile whose AREA is the
// memory's body length in characters. A list of memories tells you what they are;
// this tells you where the budget actually went — one note that quietly grew to half
// the store is a rectangle you cannot miss and a row you can easily scroll past.
//
// Size is a magnitude, so the fill is a SEQUENTIAL ramp: one hue (the accent),
// stepped light-to-dark by the tile's share of the total. Deleted memories are a
// state rather than another series, so they are neutral and dashed instead of another
// hue, and a memory written by another holder of the same instance takes a distinct
// edge for the same reason. The legend names all three — identity is never carried by
// color alone.
//
// The layout is the standard squarified treemap (Bruls/Huizing/van Wijk): tiles are
// packed in rows along the shorter side of the free rectangle, growing each row while
// its worst aspect ratio keeps improving, so tiles come out close to square and
// comparing two areas is a fair comparison rather than a comparison of slivers.

import { useState } from "react";
import styles from "./GgPanels.module.scss";

// One memory to place. `value` is what the area encodes (its body length in
// characters); `live` distinguishes a memory still held from one since deleted, and
// `byAnother` a memory this agent holds on a shared instance but did not write (see
// gg/memories) — which is a fact about authorship rather than about size, so it is
// carried by the tile's edge and never by its area.
export interface MemoryTile {
  name: string;
  value: number;
  lines: number;
  live: boolean;
  byAnother?: boolean;
}

// A placed tile: the input plus its rectangle in the map's coordinate space, and its
// share of the total (which picks its step on the sequential ramp).
interface PlacedTile extends MemoryTile {
  x: number;
  y: number;
  w: number;
  h: number;
  share: number;
}

// The map's coordinate space. Fixed rather than measured: the SVG scales uniformly to
// its container, so a gap of 2 units here stays the ~2px surface gap the mark specs
// ask for at the width this panel is actually rendered at.
const MAP_W = 320;
const MAP_H = 180;
const GAP = 2;

// The sequential ramp, as percentages of accent mixed into the panel surface. Capped
// well short of full accent so the label ink keeps its contrast on the darkest tile —
// a ramp that runs to 100% would win the gradient and lose the labels.
const RAMP_MAX = 70;
const RAMP_MIN = 28;

const numberFmt = new Intl.NumberFormat("en-US");

// The worst (largest) aspect ratio in a row of areas laid along a side of length
// `side` — the quantity squarified minimizes. `areas` is never empty here.
function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  if (sum <= 0 || side <= 0) return Infinity;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = sum * sum;
  const w2 = side * side;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

// A rectangle in the map's coordinate space.
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Squarify `values` into `MAP_W × MAP_H`, returning one rectangle per value in the
// order given. Values must be positive and sorted descending by the caller — the
// algorithm's squareness guarantee depends on the ordering.
//
// Rows are emitted front to back, so the output is built by appending and is always
// in step with the input.
function squarify(values: number[]): Rect[] {
  const out: Rect[] = [];
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));

  // Work in area units: scale the values so their sum fills the map exactly.
  const scale = (MAP_W * MAP_H) / total;
  const areas = values.map((v) => v * scale);

  let free: Rect = { x: 0, y: 0, w: MAP_W, h: MAP_H };
  let start = 0;
  while (start < areas.length) {
    const side = Math.min(free.w, free.h);
    if (side <= 0) break;

    // Grow the row while the worst aspect ratio keeps improving.
    let end = start + 1;
    let best = worstRatio(areas.slice(start, end), side);
    while (end < areas.length) {
      const next = worstRatio(areas.slice(start, end + 1), side);
      if (next > best) break;
      best = next;
      end++;
    }

    const row = areas.slice(start, end);
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (free.w <= free.h) {
      // The short side is the width: lay the row across the top as a band.
      const bandH = rowSum / free.w;
      let x = free.x;
      for (const area of row) {
        const w = area / bandH;
        out.push({ x, y: free.y, w, h: bandH });
        x += w;
      }
      free = { x: free.x, y: free.y + bandH, w: free.w, h: free.h - bandH };
    } else {
      // The short side is the height: lay the row down the left as a column.
      const bandW = rowSum / free.h;
      let y = free.y;
      for (const area of row) {
        const h = area / bandW;
        out.push({ x: free.x, y, w: bandW, h });
        y += h;
      }
      free = { x: free.x + bandW, y: free.y, w: free.w - bandW, h: free.h };
    }
    start = end;
  }
  // A degenerate free rectangle can end the packing early; anything left over gets an
  // empty rectangle rather than being dropped, so the output stays index-aligned.
  while (out.length < values.length) out.push({ x: 0, y: 0, w: 0, h: 0 });
  return out;
}

// Place `tiles` (any order, any of them zero-length) into the map. Zero-length tiles
// have no area to show and are dropped rather than drawn as invisible hit targets.
function place(tiles: MemoryTile[]): PlacedTile[] {
  const usable = tiles.filter((t) => t.value > 0);
  if (usable.length === 0) return [];
  const sorted = [...usable].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, t) => sum + t.value, 0);
  const rects = squarify(sorted.map((t) => t.value));
  return sorted.map((tile, i) => ({
    ...tile,
    ...(rects[i] ?? { x: 0, y: 0, w: 0, h: 0 }),
    share: tile.value / total,
  }));
}

// The fill for one tile: a step on the accent ramp for a live memory, a neutral for a
// deleted one. `rank` is the tile's position in size order, so the ramp steps by
// magnitude rather than by an arbitrary index.
function fillFor(tile: PlacedTile, rank: number, count: number): string {
  if (!tile.live) {
    return "color-mix(in srgb, var(--tcab-muted) 22%, var(--tcab-surface))";
  }
  const t = count <= 1 ? 0 : rank / (count - 1);
  const pct = Math.round(RAMP_MAX - t * (RAMP_MAX - RAMP_MIN));
  return `color-mix(in srgb, var(--tcab-accent) ${pct}%, var(--tcab-surface))`;
}

export function MemoryTreemap({ tiles }: { tiles: MemoryTile[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const placed = place(tiles);
  if (placed.length === 0) return null;

  const active = placed.find((t) => t.name === hovered) ?? null;
  const anyDeleted = placed.some((t) => !t.live);
  const anyForeign = placed.some((t) => t.byAnother);

  return (
    <figure className={styles.treemap}>
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className={styles.treemapSvg}
        role="img"
        aria-label="Memory sizes, by characters of body"
      >
        {placed.map((tile, i) => {
          // The surface gap between fills, taken out of each tile's own box so
          // neighbours never touch. A tile too small to give up the gap keeps its
          // full box rather than inverting.
          const w = Math.max(tile.w - GAP, Math.min(tile.w, 1));
          const h = Math.max(tile.h - GAP, Math.min(tile.h, 1));
          const labelled = w > 52 && h > 26;
          return (
            <g
              key={tile.name}
              onMouseEnter={() => setHovered(tile.name)}
              onMouseLeave={() =>
                setHovered((n) => (n === tile.name ? null : n))
              }
            >
              <rect
                x={tile.x}
                y={tile.y}
                width={w}
                height={h}
                rx={3}
                fill={fillFor(tile, i, placed.length)}
                className={styles.treemapTile}
                data-deleted={tile.live ? undefined : ""}
                data-foreign={tile.byAnother ? "" : undefined}
                data-active={active?.name === tile.name ? "" : undefined}
              />
              <title>
                {`${tile.name} — ${numberFmt.format(tile.value)} characters, ${numberFmt.format(tile.lines)} lines${
                  tile.live ? "" : " (deleted)"
                }${tile.byAnother ? " (written by another holder)" : ""}`}
              </title>
              {labelled && (
                <>
                  <text
                    x={tile.x + 7}
                    y={tile.y + 15}
                    className={styles.treemapLabel}
                    data-deleted={tile.live ? undefined : ""}
                  >
                    {tile.name}
                  </text>
                  <text
                    x={tile.x + 7}
                    y={tile.y + 27}
                    className={styles.treemapSubLabel}
                  >
                    {numberFmt.format(tile.value)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className={styles.treemapCaption}>
        {active ? (
          <span className={styles.treemapReadout}>
            <strong>{active.name}</strong> · {numberFmt.format(active.value)}{" "}
            chars · {numberFmt.format(active.lines)} lines ·{" "}
            {Math.round(active.share * 100)}% of all memory written
            {active.live ? "" : " · deleted"}
            {active.byAnother ? " · another holder" : ""}
          </span>
        ) : (
          <span className={styles.treemapLegend}>
            <span className={styles.treemapKey} data-live="">
              Held
            </span>
            {anyDeleted && (
              <span className={styles.treemapKey} data-deleted="">
                Deleted
              </span>
            )}
            {anyForeign && (
              <span className={styles.treemapKey} data-foreign="">
                Another holder
              </span>
            )}
            <span className={styles.treemapHint}>area = characters</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
