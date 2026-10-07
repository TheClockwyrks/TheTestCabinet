// Orrery — the twelve transforming sigil glyphs (specs/assets.md "The
// sprites").
//
// One 48 x 48 PNG per transforming sigil of `PARTS`, `bind` through `void`,
// drawn upright and centered on the sigil's anchor hex. The bar is that the
// twelve are told apart from one another at 48 units, on the dark sky, with
// the sigil's footprint hexes and their roles drawn in code underneath.
//
// They are ENGRAVINGS, so every glyph shares one treatment: a thin engraved
// ring at the hex's edge with six tick marks on the DIRS bearings, and inside
// it a mark cut in bright brass. What differs between them is the mark, and
// each mark is built out of the sigil's own effect rather than being a symbol
// assigned to it: `bind` is two nodes and one bar, `triune` the same two nodes
// and three, `sunder` the bar broken and struck through, `conjoin` two founts
// climbing into one crown, `dispersion` the arrows of `confluence` reversed
// and its filled core hollowed, and so on.

import { Raster, faded, polar, regular, rgba } from "./raster.mjs";
import {
  BRASS,
  EMBER,
  FAULT,
  GLASS,
  NIGHT,
  STONE,
  VIOLET,
} from "./palette.mjs";

/** The glyph canvas, SIGIL_GLYPH_SIZE. */
export const SIZE = 48;
const C = SIZE / 2;
/** Every glyph's paint is held inside this, so a glyph sits within its hex. */
const REACH = 23;

/** The engraved ring and its six direction ticks, shared by all twelve. */
function engraving(g) {
  g.sector(C, C, 22.6, 21.4, -180, 180, faded(BRASS.dark, 0.9));
  g.sector(C, C, 21.6, 20.9, -180, 180, faded(BRASS.shadow, 0.7));
  for (let i = 0; i < 6; i += 1) {
    const angle = i * 60;
    const [x0, y0] = polar(C, C, 19.4, angle);
    const [x1, y1] = polar(C, C, 22.4, angle);
    g.line(x0, y0, x1, y1, faded(BRASS.mid, 0.95), 1.6);
  }
}

/** A filled node: the mark for a mote a sigil acts on. */
function node(g, x, y, r, fill = BRASS.lit) {
  g.disc(x, y, r + 1.2, BRASS.shadow);
  g.disc(x, y, r, fill);
  g.disc(x - r * 0.3, y - r * 0.35, r * 0.42, BRASS.high);
}

/** A bar between two nodes, the filament a binding sigil creates. */
function bar(g, x0, x1, y, thickness, color = BRASS.lit) {
  g.rect(x0, y - thickness / 2, x1 - x0, thickness, BRASS.shadow);
  g.rect(x0, y - thickness / 2, x1 - x0, thickness - 1, color);
}

/** `bind` — two motes, one new filament of weight one. */
function bind(g) {
  bar(g, 13, 35, C, 5);
  node(g, 12, C, 7);
  node(g, 36, C, 7);
}

/** `manifold` — one center bound to three reaches at once. */
function manifold(g) {
  for (const angle of [0, 120, 240]) {
    const [x, y] = polar(C, C, 16, angle);
    g.line(C, C, x, y, BRASS.shadow, 5.4);
    g.line(C, C, x, y, BRASS.lit, 3.4);
  }
  for (const angle of [0, 120, 240]) {
    const [x, y] = polar(C, C, 16, angle);
    node(g, x, y, 4.6);
  }
  node(g, C, C, 7.4);
}

/** `triune` — the same two motes, bound three times over. */
function triune(g) {
  node(g, 10.5, C, 6.4, EMBER.lit);
  node(g, 37.5, C, 6.4, EMBER.lit);
  // The three bars are laid OVER the nodes, so the count is what reads first.
  bar(g, 9, 39, C - 6.5, 4.6);
  bar(g, 9, 39, C, 4.6);
  bar(g, 9, 39, C + 6.5, 4.6);
  for (const x of [17, 24, 31]) {
    g.rect(x - 1.5, C - 9.5, 3, 19, BRASS.mid);
    g.rect(x - 1.5, C - 9.5, 3, 1, BRASS.high);
    g.rect(x - 1.5, C + 8.5, 3, 1, BRASS.shadow);
  }
}

/** `sunder` — the bar broken, and the stroke that broke it. */
function sunder(g) {
  bar(g, 13, 21, C, 5);
  bar(g, 27, 35, C, 5);
  node(g, 12, C, 6.4);
  node(g, 36, C, 6.4);
  g.line(31, 13, 17, 35, BRASS.shadow, 5);
  g.line(31, 13, 17, 35, FAULT, 3);
  g.line(30, 14, 18, 34, rgba("#ffb9a6"), 1);
}

/** `wane` — an essence losing its body to stardust. */
function wane(g) {
  g.disc(17, C, 12, faded(VIOLET.deep, 0.9));
  g.sector(17, C, 12, 0, 90, 270, VIOLET.mid);
  g.sector(17, C, 12, 8.4, 90, 270, VIOLET.lit);
  g.sector(17, C, 12, 10.6, -180, 180, faded(BRASS.mid, 0.8));
  const grains = [
    [26, 15, 2.4],
    [30, 22, 1.9],
    [27, 29, 1.6],
    [33, 30, 1.3],
    [35, 17, 1.4],
    [32, 25, 1.1],
    [37, 24, 1],
    [29, 35, 1.1],
  ];
  for (const [x, y, r] of grains) {
    g.disc(x, y, r + 0.8, faded(STONE.deep, 0.8));
    g.disc(x, y, r, STONE.pale);
  }
}

/** `mirror` — an essence copied across an axis onto a waiting dust. */
function mirror(g) {
  g.rect(C - 2, 7, 4, 34, BRASS.shadow);
  g.rect(C - 1, 7, 2, 34, BRASS.high);
  node(g, 12.5, C, 8.6, GLASS.lit);
  // The target: the same body, still hollow, waiting to be filled.
  g.disc(35.5, C, 9.8, BRASS.shadow);
  g.sector(35.5, C, 8.6, 6.2, -180, 180, GLASS.lit);
  g.disc(35.5, C, 5.4, faded(GLASS.deep, 0.7));
  for (const dy of [-6, 0, 6]) {
    g.line(C + 4, C + dy, C + 9.5, C + dy, faded(GLASS.pale, 0.9), 1.6);
    g.arrowhead(C + 10, C + dy, 0, 3.6, 40, GLASS.pale);
  }
}

/** The quicksilver a catalyst is drawn in, matching the mercury mote. */
const QUICK = rgba("#cfd8e6");

/** `ascend` — mercury spent, and the planet climbing one rung. */
function ascend(g) {
  node(g, C, 38, 5.4, QUICK);
  for (const y of [30, 22, 14]) {
    const span = 9 + (30 - y) * 0.28;
    g.polyline(
      [
        [C - span, y + 4],
        [C, y - 2],
        [C + span, y + 4],
      ],
      BRASS.shadow,
      5.4,
    );
    g.polyline(
      [
        [C - span, y + 4],
        [C, y - 2],
        [C + span, y + 4],
      ],
      BRASS.lit,
      3,
    );
  }
  g.disc(C, 9, 3.4, BRASS.high);
}

/** `conjoin` — two founts of one rung climbing into one of the next. */
function conjoin(g) {
  for (const x of [13, 35]) {
    g.polyline(
      [
        [x, 34],
        [x + (C - x) * 0.55, 24],
        [C, 17],
      ],
      BRASS.shadow,
      6,
    );
    g.polyline(
      [
        [x, 34],
        [x + (C - x) * 0.55, 24],
        [C, 17],
      ],
      BRASS.lit,
      3.4,
    );
  }
  node(g, 13, 35, 6);
  node(g, 35, 35, 6);
  node(g, C, 14, 9.4);
}

/** `eclipse` — one body across another, the corona left behind. */
function eclipse(g) {
  g.disc(C, C, 17.4, faded(rgba("#ffd06a"), 0.28));
  g.sector(C, C, 16.4, 12.6, -180, 180, rgba("#ffe9a8"));
  g.sector(C, C, 15, 13.2, -180, 180, rgba("#fff6d8"));
  for (let i = 0; i < 12; i += 1) {
    const angle = i * 30;
    const [x0, y0] = polar(C, C, 16.4, angle);
    const [x1, y1] = polar(C, C, 20.4, angle);
    g.line(x0, y0, x1, y1, faded(rgba("#ffd06a"), 0.75), 1.8);
  }
  g.disc(C, C, 12.8, NIGHT.pit);
  g.disc(C, C, 11.4, rgba("#0a0614"));
  g.sector(C, C, 12.8, 11.6, 120, 250, faded(VIOLET.mid, 0.9));
}

/** `confluence` — four essences drawn inward into one filled crown. */
function confluence(g) {
  const hues = [VIOLET.lit, GLASS.lit, EMBER.lit, STONE.pale];
  for (let i = 0; i < 4; i += 1) {
    const angle = -90 + i * 90;
    const [tx, ty] = polar(C, C, 20, angle);
    const [hx, hy] = polar(C, C, 10.6, angle);
    g.line(tx, ty, hx, hy, BRASS.shadow, 5);
    g.line(tx, ty, hx, hy, hues[i], 2.6);
    g.arrowhead(hx, hy, angle + 180, 6.4, 34, BRASS.shadow);
    g.arrowhead(hx, hy, angle + 180, 5.2, 32, hues[i]);
  }
  const core = regular(C, C, 9.4, 4, -90);
  g.poly(core, BRASS.shadow);
  g.poly(regular(C, C, 8, 4, -90), BRASS.lit);
  g.poly(regular(C, C, 4.4, 4, -90), BRASS.high);
}

/** `dispersion` — confluence run backwards: a hollow core, arrows outward. */
function dispersion(g) {
  const hues = [VIOLET.lit, GLASS.lit, EMBER.lit, STONE.pale];
  for (let i = 0; i < 4; i += 1) {
    const angle = -90 + i * 90;
    const [tx, ty] = polar(C, C, 20.4, angle);
    const [hx, hy] = polar(C, C, 11, angle);
    g.line(hx, hy, tx, ty, BRASS.shadow, 5);
    g.line(hx, hy, tx, ty, hues[i], 2.6);
    g.arrowhead(tx, ty, angle, 6.4, 34, BRASS.shadow);
    g.arrowhead(tx, ty, angle, 5.2, 32, hues[i]);
  }
  // A HOLLOW core, against confluence's filled one: the crown is emptying.
  g.polyline(regular(C, C, 9.8, 4, -90), BRASS.shadow, 5.4, true);
  g.polyline(regular(C, C, 9.8, 4, -90), BRASS.lit, 3, true);
  g.disc(C, C, 2.4, faded(EMBER.lit, 0.9));
}

/** `void` — a maw that consumes, ringed by the rim that only takes part. */
function voidSigil(g) {
  for (let i = 0; i < 6; i += 1) {
    const angle = i * 60;
    const [x0, y0] = polar(C, C, 19.6, angle);
    const [x1, y1] = polar(C, C, 14.6, angle);
    g.polyline(
      [
        [x0, y0],
        [x1, y1],
      ],
      BRASS.shadow,
      5.4,
    );
    g.polyline(
      [
        [x0, y0],
        [x1, y1],
      ],
      BRASS.mid,
      3,
    );
  }
  g.sector(C, C, 15.4, 13.2, -180, 180, BRASS.lit);
  g.disc(C, C, 13.2, rgba("#08060f"));
  // The pull: three arcs winding into the middle and going out.
  for (const [r, from, to, alpha] of [
    [11, -160, 60, 0.9],
    [8, 20, 240, 0.7],
    [5, 200, 400, 0.5],
  ]) {
    g.sector(C, C, r, r - 1.4, from, to, faded(BRASS.mid, alpha));
  }
  g.disc(C, C, 2.4, rgba("#04030a"));
}

const MARKS = {
  bind,
  manifold,
  triune,
  sunder,
  wane,
  mirror,
  ascend,
  conjoin,
  eclipse,
  confluence,
  dispersion,
  void: voidSigil,
};

/** Every transforming sigil's kind, in the order `PARTS` lists them. */
export const KINDS = Object.keys(MARKS);

/** Paint one sigil glyph: the shared engraving, then the sigil's own mark. */
export function paintSigil(kind) {
  const mark = MARKS[kind];
  if (!mark) throw new Error(`no sigil named ${kind}`);
  const g = new Raster(SIZE, SIZE);
  engraving(g);
  mark(g);
  g.clipCircle(C, C, REACH);
  if (g.painted === 0) throw new Error(`the ${kind} sigil painted nothing`);
  return g;
}
