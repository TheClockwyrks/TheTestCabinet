// Wick — a pixel raster and the bridge to `draw` / `draw-sheet`.
//
// Every sprite is composed here, pixel by pixel, from shapes and bitmaps on a
// transparent straight-alpha grid, then handed to the drawing tool as the
// runs of `fill-rect` operations that reproduce it. The tool records those
// operations and renders the PNG the game ships, so the committed file is the
// tool's own render of its own action log; this module only decides which
// pixels to ask for. Sheets add layers the tool places and keyframes it
// resolves, so a spinning or flapping part is painted once and moved by it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** A color: `[r, g, b, a]`, each `0..255`. */
export function rgba(hex, alpha = 255) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const a = value.length === 8 ? parseInt(value.slice(6, 8), 16) : alpha;
  return [r, g, b, a];
}

const TRANSPARENT = [0, 0, 0, 0];

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

  /** Composite `color` at `(x, y)` wrapped to the grid, for a seamless tile. */
  setWrapped(x, y, color) {
    const wx = ((x % this.width) + this.width) % this.width;
    const wy = ((y % this.height) + this.height) % this.height;
    this.set(wx, wy, color);
  }

  rect(x, y, w, h, color) {
    for (let j = y; j < y + h; j += 1) {
      for (let i = x; i < x + w; i += 1) this.set(i, j, color);
    }
  }

  /** A rectangle drawn wrapped, for the ground tile. */
  rectWrapped(x, y, w, h, color) {
    for (let j = y; j < y + h; j += 1) {
      for (let i = x; i < x + w; i += 1) this.setWrapped(i, j, color);
    }
  }

  /** Every pixel whose center is within `r` of `(cx, cy)`. */
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

  /** The band between radii `inner` and `outer` about `(cx, cy)`. */
  ring(cx, cy, outer, inner, color) {
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
        if (d <= o2 && d >= i2) this.set(x, y, color);
      }
    }
  }

  /** A line of `width` from `(x0, y0)` to `(x1, y1)`, round-capped. */
  line(x0, y0, x1, y1, color, width = 1) {
    const half = width / 2;
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

  /** A polyline of `width` through `points`. */
  polyline(points, color, width = 1) {
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      this.line(x0, y0, x1, y1, color, width);
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
   * Paint `rows` of legend characters with their top-left at `(x, y)`; `.`
   * is transparent and every other character looks up `legend`. Every row
   * is checked to be the same length so a typo fails loudly.
   */
  bitmap(x, y, rows, legend) {
    const width = rows[0].length;
    rows.forEach((row, j) => {
      if (row.length !== width) {
        throw new Error(`bitmap row ${j} is ${row.length} wide, not ${width}`);
      }
      for (let i = 0; i < row.length; i += 1) {
        const ch = row[i];
        if (ch === ".") continue;
        const color = legend[ch];
        if (color === undefined) throw new Error(`no legend for "${ch}"`);
        this.set(x + i, y + j, color);
      }
    });
  }

  /** Copy the columns left of `axis` onto the columns right of it. */
  mirror(axis = this.width / 2) {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < axis; x += 1) {
        const target = 2 * axis - 1 - x;
        if (target < this.width) this.put(target, y, this.get(x, y));
      }
    }
  }

  /** Copy the rows above `axis` onto the rows below it. */
  mirrorVertical(axis = this.height / 2) {
    for (let y = 0; y < axis; y += 1) {
      const target = 2 * axis - 1 - y;
      for (let x = 0; x < this.width; x += 1) {
        if (target < this.height) this.put(x, target, this.get(x, y));
      }
    }
  }

  /** A one-pixel rim in `color` around everything painted so far. */
  rim(color) {
    const painted = (x, y) => this.get(x, y)[3] > 0;
    const edge = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (painted(x, y)) continue;
        if (
          painted(x - 1, y) ||
          painted(x + 1, y) ||
          painted(x, y - 1) ||
          painted(x, y + 1)
        ) {
          edge.push([x, y]);
        }
      }
    }
    for (const [x, y] of edge) this.put(x, y, color);
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

  /** Multiply every pixel's alpha by `factor`. */
  fade(factor) {
    this.px = this.px.map((c) =>
      c[3] > 0 ? [c[0], c[1], c[2], Math.round(c[3] * factor)] : c,
    );
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
 * `build` receives a sheet whose `frame(i, raster)` paints a frame,
 * `layer(name, raster, place)` registers and paints a layer, and
 * `key(name, property, frame, value, interp)` keys a layer's transform.
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
      // Every number is passed as `--flag=value`, since a bare negative
      // value would be read as another flag.
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
