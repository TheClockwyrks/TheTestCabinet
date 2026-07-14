// Junction — the camera onto the tile map (specs/map.md "The camera", specs/controls.md,
// DESIGN §4).
//
// The map (MAP_W × MAP_H world px) is larger than the city view band, so the view is a
// camera onto it: a world-px focus point (`cx`,`cy`) and a `zoom` (on-screen px per tile).
// The camera pans and zooms and is CLAMPED to the map bounds — it never scrolls past an
// edge; at an edge the map border sits flush against the view edge. All transforms are
// restricted to the city view band `y ∈ [VIEW_Y0, VIEW_Y1]`, full width; the two HUD strips
// are never covered by the map. This module owns no DOM — it is pure state + math, so the
// headless harness can `centerOn` a tile just like the browser.

import { MAP_H, MAP_W, STAGE_W, TILE, VIEW_Y0, VIEW_Y1, ZOOM_DEF, ZOOM_MAX, ZOOM_MIN } from "./constants";

export interface ScreenPt {
  x: number;
  y: number;
}

// A tile hit from a screen point — plus whether the point fell inside the city view band
// (the HUD strips return `inView:false` so clicks there are not treated as board clicks).
export interface TileHit {
  col: number;
  row: number;
  inView: boolean;
}

const VIEW_H = VIEW_Y1 - VIEW_Y0; // city-view band height (screen px)
const VIEW_CY = (VIEW_Y0 + VIEW_Y1) / 2;

export class Camera {
  cx = MAP_W / 2; // world-px point shown at the view centre
  cy = MAP_H / 2;
  zoom = ZOOM_DEF; // on-screen px per tile

  // Screen px per world px. Tiles are TILE world px wide, drawn `zoom` px on screen.
  get scale(): number {
    return this.zoom / TILE;
  }

  worldToScreen(wx: number, wy: number): ScreenPt {
    const s = this.scale;
    return { x: STAGE_W / 2 + (wx - this.cx) * s, y: VIEW_CY + (wy - this.cy) * s };
  }

  screenToWorld(sx: number, sy: number): ScreenPt {
    const s = this.scale;
    return { x: this.cx + (sx - STAGE_W / 2) / s, y: this.cy + (sy - VIEW_CY) / s };
  }

  // The tile under a screen point. `inView` is false in the HUD strips.
  screenToTile(sx: number, sy: number): TileHit {
    const w = this.screenToWorld(sx, sy);
    return {
      col: Math.floor(w.x / TILE),
      row: Math.floor(w.y / TILE),
      inView: sy >= VIEW_Y0 && sy <= VIEW_Y1,
    };
  }

  tileCenterToScreen(col: number, row: number): ScreenPt {
    return this.worldToScreen((col + 0.5) * TILE, (row + 0.5) * TILE);
  }

  // Pan by a world-px delta, then re-clamp to the map bounds.
  panBy(dx: number, dy: number): void {
    this.cx += dx;
    this.cy += dy;
    this.clamp();
  }

  // Centre the view on a tile (used on load and by the harness `centerOn`), clamped.
  centerOnTile(col: number, row: number): void {
    this.cx = (col + 0.5) * TILE;
    this.cy = (row + 0.5) * TILE;
    this.clamp();
  }

  setZoom(z: number): void {
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    this.clamp();
  }

  // Zoom by a wheel step while keeping the world point under (sx,sy) fixed on screen.
  zoomAt(step: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom + step));
    const after = this.screenToWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clamp();
  }

  // Keep the visible region inside the map: if the map is wider/taller than the view, clamp
  // the focus so the border never pulls inside the view; otherwise centre that axis.
  clamp(): void {
    const s = this.scale;
    const halfW = STAGE_W / 2 / s; // world px half-width visible
    const halfH = VIEW_H / 2 / s;
    this.cx = MAP_W <= 2 * halfW ? MAP_W / 2 : Math.max(halfW, Math.min(MAP_W - halfW, this.cx));
    this.cy = MAP_H <= 2 * halfH ? MAP_H / 2 : Math.max(halfH, Math.min(MAP_H - halfH, this.cy));
  }

  // The inclusive tile rectangle currently visible, for the renderer's culled draw.
  visibleTileRange(): { c0: number; r0: number; c1: number; r1: number } {
    const tl = this.screenToWorld(0, VIEW_Y0);
    const br = this.screenToWorld(STAGE_W, VIEW_Y1);
    return {
      c0: Math.max(0, Math.floor(tl.x / TILE)),
      r0: Math.max(0, Math.floor(tl.y / TILE)),
      c1: Math.min(MAP_W / TILE - 1, Math.ceil(br.x / TILE)),
      r1: Math.min(MAP_H / TILE - 1, Math.ceil(br.y / TILE)),
    };
  }
}
