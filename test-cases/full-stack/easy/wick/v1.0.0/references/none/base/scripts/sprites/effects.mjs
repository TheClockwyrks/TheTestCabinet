// Wick — the sixteen weapon effects (specs/assets.md "The weapon effects").
//
// Each is produced on the canvas its row states and scaled in code to the
// live shape, so a slash is a wide lens of flame, a bolt a small orb with a
// tail, and the aura a ring the size of its canvas. Every evolved effect
// keeps its base's form, frame count, and canvas and burns hotter: a white
// core, a second ring, rays, or open flame, so the transformation is seen
// at a glance.

import { C } from "./palette.mjs";
import { Raster, drawSheet, drawSprite, rgba } from "./raster.mjs";

const TAU = Math.PI * 2;

/** `count` points evenly spaced on a circle, from angle `phase`. */
function around(cx, cy, radius, count, phase = 0) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const a = phase + (i * TAU) / count;
    points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, a]);
  }
  return points;
}

// ---- Taper and Pyre (120 x 40) --------------------------------------------

/** A lens of flame from the near edge at the left to the tip at the right. */
function lens(inset, top, bottom) {
  return [
    [2 + inset, 20],
    [22 + inset * 1.5, top],
    [60, top - 3],
    [98 - inset * 1.5, top + 2],
    [118 - inset, 20],
    [98 - inset * 1.5, bottom - 2],
    [60, bottom + 3],
    [22 + inset * 1.5, bottom],
  ];
}

function taper() {
  const r = new Raster(120, 40);
  r.poly(lens(0, 8, 32), rgba("#ff9a3a", 150));
  r.poly(lens(4, 11, 29), C.flameOrange);
  r.poly(lens(10, 15, 25), C.flame);
  for (const x of [30, 52, 74, 96]) {
    r.poly(
      [
        [x, 10],
        [x + 3, 2],
        [x + 7, 10],
      ],
      C.flameOrange,
    );
  }
  return r;
}

function pyre() {
  const r = new Raster(120, 40);
  r.poly(lens(0, 4, 36), C.flameRed);
  r.poly(lens(3, 8, 32), C.flameOrange);
  r.poly(lens(8, 12, 28), C.flame);
  r.poly(lens(14, 16, 24), C.white);
  for (const x of [22, 40, 58, 76, 94]) {
    r.poly(
      [
        [x, 8],
        [x + 4, 0.5],
        [x + 8, 8],
      ],
      C.flameOrange,
    );
    r.poly(
      [
        [x + 2, 8],
        [x + 4, 3],
        [x + 6, 8],
      ],
      C.flame,
    );
    r.poly(
      [
        [x + 6, 32],
        [x + 10, 39.5],
        [x + 14, 32],
      ],
      C.flameOrange,
    );
  }
  for (const [x, y] of [
    [16, 6],
    [34, 3],
    [70, 2],
    [104, 6],
    [26, 36],
    [64, 38],
    [100, 35],
    [112, 30],
  ]) {
    r.disc(x, y, 1.2, C.emberCore);
  }
  return r;
}

// ---- Ember and Beacon (16) -------------------------------------------------

function ember() {
  const r = new Raster(16, 16);
  r.poly(
    [
      [5, 8],
      [0.5, 5],
      [2, 8],
      [0.5, 11],
    ],
    C.emberTail,
  );
  r.disc(5.5, 8, 2.2, C.emberTail);
  r.disc(9.5, 8, 5.5, C.emberOuter);
  r.disc(10.5, 8, 3, C.emberCore);
  r.disc(11.5, 7.2, 1.3, C.white);
  return r;
}

function beacon() {
  const r = new Raster(16, 16);
  r.line(8, 0.5, 8, 15.5, C.beaconRay, 1.6);
  r.line(0.5, 8, 15.5, 8, C.beaconRay, 1.6);
  r.line(3, 3, 13, 13, C.beaconRay, 1);
  r.line(13, 3, 3, 13, C.beaconRay, 1);
  r.disc(8, 8, 5, C.beacon);
  r.disc(8, 8, 2.6, C.white);
  return r;
}

// ---- Pin and Hail (12) -----------------------------------------------------

function pin() {
  const r = new Raster(12, 12);
  r.poly(
    [
      [0.5, 4],
      [3.5, 6],
      [0.5, 8],
    ],
    C.steelDark,
  );
  r.line(2, 6, 8.5, 6, C.steel, 2);
  r.poly(
    [
      [8, 4],
      [11.5, 6],
      [8, 8],
    ],
    C.steelLight,
  );
  return r;
}

function hail() {
  const r = new Raster(12, 12);
  r.disc(6, 6, 5.5, C.iceGlow);
  r.line(1.5, 6, 7.5, 6, C.ice, 2.2);
  r.poly(
    [
      [7, 3.5],
      [11.5, 6],
      [7, 8.5],
    ],
    C.white,
  );
  r.set(4, 4, C.white);
  r.set(2, 7, C.white);
  return r;
}

// ---- Lantern and Chandelier (28) ------------------------------------------

function lantern() {
  const r = new Raster(28, 28);
  r.disc(14, 15, 13, C.glowFaint);
  r.polyline(
    [
      [11, 5],
      [12, 1.5],
      [16, 1.5],
      [17, 5],
    ],
    C.brassDark,
    1.5,
  );
  r.poly(
    [
      [8, 8],
      [20, 8],
      [18, 5],
      [10, 5],
    ],
    C.brassDark,
  );
  r.rect(8, 8, 12, 13, C.brass);
  r.rect(10, 10, 8, 9, C.glass);
  r.ellipse(14, 14.5, 2, 3, C.flameOrange);
  r.ellipse(14, 15, 1, 1.8, C.flame);
  r.rect(9, 21, 10, 2, C.brassDark);
  r.rect(13, 23, 2, 2, C.brassDark);
  r.rect(9, 9, 1, 11, C.brassLight);
  return r;
}

function chandelier() {
  const r = new Raster(28, 28);
  r.disc(14, 14, 13.5, C.glow);
  r.line(14, 0.5, 14, 8, C.brassDark, 1.2);
  r.ring(14, 15, 9.5, 7, C.brass);
  r.ring(14, 15, 9.8, 9, C.brassLight);
  for (const [x, y] of [
    [6, 8],
    [14, 5],
    [22, 8],
  ]) {
    r.rect(x - 1, y, 2, 4, C.cream);
    r.rect(x - 1, y - 2, 2, 2, C.flameOrange);
    r.set(x, y - 3, C.flame);
  }
  for (const x of [5, 9.5, 14, 18.5, 23]) {
    r.line(x, 22, x, 26, C.crystal, 1.2);
    r.set(Math.round(x), 27, C.crystalDark);
  }
  return r;
}

// ---- Halo and Corona (160) -------------------------------------------------

function halo() {
  const r = new Raster(160, 160);
  r.disc(80, 80, 72, C.haloFill);
  r.ring(80, 80, 79, 71, C.haloSoft);
  r.ring(80, 80, 77, 73.5, C.haloRing);
  r.ring(80, 80, 75.6, 74.6, C.flame);
  for (const [x, y] of around(80, 80, 75, 12)) {
    r.disc(x, y, 3, C.haloRing);
    r.disc(x, y, 1.4, C.flame);
  }
  return r;
}

function corona() {
  const r = new Raster(160, 160);
  r.disc(80, 80, 64, C.coronaFill);
  r.ring(80, 80, 79, 74, C.coronaRing);
  r.ring(80, 80, 66, 63, C.coronaRing);
  for (const [x, y, a] of around(80, 80, 56, 16)) {
    r.line(
      x,
      y,
      80 + Math.cos(a) * 79,
      80 + Math.sin(a) * 79,
      C.coronaRay,
      2.5,
    );
  }
  for (const [x, y, a] of around(80, 80, 66, 16, TAU / 32)) {
    r.line(
      x,
      y,
      80 + Math.cos(a) * 74,
      80 + Math.sin(a) * 74,
      C.coronaRay,
      1.5,
    );
  }
  r.ring(80, 80, 77, 76, C.white);
  return r;
}

// ---- Oil Splash and Blaze (100) --------------------------------------------

const PUDDLE = [
  [50, 50, 34],
  [22, 38, 12],
  [74, 30, 14],
  [30, 78, 13],
  [80, 72, 12],
  [52, 16, 10],
  [50, 86, 9],
];

function puddle(rim, body) {
  const r = new Raster(100, 100);
  for (const [x, y, radius] of PUDDLE) r.disc(x, y, radius + 2, rim);
  for (const [x, y, radius] of PUDDLE) r.disc(x, y, radius, body);
  return r;
}

function oilSplash() {
  const r = puddle(C.oilRim, C.oil);
  r.ellipse(38, 40, 10, 4, C.oilSheen);
  r.ellipse(60, 62, 6, 3, C.oilSheen);
  r.ellipse(72, 32, 4, 2, C.oilSheen);
  r.disc(35, 38, 1.5, C.white);
  return r;
}

function blaze() {
  const r = puddle(C.blazeRim, C.char);
  r.disc(50, 50, 22, C.blazeGlow);
  for (const [x, y, a] of around(50, 50, 28, 10)) {
    const tx = x + Math.cos(a) * 16;
    const ty = y + Math.sin(a) * 16;
    const px = -Math.sin(a) * 6;
    const py = Math.cos(a) * 6;
    r.poly(
      [
        [x + px, y + py],
        [tx, ty],
        [x - px, y - py],
      ],
      C.flameOrange,
    );
    r.poly(
      [
        [x + px * 0.5, y + py * 0.5],
        [x + (tx - x) * 0.6, y + (ty - y) * 0.6],
        [x - px * 0.5, y - py * 0.5],
      ],
      C.flame,
    );
  }
  r.poly(
    [
      [40, 56],
      [50, 30],
      [60, 56],
    ],
    C.flameOrange,
  );
  r.poly(
    [
      [45, 56],
      [50, 40],
      [55, 56],
    ],
    C.flame,
  );
  return r;
}

// ---- Spark (80 x 4) --------------------------------------------------------

const BOLT = [
  [40, 0.5],
  [33, 12],
  [45, 22],
  [36, 32],
  [40, 40],
];

function spark(tools, out) {
  drawSheet(tools, `${out}/sprites/effects/spark`, 80, 80, 4, (sheet) => {
    const f0 = new Raster(80, 80);
    f0.polyline(BOLT, C.boltGlow, 3.5);
    f0.polyline(BOLT, C.bolt, 1.5);
    f0.disc(40, 40, 4, C.bolt);
    sheet.frame(0, f0);

    const f1 = new Raster(80, 80);
    f1.polyline(BOLT, C.boltGlow, 6);
    f1.polyline(BOLT, C.bolt, 3);
    f1.disc(40, 40, 17, C.boltGlow);
    f1.disc(40, 40, 11, C.bolt);
    for (const [x, y, a] of around(40, 40, 14, 8, TAU / 16)) {
      f1.line(x, y, 40 + Math.cos(a) * 26, 40 + Math.sin(a) * 26, C.bolt, 2);
    }
    sheet.frame(1, f1);

    const f2 = new Raster(80, 80);
    f2.polyline(BOLT, C.boltFaint, 3);
    f2.ring(40, 40, 27, 21, C.boltGlow);
    f2.ring(40, 40, 23, 20.5, C.bolt);
    for (const [x, y] of around(40, 40, 32, 6)) f2.disc(x, y, 2, C.bolt);
    sheet.frame(2, f2);

    const f3 = new Raster(80, 80);
    f3.ring(40, 40, 38, 33, C.boltFaint);
    for (const [x, y] of around(40, 40, 37, 6, TAU / 12)) {
      f3.disc(x, y, 1.5, C.boltGlow);
    }
    sheet.frame(3, f3);
  });
}

// ---- Shard (16) ------------------------------------------------------------

function shard() {
  const r = new Raster(16, 16);
  r.poly(
    [
      [0.5, 8],
      [6, 2.5],
      [15.5, 8],
      [6, 13.5],
    ],
    C.gemCyan,
  );
  r.poly(
    [
      [2.5, 8],
      [6, 4.5],
      [10, 7],
    ],
    C.white,
  );
  r.poly(
    [
      [6, 12],
      [14, 8.5],
      [8, 9.5],
    ],
    C.gemCyanDark,
  );
  return r;
}

// ---- Sconce (24 x 4) -------------------------------------------------------

function sconce(tools, out) {
  drawSheet(tools, `${out}/sprites/effects/sconce`, 24, 24, 4, (sheet) => {
    const r = new Raster(24, 24);
    r.ring(12, 12, 8, 7, C.ironRim);
    r.ring(12, 12, 7, 5, C.iron);
    r.ring(12, 12, 5, 4, C.ironRim);
    // Three spikes, and a flame on the fourth quarter.
    for (const [x, y, a] of around(12, 12, 9, 3, TAU / 4)) {
      const tx = 12 + Math.cos(a) * 11.5;
      const ty = 12 + Math.sin(a) * 11.5;
      r.line(x, y, tx, ty, C.ironRim, 2.4);
      r.line(x, y, tx, ty, C.iron, 1.2);
    }
    r.ellipse(12, 4, 3, 4, C.flameOrange);
    r.ellipse(12, 5, 1.6, 2.6, C.flame);
    sheet.layer("bracket", r, { x: 0, y: 0 });
    [0, 90, 180, 270].forEach((deg, i) => {
      sheet.key("bracket", "rotation", i, deg, "constant");
    });
  });
}

// ---- Flare (128 x 6) -------------------------------------------------------

function flare(tools, out) {
  drawSheet(tools, `${out}/sprites/effects/flare`, 128, 128, 6, (sheet) => {
    const radii = [14, 24, 34, 44, 54, 62];
    const bands = [8, 7, 6, 5, 4, 3];
    const alphas = [255, 230, 200, 160, 110, 60];
    for (let i = 0; i < 6; i += 1) {
      const f = new Raster(128, 128);
      const ring = [...C.flareRing.slice(0, 3), alphas[i]];
      const core = [...C.flareCore.slice(0, 3), alphas[i]];
      f.ring(64, 64, radii[i], radii[i] - bands[i], ring);
      f.ring(64, 64, radii[i] - 1, radii[i] - bands[i] + 2, core);
      // The flash at the center, brightest and largest on the first frame
      // but translucent, since the burst is scaled to the whole view.
      if (i < 2) {
        const flash = [...C.flareCore.slice(0, 3), [190, 120][i]];
        f.disc(64, 64, [20, 11][i], flash);
        f.disc(64, 64, [9, 5][i], core);
      }
      if (i >= 1 && i <= 3) {
        for (const [x, y, a] of around(
          64,
          64,
          radii[i] - 10,
          12,
          (i * TAU) / 24,
        )) {
          const reach = radii[i] + 12;
          f.line(
            x,
            y,
            64 + Math.cos(a) * reach,
            64 + Math.sin(a) * reach,
            core,
            2,
          );
        }
      }
      sheet.frame(i, f);
    }
  });
}

export function produceEffects(tools, out) {
  const fx = `${out}/sprites/effects`;
  drawSprite(tools, `${fx}/taper.png`, taper());
  drawSprite(tools, `${fx}/pyre.png`, pyre());
  drawSprite(tools, `${fx}/ember.png`, ember());
  drawSprite(tools, `${fx}/beacon.png`, beacon());
  drawSprite(tools, `${fx}/pin.png`, pin());
  drawSprite(tools, `${fx}/hail.png`, hail());
  drawSprite(tools, `${fx}/lantern.png`, lantern());
  drawSprite(tools, `${fx}/chandelier.png`, chandelier());
  drawSprite(tools, `${fx}/halo.png`, halo());
  drawSprite(tools, `${fx}/corona.png`, corona());
  drawSprite(tools, `${fx}/oil-splash.png`, oilSplash());
  drawSprite(tools, `${fx}/blaze.png`, blaze());
  drawSprite(tools, `${fx}/shard.png`, shard());
  spark(tools, out);
  sconce(tools, out);
  flare(tools, out);
}
