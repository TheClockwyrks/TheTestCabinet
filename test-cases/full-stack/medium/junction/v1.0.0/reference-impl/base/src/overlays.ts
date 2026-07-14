// Junction — the in-code data overlays (specs/controls.md "Overlays", DESIGN §4, §5.1).
//
// Three analytic tints, cycled with Tab: TRAFFIC (per-link load → gridlock), UTILITY
// (served / unserved), and LAND VALUE (a red→green quality ramp). They are drawn straight
// from the sim's computed tile fields (`load`/`cap`, `powered`/`watered`, `land`) — no new
// state — kept out of `render.ts` for size. The pollution *haze* is the produced particle
// system (particles.ts); this file is only the toggleable analytic tinting of the tiles.
//
// Drawn under the render slice's WORLD transform (tile (col,row) maps to world px
// (col·TILE, row·TILE)), so each cell is filled in world coordinates; `cam` is used only to
// cull to the visible tile rectangle.

import { COL, TILE } from "./constants";
import { hexA } from "./hud";
import type { Camera } from "./camera";
import type { Game } from "./sim";
import type { Overlay } from "./types";
import { idx } from "./grid";

export function drawOverlay(ctx: CanvasRenderingContext2D, game: Game, cam: Camera, overlay: Overlay): void {
  if (overlay === "none") return;
  const w = game.world;
  const { c0, r0, c1, r1 } = cam.visibleTileRange();
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const i = idx(col, row);
      const fill = overlay === "traffic" ? trafficColor(w.load[i]!, w.cap[i]!) : overlay === "utility" ? utilityColor(w, i) : landColor(w.land[i]!, w.zone[i]! !== 0);
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(col * TILE, row * TILE, TILE + 0.6, TILE + 0.6);
    }
  }
}

// Traffic: only carriers (cap>0). Free-flowing links read faint; a corridor ramps
// clear → congest (#ff7a3c) → alert (#ff5a52) as load passes capacity (specs/transit.md).
function trafficColor(load: number, cap: number): string | null {
  if (cap <= 0) return null;
  const r = load / cap;
  if (r < 0.15) return hexA(COL.text3, 0.16); // the link itself, so the network reads
  if (r < 0.9) return hexA(mix(COL.money, COL.congest, r / 0.9), 0.3);
  if (r <= 1.4) return hexA(COL.congest, 0.45 + 0.15 * Math.min(1, (r - 0.9) / 0.5));
  return hexA(COL.alert, 0.62);
}

// Utility: zoned tiles read by service. Fully served green, half-served amber, starved red;
// an empty zoned lot reads faint so its pending service still shows.
function utilityColor(w: Game["world"], i: number): string | null {
  if (w.zone[i]! === 0) return null;
  const p = w.powered[i]! !== 0;
  const wa = w.watered[i]! !== 0;
  const developed = w.tier[i]! > 0;
  if (p && wa) return hexA(COL.money, developed ? 0.24 : 0.12);
  if (p || wa) return hexA(COL.ind, developed ? 0.34 : 0.18);
  return hexA(COL.alert, developed ? 0.4 : 0.2);
}

// Land value: a red(low)→amber(mid)→green(high) ramp; zoned tiles tint stronger.
function landColor(v: number, zoned: boolean): string | null {
  const c = v < 0.5 ? mix(COL.alert, COL.ind, v / 0.5) : mix(COL.ind, COL.money, (v - 0.5) / 0.5);
  return hexA(c, zoned ? 0.4 : 0.28);
}

// Linear-interpolate two "#rrggbb" hexes, returning a "#rrggbb" string.
function mix(a: string, b: string, t: number): string {
  const tt = Math.max(0, Math.min(1, t));
  const ah = a.replace("#", "");
  const bh = b.replace("#", "");
  const ch = (o: number): string => {
    const av = parseInt(ah.slice(o, o + 2), 16);
    const bv = parseInt(bh.slice(o, o + 2), 16);
    return Math.round(av + (bv - av) * tt)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}
