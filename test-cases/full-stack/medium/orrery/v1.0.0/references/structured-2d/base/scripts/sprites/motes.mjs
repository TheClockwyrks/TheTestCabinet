// Orrery — the fifteen mote sprites (specs/assets.md "The sprites").
//
// One 44 x 44 PNG per name in `MOTES`, drawn centered on the mote's position
// at rest and while carried. specs/field.md fixes the bar: the fifteen are
// identifiable at a glance, the six planets read in the ladder order of
// `PLANETS`, and every mote's paint stays inside MOTE_R (22) of its center so
// motes on adjacent hexes never blur together.
//
// The three tells each mote is told by, in order of how fast the eye reads
// them: SILHOUETTE first — stardust is a scatter, a nebula a lumpy cloud, a
// comet a cut hexagonal crystal, a nova an eight-point burst, a meteor an
// irregular rock, mercury a hanging droplet, a planet a banded orb, and
// aether a quartered disc. HUE second. And for the six planets, whose family
// resemblance is the point, a countable RUNG: `saturn` carries one bright pip
// on the arc above it and `sol` carries six, so the ladder is read off the
// sprite without a label.

import { Raster, faded, mixed, polar, regular, rgba } from "./raster.mjs";
import { BRASS, EMBER, GLASS, STONE, VIOLET } from "./palette.mjs";

/** Quicksilver's own ramp: colder than brass, warmer than the machine's steel. */
const QUICKSILVER = {
  dark: rgba("#4d5568"),
  mid: rgba("#97a2b6"),
  lit: rgba("#cfd8e6"),
  pale: rgba("#eef3fb"),
};

/** The mote canvas, MOTE_SPRITE_SIZE. */
export const SIZE = 44;
/** The canvas center, which every mote is drawn centered on. */
const C = SIZE / 2;
/**
 * The radius every painted pixel is held inside. MOTE_R is 22; painting to 20
 * leaves the guarantee true whether a checker measures a pixel's center or its
 * index, and keeps two motes on adjacent hexes two pixels apart.
 */
const REACH = 20;

/** A small deterministic generator, so a scatter is the same on every run. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A lit sphere: body, a lit upper-left face, a shaded lower-right crescent. */
function orb(r, base, lit, shade, rimColor) {
  const g = new Raster(SIZE, SIZE);
  g.disc(C, C, r, base);
  g.disc(C - r * 0.28, C - r * 0.3, r * 0.72, mixed(base, lit, 0.45));
  g.disc(C - r * 0.4, C - r * 0.42, r * 0.42, mixed(base, lit, 0.8));
  // The shaded limb: the body ring, darkened, minus the lit side.
  g.sector(C, C, r, r - 3.2, 5, 130, mixed(base, shade, 0.7));
  g.sector(C, C, r, r - 1.8, 140, 175, mixed(base, shade, 0.45));
  if (rimColor) g.sector(C, C, r, r - 1.2, 185, 350, rimColor);
  return g;
}

/**
 * The rung pips: `count` bright beads on the arc above the orb, evenly spread
 * about straight up. Countable at 44 units, which is what makes the ladder
 * order of `PLANETS` legible on the field.
 */
function pips(g, count) {
  const step = 17;
  for (let i = 0; i < count; i += 1) {
    const angle = -90 + (i - (count - 1) / 2) * step;
    const [x, y] = polar(C, C, 18.4, angle);
    g.disc(x, y, 1.9, BRASS.dark);
    g.disc(x, y, 1.4, BRASS.high);
  }
}

/** Inert stardust: a loose scatter of unlit grains, never a body. */
function dust() {
  const g = new Raster(SIZE, SIZE);
  const next = seeded(0x51d);
  for (let i = 0; i < 26; i += 1) {
    const angle = next() * 360;
    const reach = 3 + next() * 14;
    const [x, y] = polar(C, C, reach, angle);
    const size = next() < 0.25 ? 2.1 : next() < 0.6 ? 1.4 : 0.9;
    g.disc(x, y, size + 0.7, faded(STONE.deep, 0.7));
    g.disc(x, y, size, next() < 0.35 ? STONE.pale : STONE.mid);
  }
  // Three brighter grains catching the light, so the scatter is not a smudge.
  for (const [x, y] of [
    [C - 5, C - 6],
    [C + 7, C + 2],
    [C - 1, C + 8],
  ]) {
    g.disc(x, y, 1.6, STONE.pale);
    g.disc(x, y, 0.8, rgba("#fdf6e4"));
  }
  return g;
}

/** The essence of cloud: overlapping lumps, no hard edge anywhere. */
function nebula() {
  const g = new Raster(SIZE, SIZE);
  const lumps = [
    [-6, -5, 9],
    [5, -6, 8],
    [7, 4, 8.5],
    [-6, 6, 8],
    [0, 0, 10],
    [-10, 0, 6],
    [10, -1, 5.5],
  ];
  for (const [dx, dy, r] of lumps) g.disc(C + dx, C + dy, r + 1.6, VIOLET.deep);
  for (const [dx, dy, r] of lumps) g.disc(C + dx, C + dy, r, VIOLET.mid);
  for (const [dx, dy, r] of lumps) {
    g.disc(C + dx - 1, C + dy - 1.5, r * 0.6, VIOLET.lit);
  }
  g.disc(C - 2, C - 2, 5, mixed(VIOLET.lit, VIOLET.pale, 0.6));
  for (const [dx, dy] of [
    [-3, -3],
    [4, 1],
    [-6, 4],
    [6, -5],
    [1, 6],
  ]) {
    g.disc(C + dx, C + dy, 0.9, VIOLET.pale);
  }
  return g;
}

/** The essence of ice: a cut hexagonal crystal with three faceted flanks. */
function comet() {
  const g = new Raster(SIZE, SIZE);
  g.poly(regular(C, C, 17, 6, -90), GLASS.deep);
  g.poly(regular(C, C, 13.5, 6, -90), GLASS.mid);
  g.poly(regular(C, C, 7, 6, -90), GLASS.lit);
  g.disc(C, C, 3.4, GLASS.pale);
  // Facet seams from the core to every second vertex, and a rim of cold light.
  for (const angle of [-90, 30, 150]) {
    const [x, y] = polar(C, C, 16.5, angle);
    g.line(C, C, x, y, GLASS.pale, 1.4);
  }
  for (const angle of [-30, 90, 210]) {
    const [x, y] = polar(C, C, 16.5, angle);
    g.line(C, C, x, y, faded(GLASS.deep, 0.8), 1);
  }
  g.polyline(regular(C, C, 17, 6, -90), GLASS.lit, 1.2, true);
  const [gx, gy] = polar(C, C, 15, -90);
  g.disc(gx, gy, 2, rgba("#ffffff"));
  return g;
}

/** The essence of fire: an eight-point burst with a white core. */
function nova() {
  const g = new Raster(SIZE, SIZE);
  const star = (outer, inner, rotation) =>
    Array.from({ length: 16 }, (_, i) =>
      polar(C, C, i % 2 === 0 ? outer : inner, rotation + i * 22.5),
    );
  g.poly(star(19.6, 8, -90), EMBER.deep);
  g.poly(star(18, 7, -90), EMBER.mid);
  g.poly(star(12, 4.6, -90), EMBER.lit);
  g.disc(C, C, 5.4, EMBER.pale);
  g.disc(C, C, 2.8, rgba("#fffdf2"));
  return g;
}

/** The essence of stone: an irregular unlit rock, cratered. */
function meteor() {
  const g = new Raster(SIZE, SIZE);
  const next = seeded(0x37e);
  const hull = Array.from({ length: 11 }, (_, i) =>
    polar(C, C, 13.5 + next() * 4.5, -90 + (i * 360) / 11),
  );
  g.poly(hull, STONE.deep);
  g.poly(
    hull.map(([x, y]) => [C + (x - C) * 0.88, C + (y - C) * 0.88]),
    STONE.mid,
  );
  // The lit north-west face.
  g.sector(C - 2, C - 2, 12, 0, 175, 320, STONE.lit);
  for (const [dx, dy, r] of [
    [4, -5, 3.4],
    [-5, 4, 2.6],
    [6, 6, 2.1],
    [-2, -7, 1.6],
  ]) {
    g.disc(C + dx, C + dy, r, STONE.deep);
    g.sector(C + dx, C + dy, r, r - 1.2, 190, 350, STONE.pale);
  }
  g.polyline(hull, STONE.pale, 1, true);
  return g;
}

/** The catalyst: a hanging droplet of quicksilver, spent to raise a planet. */
function mercury() {
  const g = new Raster(SIZE, SIZE);
  const body = C + 3.5;
  const drop = [
    [C, C - 18],
    [C + 6.5, C - 2],
    [C + 11, body],
    [C, C + 16],
    [C - 11, body],
    [C - 6.5, C - 2],
  ];
  g.poly(drop, QUICKSILVER.dark);
  g.disc(C, body, 11, QUICKSILVER.dark);
  g.poly(
    drop.map(([x, y]) => [C + (x - C) * 0.86, C + (y - C) * 0.9]),
    QUICKSILVER.mid,
  );
  g.disc(C, body, 9.6, QUICKSILVER.mid);
  g.disc(C - 2.5, body - 3, 6.4, QUICKSILVER.lit);
  g.disc(C - 3.6, body - 4.4, 3.4, QUICKSILVER.pale);
  g.disc(C - 4.2, body - 5, 1.7, rgba("#ffffff"));
  // The mirror band that says liquid rather than stone.
  g.sector(C, body, 10.4, 8.4, 20, 150, QUICKSILVER.pale);
  g.disc(C, C - 15.5, 1.6, QUICKSILVER.pale);
  return g;
}

/** The first rung: a dull ochre giant wearing the ring that names it. */
function saturn() {
  const body = orb(
    14,
    rgba("#b0894c"),
    rgba("#e7c88a"),
    rgba("#5c4118"),
    rgba("#d8b070"),
  );
  for (const [dy, h, color] of [
    [-8, 2, "#9a7539"],
    [-3, 2, "#cba766"],
    [2, 2, "#8f6c33"],
    [7, 2, "#c09a58"],
  ]) {
    body.rect(C - 14, C + dy, 28, h, faded(rgba(color), 0.8));
  }
  body.clipCircle(C, C, 14);

  // The ring passes behind the north face and in front of the south one, so
  // it is painted in two halves with the body between them.
  const ring = new Raster(SIZE, SIZE);
  ring.ellipseRing(C, C, 19.6, 5.6, 0.34, rgba("#c9a259"));
  ring.ellipseRing(C, C, 19.6, 5.6, 0.14, rgba("#f0d59a"));
  const g = new Raster(SIZE, SIZE);
  for (let y = 0; y < C; y += 1) {
    for (let x = 0; x < SIZE; x += 1) g.put(x, y, ring.get(x, y));
  }
  g.blit(body, 0, 0);
  for (let y = Math.floor(C); y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const c = ring.get(x, y);
      if (c[3] > 0) g.set(x, y, c);
    }
  }
  pips(g, 1);
  return g;
}

/** The second rung: banded amber with a storm. */
function jupiter() {
  const g = orb(
    15,
    rgba("#d98b3a"),
    rgba("#ffd9a0"),
    rgba("#6b3a10"),
    rgba("#f0b070"),
  );
  for (const [dy, h, color] of [
    [-11, 2, "#a95f22"],
    [-6, 3, "#f0b070"],
    [-1, 3, "#a95f22"],
    [4, 2, "#ffc688"],
    [8, 3, "#b3671f"],
  ]) {
    g.rect(C - 15, C + dy, 30, h, faded(rgba(color), 0.9));
  }
  g.ellipse(C + 5, C + 2.5, 4.2, 2.6, rgba("#c0432a"));
  g.ellipse(C + 5, C + 2.5, 2.4, 1.4, rgba("#e88a5c"));
  g.clipCircle(C, C, 15);
  pips(g, 2);
  return g;
}

/** The third rung: rust, mottled, with a pale cap. */
function mars() {
  const g = orb(
    15,
    rgba("#c9503a"),
    rgba("#f19a76"),
    rgba("#5c1c11"),
    rgba("#e07a56"),
  );
  const next = seeded(0x3a5);
  for (let i = 0; i < 14; i += 1) {
    const [x, y] = polar(C, C, next() * 12, next() * 360);
    g.disc(x, y, 1.4 + next() * 2.4, faded(rgba("#8e3324"), 0.75));
  }
  g.ellipse(C - 1, C - 12.5, 6.5, 3, rgba("#f3e0d2"));
  g.ellipse(C + 1, C + 13.5, 4.4, 2, faded(rgba("#f3e0d2"), 0.8));
  g.clipCircle(C, C, 15);
  pips(g, 3);
  return g;
}

/** The fourth rung: pale cream cloud, featureless and bright. */
function venus() {
  const g = orb(
    15,
    rgba("#e6c47a"),
    rgba("#fdf3d0"),
    rgba("#7a5c22"),
    rgba("#f6e3ad"),
  );
  for (const [dx, dy, rx, ry] of [
    [-4, -6, 9, 3],
    [4, -1, 8, 2.6],
    [-2, 5, 9.5, 3],
    [3, 10, 6, 2],
  ]) {
    g.ellipse(C + dx, C + dy, rx, ry, faded(rgba("#fdf3d0"), 0.5));
  }
  g.clipCircle(C, C, 15);
  pips(g, 4);
  return g;
}

/** The fifth rung: cold silver, cratered, with a dark mare. */
function luna() {
  const g = orb(
    15,
    rgba("#c2cee4"),
    rgba("#ffffff"),
    rgba("#4c5470"),
    rgba("#e2eaf7"),
  );
  g.ellipse(C + 3, C + 4, 7, 5.5, faded(rgba("#8d9ab8"), 0.85));
  g.ellipse(C - 6, C - 6, 4.4, 3.6, faded(rgba("#9aa7c4"), 0.7));
  for (const [dx, dy, r] of [
    [-3, 6, 2.6],
    [7, -6, 2.2],
    [0, -3, 1.6],
    [-8, 1, 1.9],
    [5, 9, 1.5],
  ]) {
    g.disc(C + dx, C + dy, r, rgba("#8d9ab8"));
    g.sector(C + dx, C + dy, r, r - 1, 190, 350, rgba("#eef3fb"));
  }
  g.clipCircle(C, C, 15);
  pips(g, 5);
  return g;
}

/** The top rung: a blazing gold sun inside a corona. */
function sol() {
  const g = new Raster(SIZE, SIZE);
  g.disc(C, C, 16.6, faded(rgba("#ff9a2a"), 0.3));
  g.disc(C, C, 15.4, faded(rgba("#ffb02e"), 0.55));
  const body = orb(
    14,
    rgba("#ffcf45"),
    rgba("#fffce8"),
    rgba("#a05f10"),
    rgba("#ffe38c"),
  );
  g.blit(body, 0, 0);
  g.disc(C, C, 7.4, rgba("#fff2b8"));
  g.disc(C, C, 3.6, rgba("#fffdf4"));
  for (let i = 0; i < 12; i += 1) {
    const angle = i * 30 + 15;
    const [x0, y0] = polar(C, C, 13.6, angle);
    const [x1, y1] = polar(C, C, 16.4, angle);
    g.line(x0, y0, x1, y1, faded(rgba("#ffdf7a"), 0.8), 1.4);
  }
  g.clipCircle(C, C, 16.6);
  pips(g, 6);
  return g;
}

/** Condensed shadow: a black body that gives back only a violet edge. */
function umbra() {
  const g = new Raster(SIZE, SIZE);
  g.disc(C, C, 17.4, faded(VIOLET.deep, 0.45));
  g.disc(C, C, 16, rgba("#150d26"));
  g.disc(C, C, 12, rgba("#0a0614"));
  g.sector(C, C, 16, 13.6, -180, 180, VIOLET.deep);
  g.sector(C, C, 16, 14.2, 100, 260, rgba("#7d5cba"));
  g.sector(C, C, 16, 14.6, 140, 210, VIOLET.lit);
  for (let i = 0; i < 6; i += 1) {
    const angle = i * 60 + 30;
    const [x0, y0] = polar(C, C, 16, angle);
    const [x1, y1] = polar(C, C, 19.4, angle);
    g.line(x0, y0, x1, y1, faded(VIOLET.mid, 0.7), 1.6);
  }
  g.disc(C - 4, C - 4, 2.4, faded(VIOLET.lit, 0.5));
  g.clipCircle(C, C, 19.6);
  return g;
}

/** Condensed light: umbra's opposite — a white body throwing a halo. */
function lumen() {
  const g = new Raster(SIZE, SIZE);
  g.disc(C, C, 19.6, faded(rgba("#ffd06a"), 0.22));
  g.disc(C, C, 16.4, faded(rgba("#ffe08a"), 0.4));
  g.disc(C, C, 13.4, rgba("#ffe9a8"));
  g.disc(C, C, 9.6, rgba("#fff6d8"));
  g.disc(C, C, 5.4, rgba("#fffdf4"));
  for (let i = 0; i < 4; i += 1) {
    const angle = i * 90;
    const [x0, y0] = polar(C, C, 4, angle);
    const [x1, y1] = polar(C, C, 19.4, angle);
    g.line(x0, y0, x1, y1, faded(rgba("#fff6d8"), 0.75), 2.4);
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = i * 90 + 45;
    const [x0, y0] = polar(C, C, 6, angle);
    const [x1, y1] = polar(C, C, 15, angle);
    g.line(x0, y0, x1, y1, faded(rgba("#ffe9a8"), 0.6), 1.4);
  }
  g.clipCircle(C, C, 19.6);
  return g;
}

/** The quintessence: one disc quartered into the four essences. */
function aether() {
  const g = new Raster(SIZE, SIZE);
  g.disc(C, C, 16.6, BRASS.dark);
  const quarters = [
    [-90, VIOLET.mid, VIOLET.lit],
    [0, GLASS.deep, GLASS.lit],
    [90, EMBER.mid, EMBER.lit],
    [180, STONE.mid, STONE.pale],
  ];
  for (const [from, base, lit] of quarters) {
    g.sector(C, C, 15.4, 0, from, from + 90, base);
    g.sector(C, C, 15.4, 9, from + 8, from + 82, lit);
  }
  for (const angle of [-90, 0, 90, 180]) {
    const [x, y] = polar(C, C, 16, angle);
    g.line(C, C, x, y, BRASS.lit, 1.6);
  }
  g.sector(C, C, 16.6, 15.2, -180, 180, BRASS.lit);
  g.disc(C, C, 6.4, BRASS.mid);
  g.disc(C, C, 5, rgba("#fffdf4"));
  g.disc(C, C, 2.4, BRASS.high);
  g.clipCircle(C, C, 16.8);
  return g;
}

/** Every mote by name, in the order `MOTES` gives them. */
export const MOTES = {
  dust,
  nebula,
  comet,
  nova,
  meteor,
  mercury,
  saturn,
  jupiter,
  mars,
  venus,
  luna,
  sol,
  umbra,
  lumen,
  aether,
};

/** Paint one mote, clipped to the reach every mote's paint is held inside. */
export function paintMote(name) {
  const build = MOTES[name];
  if (!build) throw new Error(`no mote named ${name}`);
  const g = build();
  g.clipCircle(C, C, REACH);
  if (g.painted === 0) throw new Error(`the ${name} mote painted nothing`);
  return g;
}
