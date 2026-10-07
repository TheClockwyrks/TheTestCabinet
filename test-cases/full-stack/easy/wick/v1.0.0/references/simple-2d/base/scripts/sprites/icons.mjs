// Wick — the twenty-seven icons (specs/assets.md "The icons").
//
// Each is a 24 x 24 plate with a symbol on it. The plate's rim says what
// kind of thing it is: slate for a tool, gold for a transformed tool, brown
// for a trinket, green for lamp oil. An evolved tool's symbol is its base's
// symbol burning hotter, so the pair reads as one thing before and after.

import { C } from "./palette.mjs";
import { Raster, drawSprite, rgba } from "./raster.mjs";

const TAU = Math.PI * 2;

function plate(kind) {
  const r = new Raster(24, 24);
  const rim = {
    weapon: C.plateRim,
    evolved: C.plateGold,
    passive: C.plateBrownRim,
    oil: C.plateGreenRim,
  }[kind];
  const fill = kind === "passive" ? C.plateBrown : C.plate;
  r.rect(2, 1, 20, 22, rim);
  r.rect(1, 2, 22, 20, rim);
  r.rect(3, 2, 18, 20, fill);
  r.rect(2, 3, 20, 18, fill);
  return r;
}

function flameAt(r, x, y, h) {
  r.ellipse(x, y, h * 0.32, h * 0.5, C.flameOrange);
  r.ellipse(x, y + h * 0.12, h * 0.16, h * 0.28, C.flame);
}

// ---- Weapons ---------------------------------------------------------------

function taper() {
  const r = plate("weapon");
  r.rect(10, 9, 5, 11, C.cream);
  r.rect(10, 9, 1, 11, C.creamDark);
  r.rect(9, 19, 7, 2, C.creamDark);
  flameAt(r, 12.5, 6, 6);
  return r;
}

function pyre() {
  const r = plate("evolved");
  r.rect(9, 12, 7, 8, C.cream);
  r.rect(9, 12, 1, 8, C.creamDark);
  r.rect(8, 19, 9, 2, C.creamDark);
  r.poly(
    [
      [6, 12],
      [12.5, 2.5],
      [19, 12],
    ],
    C.flameRed,
  );
  r.poly(
    [
      [8, 12],
      [12.5, 4.5],
      [17, 12],
    ],
    C.flameOrange,
  );
  r.poly(
    [
      [10, 12],
      [12.5, 7],
      [15, 12],
    ],
    C.white,
  );
  r.set(6, 5, C.emberCore);
  r.set(18, 4, C.emberCore);
  return r;
}

function ember() {
  const r = plate("weapon");
  r.disc(13, 12, 5.5, C.emberOuter);
  r.disc(14, 12, 3, C.emberCore);
  r.disc(15, 11, 1.2, C.white);
  r.disc(6, 9, 1.4, C.emberTail);
  r.disc(5, 13, 1.2, C.emberTail);
  r.disc(7, 16, 1, C.emberTail);
  return r;
}

function beacon() {
  const r = plate("evolved");
  r.line(12, 2.5, 12, 21.5, C.beaconRay, 1.6);
  r.line(2.5, 12, 21.5, 12, C.beaconRay, 1.6);
  r.line(6, 6, 18, 18, C.beaconRay, 1);
  r.line(18, 6, 6, 18, C.beaconRay, 1);
  r.disc(12, 12, 5.5, C.beacon);
  r.disc(12, 12, 2.6, C.white);
  return r;
}

function pin() {
  const r = plate("weapon");
  r.line(6, 18, 17, 7, C.steel, 2.2);
  r.ring(6, 18, 2.6, 1.4, C.steelDark);
  r.poly(
    [
      [15.5, 5],
      [19.5, 4.5],
      [19, 8.5],
    ],
    C.steelLight,
  );
  return r;
}

function hail() {
  const r = plate("evolved");
  for (const d of [-4, 0, 4]) {
    r.line(6 + d, 18, 15 + d, 9, C.ice, 1.8);
    r.poly(
      [
        [14 + d, 7.5],
        [17.5 + d, 6.5],
        [16.5 + d, 10],
      ],
      C.white,
    );
  }
  r.set(4, 6, C.ice);
  r.set(20, 19, C.ice);
  return r;
}

function lantern() {
  const r = plate("weapon");
  r.line(12, 3, 12, 6, C.brassDark, 1.5);
  r.poly(
    [
      [7, 8],
      [17, 8],
      [15, 5.5],
      [9, 5.5],
    ],
    C.brassDark,
  );
  r.rect(7, 8, 10, 10, C.brass);
  r.rect(9, 10, 6, 6, C.glass);
  flameAt(r, 12, 13, 4);
  r.rect(8, 18, 8, 2, C.brassDark);
  r.rect(8, 9, 1, 8, C.brassLight);
  return r;
}

function chandelier() {
  const r = plate("evolved");
  r.line(12, 2.5, 12, 8, C.brassDark, 1.2);
  r.ring(12, 13, 7.5, 5.5, C.brass);
  r.ring(12, 13, 7.8, 7.2, C.brassLight);
  for (const [x, y] of [
    [6, 7],
    [12, 4.5],
    [18, 7],
  ]) {
    r.rect(x - 1, y, 2, 3, C.cream);
    flameAt(r, x, y - 1.5, 3);
  }
  for (const x of [7, 12, 17]) {
    r.line(x, 19, x, 21.5, C.crystal, 1.2);
  }
  return r;
}

function halo() {
  const r = plate("weapon");
  r.disc(12, 12, 6, C.haloFill);
  r.ring(12, 12, 7.5, 5.2, C.haloRing);
  r.ring(12, 12, 6.6, 6, C.flame);
  return r;
}

function corona() {
  const r = plate("evolved");
  for (let i = 0; i < 8; i += 1) {
    const a = (i * TAU) / 8;
    r.line(
      12 + Math.cos(a) * 6,
      12 + Math.sin(a) * 6,
      12 + Math.cos(a) * 10,
      12 + Math.sin(a) * 10,
      C.coronaRay,
      1.6,
    );
  }
  r.disc(12, 12, 5.5, C.coronaFill);
  r.ring(12, 12, 6.5, 4.8, C.coronaRing);
  r.ring(12, 12, 5.8, 5.2, C.white);
  return r;
}

function oilSplash() {
  const r = plate("weapon");
  r.disc(12, 14, 6, C.oilRim);
  r.disc(12, 14, 4.8, C.oil);
  r.disc(7, 10, 2, C.oilRim);
  r.disc(17.5, 9, 2.5, C.oilRim);
  r.disc(17.5, 9, 1.4, C.oil);
  r.disc(15, 17.5, 2, C.oilRim);
  r.ellipse(10.5, 13, 2, 1, C.oilSheen);
  return r;
}

function blaze() {
  const r = plate("evolved");
  r.disc(12, 15, 6.5, C.blazeRim);
  r.disc(12, 15, 5, C.char);
  r.disc(6, 12, 2, C.blazeRim);
  r.disc(18, 11, 2.2, C.blazeRim);
  r.poly(
    [
      [8, 15],
      [12, 3.5],
      [16, 15],
    ],
    C.flameOrange,
  );
  r.poly(
    [
      [10, 15],
      [12, 8],
      [14, 15],
    ],
    C.flame,
  );
  return r;
}

function spark() {
  const r = plate("weapon");
  r.poly(
    [
      [13, 2.5],
      [7, 13],
      [11.5, 13],
      [9, 21.5],
      [17, 10],
      [12.5, 10],
      [15.5, 2.5],
    ],
    C.boltGlow,
  );
  r.poly(
    [
      [13, 4],
      [8.5, 12.5],
      [12, 12.5],
      [10, 19],
      [15.5, 10.5],
      [12, 10.5],
      [14.5, 4],
    ],
    C.bolt,
  );
  return r;
}

function shard() {
  const r = plate("weapon");
  r.poly(
    [
      [4, 12],
      [12, 5],
      [20, 12],
      [12, 19],
    ],
    C.gemCyan,
  );
  r.poly(
    [
      [6, 12],
      [12, 7],
      [13, 11],
    ],
    C.white,
  );
  r.poly(
    [
      [12, 17],
      [18, 12],
      [13, 13],
    ],
    C.gemCyanDark,
  );
  return r;
}

function sconce() {
  const r = plate("weapon");
  r.rect(5, 4, 3, 16, C.iron);
  r.rect(5, 4, 1, 16, C.ironRim);
  r.rect(7, 12, 8, 2, C.iron);
  r.line(8, 14, 12, 18, C.iron, 1.5);
  r.ring(15, 12, 3, 1.5, C.iron);
  flameAt(r, 15, 7, 6);
  return r;
}

function flare() {
  const r = plate("weapon");
  for (let i = 0; i < 8; i += 1) {
    const a = (i * TAU) / 8;
    const reach = i % 2 === 0 ? 9.5 : 6.5;
    r.line(
      12,
      12,
      12 + Math.cos(a) * reach,
      12 + Math.sin(a) * reach,
      C.flareCore,
      1.8,
    );
  }
  r.disc(12, 12, 4, C.flareRing);
  r.disc(12, 12, 2, C.white);
  return r;
}

// ---- Passives --------------------------------------------------------------

function wick() {
  const r = plate("passive");
  const points = [];
  for (let t = 0; t <= 24; t += 1) {
    const a = (t / 24) * TAU * 1.5;
    const radius = 2 + t * 0.28;
    points.push([11 + Math.cos(a) * radius, 14 + Math.sin(a) * radius * 0.8]);
  }
  r.polyline(points, C.cream, 1.6);
  const [ex, ey] = points[points.length - 1];
  flameAt(r, ex, ey - 3, 5);
  return r;
}

function oil() {
  const r = plate("passive");
  r.rect(10, 3, 4, 3, C.silverDark);
  r.rect(10, 6, 4, 3, C.amber);
  r.poly(
    [
      [10, 8],
      [14, 8],
      [18, 12],
      [18, 20],
      [6, 20],
      [6, 12],
    ],
    C.amber,
  );
  r.rect(7, 13, 10, 6, C.amberLight);
  r.rect(7, 12, 1, 8, C.brassLight);
  return r;
}

function glass() {
  const r = plate("passive");
  r.disc(12, 12, 8, rgba("#bfe9ff", 70));
  r.ring(12, 12, 8.5, 7, C.ice);
  r.line(8, 9, 10, 7, C.white, 1.6);
  r.line(15, 16, 17, 14, C.white, 1.2);
  return r;
}

function brass() {
  const r = plate("passive");
  r.poly(
    [
      [5, 5],
      [19, 5],
      [19, 13],
      [12, 20],
      [5, 13],
    ],
    C.brassDark,
  );
  r.poly(
    [
      [6.5, 6.5],
      [17.5, 6.5],
      [17.5, 12.5],
      [12, 18],
      [6.5, 12.5],
    ],
    C.brass,
  );
  r.rect(8, 8, 3, 3, C.brassLight);
  for (const [x, y] of [
    [7, 7],
    [17, 7],
    [12, 17],
  ]) {
    r.set(x, y, C.brassLight);
  }
  return r;
}

function mirror() {
  const r = plate("passive");
  r.line(12, 15, 12, 21, C.brassDark, 2.4);
  r.ellipse(12, 10, 6.5, 7, C.brass);
  r.ellipse(12, 10, 5, 5.5, C.ice);
  r.line(9, 9, 11, 6, C.white, 1.6);
  return r;
}

function bellows() {
  const r = plate("passive");
  r.poly(
    [
      [4, 8],
      [15, 5],
      [15, 19],
      [4, 16],
    ],
    C.leather,
  );
  r.poly(
    [
      [5, 9],
      [14, 6.5],
      [14, 17.5],
      [5, 15],
    ],
    C.wood,
  );
  r.line(6, 10, 13, 8, C.woodDark, 1);
  r.line(6, 14, 13, 16, C.woodDark, 1);
  r.rect(15, 10.5, 5, 3, C.silverDark);
  r.rect(4, 6, 2, 3, C.woodDark);
  r.rect(4, 15, 2, 3, C.woodDark);
  return r;
}

function tallow() {
  const r = plate("passive");
  r.disc(8.5, 9, 4.5, C.heart);
  r.disc(15.5, 9, 4.5, C.heart);
  r.poly(
    [
      [4.2, 10.5],
      [19.8, 10.5],
      [12, 20],
    ],
    C.heart,
  );
  r.disc(8, 8, 1.4, C.heartLight);
  return r;
}

function tinder() {
  const r = plate("passive");
  r.line(5, 19, 17, 15, C.twig, 2);
  r.line(6, 15, 18, 19, C.twig, 2);
  r.line(7, 20, 16, 12, C.twig, 1.5);
  for (const [x, y, s] of [
    [12, 8, 1.6],
    [9, 5, 1],
    [15, 5, 1.2],
    [12, 3, 0.8],
  ]) {
    r.disc(x, y, s, C.emberCore);
  }
  r.line(12, 6, 12, 10, C.flameOrange, 1.4);
  return r;
}

function soot() {
  const r = plate("passive");
  for (const [x, y, s] of [
    [12, 13, 6],
    [7, 10, 3.5],
    [17, 9, 3],
    [8, 17, 3],
    [17, 16, 2.8],
    [12, 6, 2.5],
  ]) {
    r.disc(x, y, s + 1, C.sootRim);
  }
  for (const [x, y, s] of [
    [12, 13, 6],
    [7, 10, 3.5],
    [17, 9, 3],
    [8, 17, 3],
    [17, 16, 2.8],
    [12, 6, 2.5],
  ]) {
    r.disc(x, y, s, C.soot);
  }
  for (const [x, y] of [
    [10, 11],
    [14, 15],
    [8, 16],
    [16, 10],
  ]) {
    r.set(x, y, C.sootSpeck);
  }
  return r;
}

function lure() {
  const r = plate("passive");
  r.ring(12, 11, 7.5, 3.5, C.magnet);
  r.rect(3, 11, 18, 10, C.plateBrown);
  r.rect(4.5, 11, 4, 8, C.magnet);
  r.rect(15.5, 11, 4, 8, C.magnet);
  r.rect(4.5, 17, 4, 3, C.magnetTip);
  r.rect(15.5, 17, 4, 3, C.magnetTip);
  r.set(6, 5, C.white);
  return r;
}

function lampOil() {
  const r = plate("oil");
  r.rect(7, 8, 11, 12, C.can);
  r.rect(7, 8, 1, 12, C.silver);
  r.rect(9, 5, 4, 3, C.canDark);
  r.line(13, 6, 19, 3.5, C.canDark, 2);
  r.rect(11, 11, 3, 7, C.green);
  r.rect(9, 13, 7, 3, C.green);
  return r;
}

const ICONS = {
  taper,
  ember,
  pin,
  lantern,
  halo,
  "oil-splash": oilSplash,
  spark,
  shard,
  sconce,
  flare,
  pyre,
  beacon,
  hail,
  chandelier,
  corona,
  blaze,
  wick,
  oil,
  glass,
  brass,
  mirror,
  bellows,
  tallow,
  tinder,
  soot,
  lure,
  "lamp-oil": lampOil,
};

export function produceIcons(tools, out) {
  for (const [id, icon] of Object.entries(ICONS)) {
    drawSprite(tools, `${out}/icons/${id}.png`, icon());
  }
}
