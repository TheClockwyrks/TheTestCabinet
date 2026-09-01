// Wick — the ten common enemies, each a four-frame walk cycle on a canvas
// twice its radius (specs/assets.md "The sprites").
//
// Every one is told from every other by its form: the moth is wide wings on
// a slip of a body, the bat is a scalloped membrane with ears, the rat is
// long and low with a tail, the gnat is a speck in a blur of wings, the
// beetle is a domed shell on six legs, the wisp is a flame with a face, the
// spider is eight legs about a small body, the crow is a beak and a spread
// wing, the shade is a hooded robe with no legs, and the hound is a running
// dog. The four frames are four phases of one cycle, up, falling, down, and
// rising, each a picture of its own so the cycle wraps without repeating.
// Fliers face the camera and are symmetric; walkers face right and are
// mirrored in code.

import { C } from "./palette.mjs";
import { Raster, drawSheet } from "./raster.mjs";

const FRAMES = 4;

function walkCycle(tools, out, id, size, pose) {
  const sheetPath = `${out}/sprites/enemies/${id}`;
  drawSheet(tools, sheetPath, size, size, FRAMES, (sheet) => {
    for (let i = 0; i < FRAMES; i += 1) sheet.frame(i, pose(i));
  });
}

/** The value the pose's frame carries, one per frame in cycle order. */
function at(pose, up, falling, down, rising) {
  return [up, falling, down, rising][pose];
}

/** Scale a polygon's `x` coordinates toward `axis` by `s`. */
function fold(points, axis, s) {
  return points.map(([x, y]) => [axis - (axis - x) * s, y]);
}

// ---- Moth (20) -------------------------------------------------------------

function moth(pose) {
  const r = new Raster(20, 20);
  const s = at(pose, 1, 0.72, 0.42, 0.86);
  const upper = fold(
    [
      [9, 7],
      [2, 3],
      [1, 8],
      [4, 11],
      [9, 11],
    ],
    10,
    s,
  );
  const lower = fold(
    [
      [9, 11],
      [4, 12],
      [5, 16],
      [9, 15],
    ],
    10,
    s,
  );
  r.poly(upper, C.dust);
  r.poly(lower, C.dust);
  const [sx] = fold([[4.5, 7]], 10, s)[0];
  r.disc(sx, 7.5, 1.6 * s + 0.4, C.dustDark);
  r.mirror(10);
  r.ellipse(10, 11, 2.2, 5.5, C.dustBody);
  r.disc(10, 5.5, 2.2, C.dustBody);
  r.line(9, 4, 6, 1, C.dustDark, 1);
  r.line(11, 4, 14, 1, C.dustDark, 1);
  r.set(9, 5, C.amberEye);
  r.set(10, 5, C.amberEye);
  r.rim(C.dustDark);
  return r;
}

// ---- Bat (20) --------------------------------------------------------------

function bat(pose) {
  const r = new Raster(20, 20);
  const wing = [
    [
      [8, 8],
      [1, 2],
      [1, 7],
      [3, 9],
      [5, 10],
      [8, 12],
    ],
    [
      [8, 8],
      [1, 6],
      [1, 10],
      [3, 11],
      [5, 11],
      [8, 12],
    ],
    [
      [8, 8],
      [2, 11],
      [2, 15],
      [4, 15],
      [6, 14],
      [8, 12],
    ],
    [
      [8, 8],
      [1.5, 8],
      [1.5, 12],
      [3, 13],
      [5, 12.5],
      [8, 12],
    ],
  ][pose];
  r.poly(wing, C.batWing);
  // The fingers through the membrane.
  r.line(8, 8, wing[1][0], wing[1][1], C.batLight, 1);
  r.line(8, 8, wing[3][0], wing[3][1], C.batLight, 1);
  r.mirror(10);
  r.ellipse(10, 11, 2.8, 4, C.batBody);
  r.disc(10, 6, 2.6, C.batBody);
  r.poly(
    [
      [8, 4.5],
      [7, 1],
      [9.5, 4],
    ],
    C.batBody,
  );
  r.poly(
    [
      [12, 4.5],
      [13, 1],
      [10.5, 4],
    ],
    C.batBody,
  );
  r.set(9, 6, C.redEye);
  r.set(11, 6, C.redEye);
  r.rim(C.batLight);
  return r;
}

// ---- Rat (24) --------------------------------------------------------------

function rat(pose) {
  const r = new Raster(24, 24);
  const tail = [
    [
      [3, 14],
      [1, 11],
      [1.5, 7],
      [4, 5],
    ],
    [
      [3, 14],
      [0.5, 12],
      [0.5, 8],
    ],
    [
      [3, 14],
      [1, 15],
      [1.5, 19],
      [4, 21],
    ],
    [
      [3, 14],
      [0.5, 16],
      [2, 19],
    ],
  ][pose];
  r.polyline(tail, C.pink, 1.3);
  // Legs: the near pair swings with the pose, the far pair against it.
  const swing = at(pose, 2, 0, -2, 1);
  r.line(7, 17, 7 - swing, 21, C.furDark, 2);
  r.line(16, 17, 16 + swing, 21, C.furDark, 2);
  r.line(9, 17, 9 + swing, 21, C.fur, 2);
  r.line(18, 17, 18 - swing, 21, C.fur, 2);
  r.ellipse(11, 14, 8, 4.5, C.fur);
  r.ellipse(11, 15.5, 6, 2.5, C.furLight);
  r.ellipse(17.5, 12, 4.5, 3.2, C.fur);
  r.poly(
    [
      [20, 10.5],
      [23.5, 13],
      [20, 14.5],
    ],
    C.fur,
  );
  r.disc(15.5, 8.5, 2, C.fur);
  r.disc(15.5, 8.5, 1, C.pink);
  r.set(23, 12, C.pink);
  r.set(19, 11, C.ink);
  r.rim(C.furDark);
  return r;
}

// ---- Gnat (16) -------------------------------------------------------------

function gnat(pose) {
  const r = new Raster(16, 16);
  r.ellipse(8, 9, 1.6, 3.5, C.gnatBody);
  r.disc(8, 5, 1.8, C.gnatBody);
  r.line(7, 11, 5, 14, C.gnatDark, 1);
  r.line(9, 11, 11, 14, C.gnatDark, 1);
  r.rim(C.gnatDark);
  r.set(7, 5, C.redEye);
  r.set(9, 5, C.redEye);
  const [wx, wy, rx, ry] = [
    [4, 7, 3.5, 1.3],
    [4.5, 8, 3, 1.9],
    [5, 9.5, 2.5, 1.6],
    [4.2, 8.8, 3.2, 1.2],
  ][pose];
  r.ellipse(wx, wy, rx, ry, C.gnatWing);
  r.ellipse(16 - wx, wy, rx, ry, C.gnatWing);
  return r;
}

// ---- Beetle (28) -----------------------------------------------------------

function beetle(pose) {
  const r = new Raster(28, 28);
  const stride = at(pose, 2, 0, -2, 1);
  const legs = [
    [
      [7, 10],
      [3, 8 - stride],
      [1, 5 - stride],
    ],
    [
      [6, 15],
      [2, 15 + stride],
      [0.5, 13 + stride],
    ],
    [
      [7, 20],
      [3, 22 - stride],
      [1.5, 26 - stride],
    ],
  ];
  for (const leg of legs) r.polyline(leg, C.leg, 1.6);
  r.line(12, 4, 9, 1, C.leg, 1);
  r.line(11, 3.5, 8, 4, C.shellLight, 1);
  r.mirror(14);
  r.disc(14, 5.5, 3.2, C.shellDark);
  r.ellipse(14, 15.5, 9, 11, C.shellLight);
  r.ellipse(14, 15.5, 7.5, 9.5, C.shell);
  r.line(14, 6.5, 14, 25, C.shellDark, 1);
  r.line(9.5, 9, 8.5, 18, C.shellHighlight, 1.4);
  r.set(12, 5, C.amberEye);
  r.set(15, 5, C.amberEye);
  r.rim(C.leg);
  return r;
}

// ---- Wisp (20) -------------------------------------------------------------

function wisp(pose) {
  const r = new Raster(20, 20);
  const tip = at(pose, 10, 13, 7, 11.5);
  r.ring(10, 13, 8, 6, C.wispOuter);
  r.disc(10, 13, 5.5, C.wispOuter);
  r.poly(
    [
      [5, 13],
      [tip, 1],
      [15, 13],
    ],
    C.wispOuter,
  );
  r.disc(10, 13.5, 3.8, C.wispMid);
  r.poly(
    [
      [7, 13],
      [tip, 5],
      [13, 13],
    ],
    C.wispMid,
  );
  r.disc(10, 14, 1.9, C.wispCore);
  r.poly(
    [
      [8.5, 13],
      [tip, 8],
      [11.5, 13],
    ],
    C.wispCore,
  );
  r.set(8, 12, C.wispEye);
  r.set(12, 12, C.wispEye);
  r.set(8, 13, C.wispEye);
  r.set(12, 13, C.wispEye);
  return r;
}

// ---- Spider (28) -----------------------------------------------------------

function spider(pose) {
  const r = new Raster(28, 28);
  const legs = [
    [
      [
        [12, 10],
        [5, 4],
        [1, 7],
      ],
      [
        [12, 11],
        [3, 10],
        [0.5, 14],
      ],
      [
        [12, 12],
        [4, 17],
        [1, 23],
      ],
      [
        [12, 13],
        [7, 21],
        [5, 27],
      ],
    ],
    [
      [
        [12, 10],
        [4.5, 5],
        [0.5, 8.5],
      ],
      [
        [12, 11],
        [3, 11],
        [0.5, 15.5],
      ],
      [
        [12, 12],
        [4.5, 18],
        [2, 24],
      ],
      [
        [12, 13],
        [7.5, 21.5],
        [6, 27],
      ],
    ],
    [
      [
        [12, 10],
        [4, 6],
        [0.5, 10],
      ],
      [
        [12, 11],
        [3, 12],
        [1, 17],
      ],
      [
        [12, 12],
        [5, 19],
        [3, 25],
      ],
      [
        [12, 13],
        [8, 22],
        [7, 27],
      ],
    ],
    [
      [
        [12, 10],
        [4.5, 4.5],
        [1, 8],
      ],
      [
        [12, 11],
        [3, 10.5],
        [0.5, 13],
      ],
      [
        [12, 12],
        [4, 17.5],
        [1.5, 23.5],
      ],
      [
        [12, 13],
        [7, 21],
        [5.5, 27],
      ],
    ],
  ][pose];
  for (const leg of legs) r.polyline(leg, C.spiderLeg, 1.6);
  r.mirror(14);
  r.disc(14, 18, 6, C.spiderBody);
  r.disc(14, 9.5, 4, C.spiderBody);
  r.poly(
    [
      [12, 15],
      [16, 15],
      [14, 18],
    ],
    C.spiderMark,
  );
  r.poly(
    [
      [12, 21],
      [16, 21],
      [14, 18],
    ],
    C.spiderMark,
  );
  for (const [x, y] of [
    [12, 8],
    [13, 7],
    [15, 7],
    [16, 8],
  ]) {
    r.set(x, y, C.redEye);
  }
  r.rim(C.spiderRim);
  return r;
}

// ---- Crow (24) -------------------------------------------------------------

function crow(pose) {
  const r = new Raster(24, 24);
  const wing = [
    [
      [8, 12],
      [3, 2],
      [13, 3],
      [15, 11],
    ],
    [
      [8, 11],
      [1, 7],
      [0.5, 10],
      [15, 12],
    ],
    [
      [8, 12],
      [4, 21],
      [11, 22],
      [15, 13],
    ],
    [
      [8, 12],
      [2, 15],
      [1, 18],
      [15, 13],
    ],
  ][pose];
  r.ellipse(11, 14, 6.5, 3.5, C.crow);
  r.poly(
    [
      [5, 13],
      [0.5, 11],
      [0.5, 16],
      [5, 16],
    ],
    C.crow,
  );
  r.poly(wing, C.crow);
  r.line(wing[0][0], wing[0][1], wing[1][0], wing[1][1], C.crowLight, 1);
  r.disc(17, 10, 3.2, C.crow);
  r.poly(
    [
      [19.5, 9],
      [23.5, 10.5],
      [19.5, 12],
    ],
    C.beak,
  );
  r.set(18, 9, C.white);
  r.rim(C.crowRim);
  return r;
}

// ---- Shade (32) ------------------------------------------------------------

function shade(pose) {
  const r = new Raster(32, 32);
  const dy = at(pose, 0, -1, 0, 1);
  const sway = at(pose, -1, 0, 1, 0);
  const hem = [];
  for (let x = 28, i = 0; x >= 4; x -= 3, i += 1) {
    hem.push([x + sway * (i % 2 === 0 ? 1 : -1), i % 2 === 0 ? 27 : 30.5]);
  }
  r.poly(
    [
      [16, 1 + dy],
      [8, 12 + dy],
      [6, 17 + dy],
      [26, 17 + dy],
      [24, 12 + dy],
    ],
    C.shade,
  );
  r.poly(
    [[6, 17 + dy], [26, 17 + dy], ...hem.map(([x, y]) => [x, y + dy])],
    C.shade,
  );
  r.line(12, 18 + dy, 10, 28 + dy, C.shadeFold, 1);
  r.line(16, 18 + dy, 16, 29 + dy, C.shadeFold, 1);
  r.line(20, 18 + dy, 22, 28 + dy, C.shadeFold, 1);
  r.ellipse(16, 11.5 + dy, 4.5, 5, C.shadeVoid);
  r.rim(C.shadeRim);
  r.disc(13.5, 10.5 + dy, 1.2, C.shadeEye);
  r.disc(18.5, 10.5 + dy, 1.2, C.shadeEye);
  return r;
}

// ---- Hound (36) ------------------------------------------------------------

function hound(pose) {
  const r = new Raster(36, 36);
  const legs = [
    [
      [24, 22, 30, 29],
      [22, 22, 26, 30],
      [9, 22, 3, 29],
      [11, 22, 7, 30],
    ],
    [
      [24, 22, 25, 30],
      [21, 22, 22, 30],
      [9, 22, 8, 30],
      [12, 22, 12, 30],
    ],
    [
      [24, 22, 21, 29],
      [22, 22, 18, 29],
      [9, 22, 13, 29],
      [11, 22, 16, 30],
    ],
    [
      [24, 22, 27, 30],
      [22, 22, 24, 30],
      [9, 22, 6, 30],
      [11, 22, 10, 30],
    ],
  ][pose];
  legs.forEach(([x0, y0, x1, y1], i) => {
    r.line(x0, y0, x1, y1, i % 2 === 0 ? C.houndDark : C.hound, 3);
    r.set(Math.round(x1), Math.round(y1), C.houndRim);
  });
  const tailTip = at(pose, 7, 9, 11, 8);
  r.polyline(
    [
      [6, 16],
      [2, 11],
      [1.5, tailTip],
    ],
    C.hound,
    2,
  );
  r.ellipse(16, 19, 11, 5.5, C.hound);
  r.disc(24, 19, 5, C.hound);
  r.disc(8, 19, 5.5, C.hound);
  r.ellipse(16, 21.5, 7, 2.5, C.houndLight);
  r.poly(
    [
      [22, 15],
      [29, 9],
      [32, 14],
      [26, 21],
    ],
    C.hound,
  );
  r.ellipse(29, 12, 5, 3.6, C.hound);
  r.poly(
    [
      [31, 10.5],
      [35.5, 12.5],
      [31, 14.5],
    ],
    C.hound,
  );
  r.poly(
    [
      [26, 9],
      [24, 4],
      [28, 8],
    ],
    C.houndDark,
  );
  r.line(31, 14, 34.5, 13.5, C.houndDark, 1);
  r.set(32, 14, C.tooth);
  r.set(34, 13, C.tooth);
  r.set(35, 12, C.ink);
  r.set(30, 11, C.redEye);
  r.rim(C.houndRim);
  return r;
}

export function produceCommons(tools, out) {
  walkCycle(tools, out, "moth", 20, moth);
  walkCycle(tools, out, "bat", 20, bat);
  walkCycle(tools, out, "rat", 24, rat);
  walkCycle(tools, out, "gnat", 16, gnat);
  walkCycle(tools, out, "beetle", 28, beetle);
  walkCycle(tools, out, "wisp", 20, wisp);
  walkCycle(tools, out, "spider", 28, spider);
  walkCycle(tools, out, "crow", 24, crow);
  walkCycle(tools, out, "shade", 32, shade);
  walkCycle(tools, out, "hound", 36, hound);
}
