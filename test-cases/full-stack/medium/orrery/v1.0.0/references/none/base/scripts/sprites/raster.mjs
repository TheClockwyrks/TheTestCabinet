// Orrery — a pixel raster and the bridge to `draw` / `draw-sheet`.
//
// Every sprite is composed here, pixel by pixel, on a transparent
// straight-alpha grid, and then handed to the drawing tool as the runs of
// `fill-rect` operations that reproduce it. The tool records those operations
// and renders the PNG the game ships, so the committed file is the tool's own
// render of its own action log; this module only decides which pixels to ask
// for. Sheets add layers the tool places and keyframes it resolves, so a
// turning aperture is painted once and spun by the tool.
//
// Orrery is drawn on hexes and rings, so the primitives here are the ones a
// brass instrument wants: discs, annuli, annular sectors, regular polygons,
// round-capped strokes, and a radial clip that holds a mote's paint inside
// MOTE_R.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TRANSPARENT = [0, 0, 0, 0];

/** A color from `#rrggbb` or `#rrggbbaa`, as `[r, g, b, a]` each `0..255`. */
export function rgba(hex, alpha = 255) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const a = value.length === 8 ? parseInt(value.slice(6, 8), 16) : alpha;
  return [r, g, b, a];
}

/** `color` at `factor` of its opacity, for a glow or a shadow. */
export function faded(color, factor) {
  return [color[0], color[1], color[2], Math.round(color[3] * factor)];
}

/** `color` mixed `t` of the way toward `other`. */
export function mixed(color, other, t) {
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return [
    lerp(color[0], other[0]),
    lerp(color[1], other[1]),
    lerp(color[2], other[2]),
    lerp(color[3], other[3]),
  ];
}

function toHex(color) {
  const [r, g, b, a] = color;
  const part = (n) => Math.round(n).toString(16).padStart(2, "0");
  return a >= 255
    ? `#${part(r)}${part(g)}${part(b)}`
    : `#${part(r)}${part(g)}${part(b)}${part(a)}`;
}

/** Source-over compositing of `src` onto `dst`, both straight alpha. */
function over(dst, src) {
  const sa = src[3] / 255;
  if (sa <= 0) return dst;
  if (sa >= 1) return [src[0], src[1], src[2], 255];
  const da = dst[3] / 255;
  const a = sa + da * (1 - sa);
  if (a <= 0) return TRANSPARENT;
  const mix = (s, d) => (s * sa + d * da * (1 - sa)) / a;
  return [
    mix(src[0], dst[0]),
    mix(src[1], dst[1]),
    mix(src[2], dst[2]),
    a * 255,
  ];
}

/** Degrees to radians, with `0` pointing east and angles turning clockwise. */
export function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

/** The point `distance` from `(cx, cy)` at stage bearing `degrees`. */
export function polar(cx, cy, distance, degrees) {
  return [
    cx + distance * Math.cos(rad(degrees)),
    cy + distance * Math.sin(rad(degrees)),
  ];
}

/** The vertices of a regular `sides`-gon of radius `r`, first at `rotation`. */
export function regular(cx, cy, r, sides, rotation = -90) {
  return Array.from({ length: sides }, (_, i) =>
    polar(cx, cy, r, rotation + (360 * i) / sides),
  );
}

/** A `width x height` grid of straight-alpha colors, transparent to start. */
export class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.px = new Array(width * height).fill(TRANSPARENT);
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return TRANSPARENT;
    }
    return this.px[y * this.width + x];
  }

  /** Composite `color` onto the pixel at `(x, y)`. */
  set(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    this.px[i] = over(this.px[i], color);
  }

  /** Replace the pixel at `(x, y)`, with no compositing. */
  put(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = color;
  }

  rect(x, y, w, h, color) {
    const left = Math.round(x);
    const top = Math.round(y);
    for (let j = top; j < top + Math.round(h); j += 1) {
      for (let i = left; i < left + Math.round(w); i += 1) {
        this.set(i, j, color);
      }
    }
  }

  /**
   * The band just inside the ellipse `(rx, ry)` about `(cx, cy)`, `thickness`
   * pixels deep measured on the normalized radius. What a planet's ring is.
   */
  ellipseRing(cx, cy, rx, ry, thickness, color) {
    const inner = 1 - thickness;
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 1 && d >= inner) this.set(x, y, color);
      }
    }
  }

  /** Every pixel whose center falls within `r` of `(cx, cy)`. */
  disc(cx, cy, r, color) {
    this.ellipse(cx, cy, r, r, color);
  }

  ellipse(cx, cy, rx, ry, color) {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, color);
      }
    }
  }

  /**
   * The annular sector between radii `inner` and `outer` spanning the bearings
   * `from` to `to`, turning clockwise from `from`. The workhorse for a blade,
   * an open jaw, and every arrow's arc.
   */
  sector(cx, cy, outer, inner, from, to, color) {
    const width =
      to - from >= 360 ? 360 : (((to - from) % 360) + 360) % 360 || 360;
    const x0 = Math.max(0, Math.floor(cx - outer - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + outer + 1));
    const y0 = Math.max(0, Math.floor(cy - outer - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + outer + 1));
    const o2 = outer * outer;
    const i2 = inner * inner;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = dx * dx + dy * dy;
        if (d > o2 || d < i2) continue;
        if (width < 360) {
          const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
          const offset = (((bearing - from) % 360) + 360) % 360;
          if (offset > width) continue;
        }
        this.set(x, y, color);
      }
    }
  }

  /** A stroke of `weight` from `(x0, y0)` to `(x1, y1)`, round-capped. */
  line(x0, y0, x1, y1, color, weight = 1) {
    const half = weight / 2;
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - half - 1));
    const bx1 = Math.min(
      this.width - 1,
      Math.ceil(Math.max(x0, x1) + half + 1),
    );
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - half - 1));
    const by1 = Math.min(
      this.height - 1,
      Math.ceil(Math.max(y0, y1) + half + 1),
    );
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let y = by0; y <= by1; y += 1) {
      for (let x = bx0; x <= bx1; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const ex = px - (x0 + t * dx);
        const ey = py - (y0 + t * dy);
        if (ex * ex + ey * ey <= half * half) this.set(x, y, color);
      }
    }
  }

  /** A stroke of `weight` through `points`, and closed when `close` is set. */
  polyline(points, color, weight = 1, close = false) {
    const path_ = close ? [...points, points[0]] : points;
    for (let i = 1; i < path_.length; i += 1) {
      const [x0, y0] = path_[i - 1];
      const [x1, y1] = path_[i];
      this.line(x0, y0, x1, y1, color, weight);
    }
  }

  /** A filled polygon, even-odd, sampled at pixel centers. */
  poly(points, color) {
    const ys = points.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y += 1) {
      const sy = y + 0.5;
      const crossings = [];
      for (let i = 0; i < points.length; i += 1) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if (ay === by) continue;
        if (sy < Math.min(ay, by) || sy >= Math.max(ay, by)) continue;
        crossings.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const xa = Math.max(0, Math.ceil(crossings[i] - 0.5));
        const xb = Math.min(this.width - 1, Math.floor(crossings[i + 1] - 0.5));
        for (let x = xa; x <= xb; x += 1) this.set(x, y, color);
      }
    }
  }

  /**
   * A solid arrowhead of `length` and `spread` whose tip is at `(x, y)`,
   * pointing along the bearing `degrees`.
   */
  arrowhead(x, y, degrees, length, spread, color) {
    this.poly(
      [
        [x, y],
        polar(x, y, length, degrees + 180 - spread),
        polar(x, y, length * 0.55, degrees + 180),
        polar(x, y, length, degrees + 180 + spread),
      ],
      color,
    );
  }

  /**
   * Drop every pixel whose center lies further than `r` from `(cx, cy)`. The
   * guard that holds a mote's paint inside MOTE_R however a form was built.
   */
  clipCircle(cx, cy, r) {
    const r2 = r * r;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) this.put(x, y, TRANSPARENT);
      }
    }
  }

  /** Composite another raster onto this one at `(x, y)`. */
  blit(other, x, y) {
    for (let j = 0; j < other.height; j += 1) {
      for (let i = 0; i < other.width; i += 1) {
        const c = other.get(i, j);
        if (c[3] > 0) this.set(x + i, y + j, c);
      }
    }
  }

  /** How many pixels carry any paint at all. */
  get painted() {
    return this.px.reduce((n, c) => n + (c[3] > 0 ? 1 : 0), 0);
  }

  /** The painted pixels as rectangles of one color, row runs merged down. */
  rects() {
    const out = [];
    let open = [];
    for (let y = 0; y < this.height; y += 1) {
      const runs = [];
      let x = 0;
      while (x < this.width) {
        const c = this.get(x, y);
        if (c[3] <= 0) {
          x += 1;
          continue;
        }
        const key = toHex(c);
        let w = 1;
        while (x + w < this.width && toHex(this.get(x + w, y)) === key) w += 1;
        runs.push({ x, y, w, h: 1, color: key });
        x += w;
      }
      const next = [];
      for (const run of runs) {
        const prev = open.find(
          (r) => r.x === run.x && r.w === run.w && r.color === run.color,
        );
        if (prev) {
          prev.h += 1;
          next.push(prev);
          open = open.filter((r) => r !== prev);
        } else {
          next.push(run);
        }
      }
      out.push(...open);
      open = next;
    }
    out.push(...open);
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out;
  }
}

/** Find `name` on the `PATH`, else under the cargo target directory. */
export function resolveTool(name) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  const target =
    process.env.CARGO_TARGET_DIR ?? "/cargo-target/the-test-cabinet";
  dirs.push(path.join(target, "release"), path.join(target, "debug"));
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (dir && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${name} is not on the PATH or under ${target}`);
}

/** One tool run against one config, counting the operations sent. */
class ToolRun {
  constructor(binary, config) {
    this.binary = binary;
    this.config = config;
    this.operations = 0;
  }

  op(args) {
    execFileSync(this.binary, [...args, "--config", this.config], {
      stdio: "ignore",
    });
    this.operations += 1;
  }

  /** Send the raster's rectangles, into a frame or a layer when named. */
  paint(raster, extra = []) {
    for (const r of raster.rects()) {
      this.op([
        "fill-rect",
        ...extra,
        `--x=${r.x}`,
        `--y=${r.y}`,
        `--width=${r.w}`,
        `--height=${r.h}`,
        `--color=${r.color}`,
      ]);
    }
  }
}

/** Produce one sprite at `out` from `raster` with `draw`. */
export function drawSprite(tools, out, raster) {
  if (raster.painted === 0) throw new Error(`${out} would be an empty canvas`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const config = path.join(tools.scratch, "draw.config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      width: raster.width,
      height: raster.height,
      background: "transparent",
      actions: path.join(tools.scratch, "draw.actions.json"),
      preview: out,
      layers: path.join(tools.scratch, "draw.layers.json"),
    }),
  );
  const run = new ToolRun(tools.draw, config);
  run.op(["init"]);
  run.paint(raster);
  tools.count(run.operations, 1);
}

/**
 * Produce a sheet of `frames` files `outDir/<frame>.png` with `draw-sheet`.
 * `build` receives a sheet whose `layer(name, raster, place)` registers and
 * paints a sheet-wide layer and whose `key(name, property, frame, value)`
 * keys that layer's transform, so a turning part is painted once and spun by
 * the tool across the frames.
 */
export function drawSheet(tools, outDir, width, height, frames, build) {
  fs.mkdirSync(outDir, { recursive: true });
  const config = path.join(tools.scratch, "sheet.config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      width,
      height,
      background: "transparent",
      frames: Array.from({ length: frames }, (_, i) => i),
      actions: path.join(tools.scratch, "sheet-{frame}.actions.json"),
      preview: path.join(outDir, "{frame}.png"),
      layers: path.join(tools.scratch, "sheet.layers.json"),
    }),
  );
  const run = new ToolRun(tools.drawSheet, config);
  run.op(["init"]);
  const sheet = {
    frame(i, raster) {
      run.paint(raster, [`--frame=${i}`]);
    },
    layer(name, raster, place = {}) {
      // Every number is passed as `--flag=value`, since a bare negative value
      // would be read as another flag.
      const args = [
        "register-layer",
        `--name=${name}`,
        `--x=${place.x ?? 0}`,
        `--y=${place.y ?? 0}`,
        `--width=${raster.width}`,
        `--height=${raster.height}`,
        `--z=${place.z ?? 0}`,
      ];
      if (place.opacity !== undefined) args.push(`--opacity=${place.opacity}`);
      if (place.rotation !== undefined) {
        args.push(`--rotation=${place.rotation}`);
      }
      run.op(args);
      run.paint(raster, [`--layer=${name}`]);
    },
    key(name, property, frame, value, interp = "linear") {
      run.op([
        "animate-layer",
        `--layer=${name}`,
        `--property=${property}`,
        `--frame=${frame}`,
        `--value=${value}`,
        `--interp=${interp}`,
      ]);
    },
  };
  build(sheet);
  tools.count(run.operations, frames);
}

/** The two drawing tools and a scratch directory for their logs. */
export function openTools(scratch) {
  const tools = {
    draw: resolveTool("draw"),
    drawSheet: resolveTool("draw-sheet"),
    scratch,
    operations: 0,
    files: 0,
    count(ops, files) {
      tools.operations += ops;
      tools.files += files;
    },
  };
  return tools;
}
