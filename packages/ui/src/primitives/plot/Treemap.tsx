// A squarified treemap: a set of tiles whose AREA encodes one magnitude. A list tells
// you what the parts are; a treemap tells you where the total actually went — the one
// part that quietly holds half of it is a rectangle you cannot miss and a row you can
// easily scroll past.
//
// Generic because two surfaces need the same picture of the same shape: gg's memory
// store (area = characters of body) and a run's produced tree (area = code lines). The
// encoding, the layout and the honesty rules are identical; only the vocabulary differs,
// so the vocabulary is what the caller supplies.
//
// Size is a magnitude, so the fill is a SEQUENTIAL ramp: one hue (the theme accent),
// stepped light-to-dark by the tile's share of the total. The two extra facts a caller
// may need to carry are deliberately *not* more hues, because they are states rather
// than series: `muted` renders neutral and dashed, and `outlined` takes a distinct solid
// edge. The legend names every state that occurs, so identity is never color alone.
//
// The layout is the standard squarified treemap (Bruls/Huizing/van Wijk): tiles are
// packed in rows along the shorter side of the free rectangle, growing each row while
// its worst aspect ratio keeps improving, so tiles come out close to square and
// comparing two areas is a fair comparison rather than a comparison of slivers.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Treemap.module.scss";

/** One tile to place. `value` is what the area encodes; everything else is how it is
 * described. */
export interface TreemapTile {
  /** Stable identity: the React key, and the key the hover readout selects on. Must be
   * unique within one map. */
  key: string;
  /** The label drawn inside the tile, when the tile is large enough to hold it. */
  label: string;
  /** The magnitude the tile's area encodes. Non-positive tiles are dropped — they have
   * no area to show and would otherwise be invisible hit targets. */
  value: number;
  /** A second line drawn under the label (typically the formatted `value`). */
  detail?: string;
  /** The tile's full description, used for its native tooltip. Falls back to the label. */
  description?: string;
  /**
   * Render this tile neutral and dashed instead of on the magnitude ramp — for a tile
   * that is in a different *state*, not a different series (a deleted memory, a file the
   * analyzer counted but never parsed).
   */
  muted?: boolean;
  /**
   * Give this tile a distinct solid edge — a second, orthogonal fact about it that must
   * not compete with the magnitude its fill encodes (a memory written by another holder,
   * a tile that can be opened).
   */
  outlined?: boolean;
}

/** A placed tile: the input, its rectangle in the map's coordinate space, and its share
 * of the total — which is both what picks its step on the ramp and what a readout wants
 * to quote. */
export interface PlacedTreemapTile extends TreemapTile {
  x: number;
  y: number;
  w: number;
  h: number;
  share: number;
}

/** Which state a legend key describes. Rendered only when at least one tile is actually
 * in that state, so a map with no muted tiles carries no "deleted" key to puzzle over. */
export type TreemapLegendKind = "ramp" | "muted" | "outlined";

/** One legend key: the state, and what this surface calls it. */
export interface TreemapLegendKey {
  kind: TreemapLegendKind;
  label: string;
}

interface TreemapProps {
  tiles: readonly TreemapTile[];
  /** What the map shows, for a screen reader (e.g. "Memory sizes, by characters of
   * body"). */
  ariaLabel: string;
  /** The units line pushed to the right of the legend, e.g. `area = code lines`. Naming
   * the encoding is what stops a treemap being read as a layout. */
  hint: string;
  /** Legend keys, in draw order. */
  legend?: readonly TreemapLegendKey[];
  /** The caption drawn while a tile is hovered, in place of the legend. Omit to keep the
   * legend visible at all times. */
  readout?: (tile: PlacedTreemapTile) => ReactNode;
  /**
   * Called when a tile is clicked or activated from the keyboard. Supplying it makes
   * every tile a focusable button — so a drillable map is reachable without a mouse.
   */
  onActivate?: (tile: TreemapTile) => void;
  /** CSS color for an `outlined` tile's edge. Defaults to the theme's second accent. */
  outlineColor?: string;
}

// The map's coordinate space. Fixed rather than measured: the layout is computed here
// and the SVG scales uniformly to its container, which is what keeps area proportional
// to value at every width.
const MAP_W = 320;
const MAP_H = 180;

/** The surface gap between neighbouring fills, in rendered pixels. */
const GAP_PX = 2;
/** The tile corner radius, in rendered pixels. */
const RADIUS_PX = 3;

// The sequential ramp, as percentages of accent mixed into the panel surface. Capped
// well short of full accent so the label ink keeps its contrast on the darkest tile —
// a ramp that runs to 100% would win the gradient and lose the labels.
const RAMP_MAX = 70;
const RAMP_MIN = 28;

// Everything about the labels — like the gap and the radius above — is in RENDERED
// PIXELS, not in map units.
//
// The map's coordinate space is fixed and the SVG scales to its container, so a text
// size written in user units is multiplied by whatever that container happens to be
// wide: the same tile label comes out at 10px in a narrow column and at 36px across a
// full-width panel. Area is the encoding and must scale; the labels, the gaps and the
// corners are chrome and must not. So the rendered width is measured, and every one of
// those dimensions is divided back out of the scale before it is drawn.
const LABEL_PX = 11;
const SUBLABEL_PX = 10;
/** The label block's inset from the tile's leading edge. */
const LABEL_INSET_PX = 7;
const LABEL_BASELINE_PX = 14;
const SUBLABEL_BASELINE_PX = 26;
/** The smallest tile that can hold the label block without crowding it. */
const MIN_LABEL_W_PX = 54;
const MIN_LABEL_H_PX = 20;
/** Below this, the tile is labelled but has no room for the second line. */
const MIN_DETAIL_H_PX = 32;
/** Mean glyph advance as a fraction of the font size, for the monospace-ish stack the
 * themes ship. Only used to decide where a label stops fitting. */
const GLYPH_RATIO = 0.62;

/**
 * The label as it fits in `widthPx`, ellipsized when it doesn't.
 *
 * A name that runs past its own tile lands on the neighbour's fill and reads as that
 * tile's label, which is worse than a shortened one — and the full name is never lost:
 * the tooltip and the hover readout carry it whatever the rectangle could draw.
 */
function fitLabel(label: string, widthPx: number, sizePx: number): string {
  const room = Math.floor(widthPx / (sizePx * GLYPH_RATIO));
  if (room >= label.length) return label;
  if (room < 2) return "";
  return `${label.slice(0, room - 1)}…`;
}

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

/**
 * Place `tiles` (any order, any of them zero-valued) into the map.
 *
 * Exported for the callers that need to know what the map will show before it is drawn —
 * a "the rest" tile has to be summed from the tiles a cap left out, which means knowing
 * which ones survived.
 */
export function placeTreemapTiles(
  tiles: readonly TreemapTile[],
): PlacedTreemapTile[] {
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

// The fill for one tile: a step on the accent ramp, or a neutral for a muted one.
// `rank` is the tile's position in size order, so the ramp steps by magnitude rather
// than by an arbitrary index.
function fillFor(tile: PlacedTreemapTile, rank: number, count: number): string {
  if (tile.muted) {
    return "color-mix(in srgb, var(--tcab-muted) 22%, var(--tcab-surface))";
  }
  const t = count <= 1 ? 0 : rank / (count - 1);
  const pct = Math.round(RAMP_MAX - t * (RAMP_MAX - RAMP_MIN));
  return `color-mix(in srgb, var(--tcab-accent) ${pct}%, var(--tcab-surface))`;
}

// Whether a legend key's state occurs among the placed tiles. A key for a state nothing
// is in is worse than no key: it invites the reader to hunt for a tile that is not there.
function occurs(kind: TreemapLegendKind, tiles: PlacedTreemapTile[]): boolean {
  switch (kind) {
    case "ramp":
      return tiles.some((t) => !t.muted);
    case "muted":
      return tiles.some((t) => t.muted);
    case "outlined":
      return tiles.some((t) => t.outlined);
  }
}

export function Treemap({
  tiles,
  ariaLabel,
  hint,
  legend = [],
  readout,
  onActivate,
  outlineColor,
}: TreemapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  // How wide the map is actually drawn, so the labels can be sized in pixels rather
  // than in map units (see LABEL_PX). Measured in a layout effect so the first painted
  // frame is already at the right size — an effect that ran after paint would show one
  // frame of giant text on every mount.
  const frameRef = useRef<HTMLElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const placed = placeTreemapTiles(tiles);
  // A map with nothing to place renders nothing at all, so there is no frame to observe
  // until it has tiles — which is why the effect re-runs when that changes rather than
  // only on mount.
  const drawn = placed.length > 0;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setRenderedWidth(frame.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [drawn]);

  if (!drawn) return null;

  // Rendered pixels per map unit, and its inverse — what a pixel measurement has to be
  // written as to come out that size on screen. An unmeasured map (the first frame, a
  // test environment that reports no layout) falls back to 1:1, which is the map's own
  // coordinate space and so is never absurd in either direction.
  const scale = renderedWidth > 0 ? renderedWidth / MAP_W : 1;
  const units = (px: number) => px / scale;

  const active = placed.find((t) => t.key === hovered) ?? null;
  const keys = legend.filter((key) => occurs(key.kind, placed));

  return (
    <figure className={styles.treemap} ref={frameRef}>
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className={styles.treemapSvg}
        role="img"
        aria-label={ariaLabel}
        style={
          outlineColor
            ? ({ "--treemap-outline": outlineColor } as React.CSSProperties)
            : undefined
        }
      >
        {placed.map((tile, i) => {
          // The surface gap between fills, taken out of each tile's own box so
          // neighbours never touch. A tile too small to give up the gap keeps its
          // full box rather than inverting.
          const gap = units(GAP_PX);
          const w = Math.max(tile.w - gap, Math.min(tile.w, 1));
          const h = Math.max(tile.h - gap, Math.min(tile.h, 1));
          // Only label a tile the text actually fits in, judged at the size the text is
          // really drawn — the readout and the tooltip carry every tile's name whether or
          // not the rectangle could hold it. The second line is a separate question: a
          // tile can have room for a name and none for a figure under it.
          const labelled =
            w * scale > MIN_LABEL_W_PX && h * scale > MIN_LABEL_H_PX;
          const detailed = labelled && h * scale > MIN_DETAIL_H_PX;
          const textRoomPx = w * scale - LABEL_INSET_PX * 2;
          const activate = onActivate ? () => onActivate(tile) : undefined;
          return (
            <g
              key={tile.key}
              onMouseEnter={() => setHovered(tile.key)}
              onMouseLeave={() =>
                setHovered((n) => (n === tile.key ? null : n))
              }
              // A drillable map must be operable from the keyboard, so an activatable
              // tile is a real button with a real focus stop rather than a click handler
              // on a rectangle.
              {...(activate
                ? {
                    role: "button" as const,
                    tabIndex: 0,
                    onClick: activate,
                    onFocus: () => setHovered(tile.key),
                    onBlur: () =>
                      setHovered((n) => (n === tile.key ? null : n)),
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activate();
                      }
                    },
                    "aria-label": tile.description ?? tile.label,
                  }
                : {})}
            >
              <rect
                x={tile.x}
                y={tile.y}
                width={w}
                height={h}
                rx={units(RADIUS_PX)}
                fill={fillFor(tile, i, placed.length)}
                // The edge is drawn in screen space, so a stroke width the stylesheet
                // states in pixels arrives as that many pixels however far the map was
                // scaled up to fill its panel.
                vectorEffect="non-scaling-stroke"
                className={styles.treemapTile}
                data-muted={tile.muted ? "" : undefined}
                data-outlined={tile.outlined ? "" : undefined}
                data-active={active?.key === tile.key ? "" : undefined}
                data-interactive={activate ? "" : undefined}
              />
              <title>{tile.description ?? tile.label}</title>
              {labelled && (
                <>
                  <text
                    x={tile.x + units(LABEL_INSET_PX)}
                    y={tile.y + units(LABEL_BASELINE_PX)}
                    fontSize={units(LABEL_PX)}
                    className={styles.treemapLabel}
                    data-muted={tile.muted ? "" : undefined}
                  >
                    {fitLabel(tile.label, textRoomPx, LABEL_PX)}
                  </text>
                  {detailed && tile.detail && (
                    <text
                      x={tile.x + units(LABEL_INSET_PX)}
                      y={tile.y + units(SUBLABEL_BASELINE_PX)}
                      fontSize={units(SUBLABEL_PX)}
                      className={styles.treemapSubLabel}
                    >
                      {fitLabel(tile.detail, textRoomPx, SUBLABEL_PX)}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className={styles.treemapCaption}>
        {active && readout ? (
          <span className={styles.treemapReadout}>{readout(active)}</span>
        ) : (
          <span className={styles.treemapLegend}>
            {keys.map((key) => (
              <span
                key={`${key.kind}:${key.label}`}
                className={styles.treemapKey}
                data-kind={key.kind}
              >
                {key.label}
              </span>
            ))}
            <span className={styles.treemapHint}>{hint}</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
