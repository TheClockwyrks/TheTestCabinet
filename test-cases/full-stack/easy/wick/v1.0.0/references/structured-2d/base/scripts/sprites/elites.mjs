// Wick — the two elites and the Dark (specs/assets.md "The sprites").
//
// Each reads as larger and heavier than any common: the Mothwing is a giant
// moth with eyespots on wings that fold toward its body, the Owl is a broad
// round bird whose wings the sheet's layers swing at the shoulder, and the
// Dark is a black mass of eyes whose tendrils the sheet's layers turn, one
// fifth of a revolution across the four frames so the spin wraps.

import { C } from "./palette.mjs";
import { Raster, drawSheet } from "./raster.mjs";

const POSES = [0, 1, 2, 1];

function fold(points, axis, s) {
  return points.map(([x, y]) => [axis - (axis - x) * s, y]);
}

// ---- Mothwing (56) ---------------------------------------------------------

function mothwing(pose) {
  const r = new Raster(56, 56);
  const s = [1, 0.78, 0.55][pose];
  const upper = fold(
    [
      [25, 18],
      [10, 4],
      [2, 10],
      [1.5, 22],
      [8, 30],
      [24, 30],
    ],
    28,
    s,
  );
  const lower = fold(
    [
      [25, 30],
      [10, 34],
      [8, 46],
      [16, 52],
      [26, 44],
    ],
    28,
    s,
  );
  r.poly(upper, C.mothwing);
  r.poly(lower, C.mothwing);
  // Veins from the shoulder to the wing's edge.
  for (const [x, y] of [upper[1], upper[2], upper[3], upper[4]]) {
    r.line(25, 19, x, y, C.mothwingDark, 1);
  }
  for (const [x, y] of [lower[1], lower[2], lower[3]]) {
    r.line(25, 30, x, y, C.mothwingDark, 1);
  }
  const [[ex, ey]] = fold([[10, 17]], 28, s);
  r.disc(ex, ey, 5.5 * s + 0.5, C.eyespotRing);
  r.disc(ex, ey, 4.2 * s + 0.4, C.eyespot);
  r.disc(ex, ey, 1.8 * s + 0.3, C.eyespotCore);
  const [[lx, ly]] = fold([[14, 42]], 28, s);
  r.disc(lx, ly, 3 * s + 0.4, C.eyespotRing);
  r.disc(lx, ly, 1.8 * s + 0.3, C.eyespot);
  r.mirror(28);
  r.ellipse(28, 31, 5, 16, C.mothwingBody);
  for (let y = 20; y < 46; y += 4) r.rect(24, y, 8, 1, C.mothwingStripe);
  r.disc(28, 12, 5.2, C.mothwingBody);
  r.disc(25.5, 11.5, 1.6, C.amberEye);
  r.disc(30.5, 11.5, 1.6, C.amberEye);
  r.line(26, 8, 18, 1.5, C.mothwingDark, 1.2);
  r.line(30, 8, 38, 1.5, C.mothwingDark, 1.2);
  for (let i = 1; i <= 4; i += 1) {
    r.line(
      26 - i * 1.8,
      8 - i * 1.5,
      25 - i * 1.8,
      5 - i * 1.5,
      C.mothwingDark,
      1,
    );
    r.line(
      30 + i * 1.8,
      8 - i * 1.5,
      31 + i * 1.8,
      5 - i * 1.5,
      C.mothwingDark,
      1,
    );
  }
  r.rim(C.rimPale);
  return r;
}

// ---- Owl (72) --------------------------------------------------------------

function owlBody() {
  const r = new Raster(72, 72);
  r.ellipse(36, 42, 21, 25, C.owl);
  r.ellipse(36, 47, 13, 16, C.owlBreast);
  // The breast's speckles, chevrons down the front.
  for (let y = 36; y < 60; y += 6) {
    for (let x = 28; x <= 44; x += 8) {
      r.polyline(
        [
          [x - 2, y],
          [x, y + 2],
          [x + 2, y],
        ],
        C.owlSpeckle,
        1,
      );
    }
  }
  r.disc(36, 22, 18, C.owl);
  r.poly(
    [
      [22, 10],
      [17, 0.5],
      [29, 8],
    ],
    C.owlDark,
  );
  r.disc(27, 23, 9, C.owlFace);
  r.disc(27, 23, 6, C.owlEye);
  r.disc(27.5, 23.5, 3, C.owlPupil);
  r.disc(25.5, 21.5, 1.2, C.white);
  for (const [x0, x1] of [
    [28, 26],
    [30, 30],
    [32, 34],
  ]) {
    r.line(x0, 65, x1, 70, C.owlBeak, 1.6);
  }
  r.mirror(36);
  r.poly(
    [
      [36, 27],
      [32.5, 26],
      [36, 34],
      [39.5, 26],
    ],
    C.owlBeak,
  );
  r.rim(C.rimWarm);
  return r;
}

function owlWing() {
  const r = new Raster(44, 44);
  r.poly(
    [
      [22, 19],
      [5, 14],
      [1, 22],
      [3, 34],
      [12, 40],
      [22, 33],
    ],
    C.owlDark,
  );
  // Feathers along the trailing edge.
  for (const [x, y] of [
    [3, 30],
    [7, 37],
    [13, 40],
  ]) {
    r.line(22, 26, x, y, C.owl, 1.2);
  }
  r.rim(C.rimWarm);
  return r;
}

function owl(tools, out) {
  drawSheet(tools, `${out}/sprites/enemies/owl`, 72, 72, 4, (sheet) => {
    const left = owlWing();
    const right = owlWing();
    right.mirror(22);
    // Each wing's layer is centered on its shoulder, so rotating it swings
    // the wing there.
    sheet.layer("wing-left", left, { x: 6, y: 4, z: 0 });
    sheet.layer("wing-right", right, { x: 22, y: 4, z: 0 });
    sheet.layer("body", owlBody(), { x: 0, y: 0, z: 1 });
    const swing = [25, 0, -25, 0];
    swing.forEach((deg, i) => {
      sheet.key("wing-left", "rotation", i, deg, "constant");
      sheet.key("wing-right", "rotation", i, -deg, "constant");
    });
  });
}

// ---- The Dark (80) ---------------------------------------------------------

function darkArms() {
  const r = new Raster(80, 80);
  const arms = 5;
  const steps = 8;
  for (let k = 0; k < arms; k += 1) {
    const base = (k * 2 * Math.PI) / arms;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const angle = base + t * 1.1;
      const radius = 12 + t * 26;
      points.push([
        40 + Math.cos(angle) * radius,
        40 + Math.sin(angle) * radius,
      ]);
    }
    for (let i = 1; i <= steps; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      r.line(x0, y0, x1, y1, C.darkArmRim, 13 - (i / steps) * 9);
    }
    for (let i = 1; i <= steps; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      r.line(x0, y0, x1, y1, C.darkArm, Math.max(1.5, 10 - (i / steps) * 8));
    }
  }
  return r;
}

/** The body: a lumpy mass with a violet edge and a haze about it. */
function darkCore() {
  const r = new Raster(80, 80);
  const lumps = [];
  for (let i = 0; i < 9; i += 1) {
    const a = (i * 2 * Math.PI) / 9 + 0.3;
    const d = 15 + (i % 3) * 2.5;
    lumps.push([
      40 + Math.cos(a) * d,
      40 + Math.sin(a) * d,
      10 + (i % 2) * 2.5,
    ]);
  }
  for (const [x, y, size] of lumps) r.disc(x, y, size + 3, C.darkHaze);
  for (const [x, y, size] of lumps) r.disc(x, y, size + 1.5, C.darkRim);
  for (const [x, y, size] of lumps) r.disc(x, y, size, C.darkBody);
  r.disc(40, 40, 19, C.dark);
  for (const [x, y, size] of lumps) r.disc(x, y, size - 3, C.dark);
  return r;
}

const DARK_EYES = [
  [40, 28, 3.6],
  [28, 36, 2.8],
  [52, 34, 3.2],
  [34, 48, 2.6],
  [48, 49, 3.4],
  [42, 39, 2],
  [24, 47, 1.8],
  [56, 45, 1.8],
];

function darkEyesOpen() {
  const r = new Raster(80, 80);
  for (const [x, y, size] of DARK_EYES) {
    r.ellipse(x, y, size + 0.6, size * 0.8, C.darkRim);
    r.ellipse(x, y, size, size * 0.66, C.darkEye);
    r.ellipse(x + 0.3, y, size * 0.4, size * 0.5, C.darkPupil);
  }
  return r;
}

function darkEyesShut() {
  const r = new Raster(80, 80);
  for (const [x, y, size] of DARK_EYES) {
    r.line(x - size, y, x + size, y, C.darkRim, 2);
    r.line(x - size + 0.5, y, x + size - 0.5, y, C.darkEye, 1);
  }
  return r;
}

function dark(tools, out) {
  drawSheet(tools, `${out}/sprites/enemies/dark`, 80, 80, 4, (sheet) => {
    sheet.layer("arms", darkArms(), { x: 0, y: 0, z: 0 });
    sheet.layer("core", darkCore(), { x: 0, y: 0, z: 1 });
    sheet.layer("eyes-open", darkEyesOpen(), { x: 0, y: 0, z: 2 });
    sheet.layer("eyes-shut", darkEyesShut(), { x: 0, y: 0, z: 2, opacity: 0 });
    // Five arms turn a fifth of a revolution over the four frames.
    [0, 18, 36, 54].forEach((deg, i) => {
      sheet.key("arms", "rotation", i, deg, "constant");
    });
    // The eyes blink shut on the third frame.
    sheet.key("eyes-open", "opacity", 0, 255, "constant");
    sheet.key("eyes-open", "opacity", 2, 0, "constant");
    sheet.key("eyes-open", "opacity", 3, 255, "constant");
    sheet.key("eyes-shut", "opacity", 0, 0, "constant");
    sheet.key("eyes-shut", "opacity", 2, 255, "constant");
    sheet.key("eyes-shut", "opacity", 3, 0, "constant");
  });
}

export function produceElites(tools, out) {
  drawSheet(tools, `${out}/sprites/enemies/mothwing`, 56, 56, 4, (sheet) => {
    POSES.forEach((p, i) => sheet.frame(i, mothwing(p)));
  });
  owl(tools, out);
  dark(tools, out);
}
