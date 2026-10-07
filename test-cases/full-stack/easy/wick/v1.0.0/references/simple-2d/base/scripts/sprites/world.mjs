// Wick — the lamplighter, the ground, the gems, the pickups, and the puff.
//
// The lamplighter is drawn facing right and mirrored in code; his lamp hangs
// from a pole held out on the facing side, so the lamp always leads. The walk
// sheet's six frames are two half-strides of three, a contact, a low, and a
// passing pose, each half leading with the other leg, with the body dipping
// through the low frames and the lamp swinging a pixel behind it.

import { C } from "./palette.mjs";
import { Raster, drawSheet, drawSprite } from "./raster.mjs";

// ---- The lamplighter -------------------------------------------------------

const LAMPLIGHTER = {
  H: C.hat,
  h: C.hatBand,
  F: C.skin,
  f: C.skinShade,
  E: C.eye,
  S: C.scarf,
  s: C.scarfDark,
  C: C.coat,
  c: C.coatDark,
  L: C.coatLight,
  A: C.skin,
  B: C.boot,
  P: C.pole,
};

const LAMP = {
  L: C.brass,
  d: C.brassDark,
  g: C.glass,
  f: C.flame,
  o: C.flameOrange,
  l: C.brassLight,
};

// Rows 0..23 of the 24x32 canvas: the hat, face, scarf, and coat.
const BODY = [
  "........HHHHHHH.........",
  ".......HHHHHHHHH........",
  ".......HhhhhhhhH........",
  ".....HHHHHHHHHHHHH......",
  "........FFFFFFF.........",
  "........FFFEFFE.........",
  "........fFFFFFF.........",
  ".........fFFFF..........",
  ".......SSSSSSSSS........",
  "......SSsSCCCsSSS.......",
  "......CCCCCCCCCCC..PP...",
  ".....CCCLCCCCCCCCAAP....",
  ".....CCCLCCCCCCCCA.P....",
  ".....CcCLCCCCCCCcC.P....",
  ".....CcCLCCCCCCCcC.P....",
  ".....CcCCCCCCCCCcC......",
  ".....CCCCCCCCCCCCC......",
  "......CCCCCCCCCCC.......",
  "......CCCCCCCCCCC.......",
  "......cCCCCCCCCCc.......",
  "......cCCCCCCCCCc.......",
  "......cCCCCCCCCCc.......",
  "......cCCCCCCCCCc.......",
  ".......CCCCCCCCC........",
];

// The lamp, 6 wide by 7 tall, hung from the pole's end.
const LANTERN = [
  "..dd..",
  ".LddL.",
  "LggggL",
  "LgoogL",
  "LgffgL",
  "LggggL",
  "dLLLLd",
];

// Rows 24..29: the legs, in each of the walk's poses.
const LEGS = {
  stand: [
    ".......cc...cc..........",
    ".......cc...cc..........",
    ".......cc...cc..........",
    ".......cc...cc..........",
    "......BBB...BBB.........",
    "......BBBB..BBBB........",
  ],
  strideA: [
    ".......cc...CC..........",
    "......cc.....CC.........",
    ".....cc.......CC........",
    "....cc.........CC.......",
    "...BBB..........BBB.....",
    "...BBBB.........BBBB....",
  ],
  strideB: [
    ".......CC...cc..........",
    "......CC.....cc.........",
    ".....CC.......cc........",
    "....CC.........cc.......",
    "...BBB..........BBB.....",
    "...BBBB.........BBBB....",
  ],
  lowA: [
    ".......cc...CC..........",
    ".......cc....CC.........",
    "......cc......CC........",
    "......cc......CC........",
    ".....BBB......BBB.......",
    ".....BBBB.....BBBB......",
  ],
  lowB: [
    ".......CC...cc..........",
    ".......CC....cc.........",
    "......CC......cc........",
    "......CC......cc........",
    ".....BBB......BBB.......",
    ".....BBBB.....BBBB......",
  ],
  passA: [
    ".......cc...CC..........",
    ".......cc..CC...........",
    "........ccCC............",
    "........cCCC............",
    ".......BBBB.............",
    ".......BBBBB............",
  ],
  passB: [
    ".......CC...cc..........",
    ".......CC..cc...........",
    "........CCcc............",
    "........Cccc............",
    ".......BBBB.............",
    ".......BBBBB............",
  ],
};

function lamplighter(legs, bodyDy, lampDy) {
  const r = new Raster(24, 32);
  r.bitmap(0, bodyDy, BODY, LAMPLIGHTER);
  r.bitmap(0, 24, LEGS[legs], LAMPLIGHTER);
  r.bitmap(17, 14 + bodyDy + lampDy, LANTERN, LAMP);
  // The lamp's light on the glass and the coat's shoulder.
  r.set(12, 11 + bodyDy, C.coatLight);
  return r;
}

export function produceLamplighter(tools, out) {
  drawSprite(
    tools,
    `${out}/sprites/lamplighter/idle.png`,
    lamplighter("stand", 0, 0),
  );
  const frames = [
    ["strideA", 0, 1],
    ["lowA", 1, 1],
    ["passA", -1, 0],
    ["strideB", 0, 1],
    ["lowB", 1, 1],
    ["passB", -1, 0],
  ];
  drawSheet(tools, `${out}/sprites/lamplighter/walk`, 24, 32, 6, (sheet) => {
    frames.forEach(([legs, dy, lampDy], i) => {
      sheet.frame(i, lamplighter(legs, dy, lampDy));
    });
  });
}

// ---- The ground ------------------------------------------------------------

/** A 64x64 cobblestone tile that wraps on every edge. */
export function produceGround(tools, out) {
  const r = new Raster(64, 64);
  r.rect(0, 0, 64, 64, C.mortar);
  const stones = [C.stoneA, C.stoneB, C.stoneC, C.stoneB, C.stoneA, C.stoneC];
  let n = 0;
  for (let row = 0; row < 4; row += 1) {
    const offset = row % 2 === 0 ? 0 : 8;
    for (let col = 0; col < 4; col += 1) {
      const x = col * 16 + offset + 1;
      const y = row * 16 + 1;
      const body = stones[n % stones.length];
      n += 1;
      // The stone: a 14x14 block with its corners knocked off.
      r.rectWrapped(x + 1, y, 12, 14, body);
      r.rectWrapped(x, y + 1, 14, 12, body);
      // A lit top-left edge and a shadowed bottom-right one.
      r.rectWrapped(x + 1, y, 12, 1, C.stoneLight);
      r.rectWrapped(x, y + 1, 1, 12, C.stoneLight);
      r.rectWrapped(x + 1, y + 13, 12, 1, C.stoneDark);
      r.rectWrapped(x + 13, y + 1, 1, 12, C.stoneDark);
      // A chip or two of wear, placed by the stone's index.
      r.setWrapped(x + 3 + ((n * 5) % 8), y + 4 + ((n * 3) % 7), C.stoneDark);
      r.setWrapped(x + 9 - ((n * 3) % 6), y + 9 - ((n * 7) % 5), C.stoneLight);
    }
  }
  // Moss in a few of the seams.
  for (const [x, y] of [
    [16, 8],
    [40, 24],
    [8, 40],
    [56, 56],
    [32, 48],
  ]) {
    r.setWrapped(x, y, C.moss);
    r.setWrapped(x + 1, y, C.moss);
    r.setWrapped(x, y + 1, C.moss);
  }
  drawSprite(tools, `${out}/sprites/ground.png`, r);
}

// ---- Gems ------------------------------------------------------------------

function gemSmall() {
  const r = new Raster(8, 8);
  r.bitmap(
    0,
    0,
    [
      "...cc...",
      "..cWcc..",
      ".cWcccc.",
      "cWcccccd",
      "cccccddd",
      ".ccdddd.",
      "..cddd..",
      "...dd...",
    ],
    { c: C.gemCyan, d: C.gemCyanDark, W: C.white },
  );
  return r;
}

function gemMedium() {
  const r = new Raster(12, 12);
  r.bitmap(
    0,
    0,
    [
      "....gggg....",
      "..ggWWgggg..",
      ".gWWggggggg.",
      "gWWgggggggdg",
      "gWgggggggddg",
      "gggggggggddg",
      "gggggggdddgg",
      "ggggggddddgg",
      "ggggdddddddg",
      ".ggddddddddd",
      "..gdddddddd.",
      "....dddd....",
    ],
    { g: C.gemGreen, d: C.gemGreenDark, W: C.white },
  );
  return r;
}

function gemLarge() {
  const r = new Raster(16, 16);
  r.bitmap(
    0,
    0,
    [
      ".....gggggg.....",
      "...ggLLggggggg..",
      "..gLLLggggggggg.",
      ".gLLLgggggggggdg",
      ".gLLggggggggggdg",
      "gLLggggggggggddg",
      "gLgggggggggggddg",
      "gggggggggggdddgg",
      "ggggggggggddddgg",
      "gggggggggddddddg",
      "gggggggddddddddg",
      ".gggggddddddddd.",
      ".ggggddddddddddd",
      "..ggddddddddddd.",
      "...gddddddddddd.",
      ".....dddddd.....",
    ],
    { g: C.gemGold, d: C.gemGoldDark, L: C.gemGoldLight },
  );
  r.set(3, 3, C.white);
  r.set(4, 2, C.white);
  return r;
}

export function produceGems(tools, out) {
  drawSprite(tools, `${out}/sprites/gems/small.png`, gemSmall());
  drawSprite(tools, `${out}/sprites/gems/medium.png`, gemMedium());
  drawSprite(tools, `${out}/sprites/gems/large.png`, gemLarge());
}

// ---- Pickups ---------------------------------------------------------------

function chest() {
  const r = new Raster(24, 24);
  const k = {
    w: C.wood,
    d: C.woodDark,
    l: C.woodLight,
    g: C.brass,
    G: C.brassLight,
    b: C.brassDark,
    r: C.rimWarm,
  };
  r.bitmap(
    0,
    0,
    [
      "........................",
      "........................",
      "........................",
      "....rrrrrrrrrrrrrrrr....",
      "...rlllllllllllllllllr..",
      "..rllwwwwwwwwwwwwwwwllr.",
      "..rlwwwwwwwwwwwwwwwwwlr.",
      "..rbbbbbbbbGGbbbbbbbbbr.",
      "..rggggggggGGggggggggggr",
      "..rbbbbbbbGbbGbbbbbbbbr.",
      "..rwwwwwwwGbbGwwwwwwwwr.",
      "..rwwwwwwwwGGwwwwwwwwwr.",
      "..rddwwwwwwwwwwwwwwwddr.",
      "..rddwwwwwwwwwwwwwwwddr.",
      "..rddwwwwwwwwwwwwwwwddr.",
      "..rddwwwwwwwwwwwwwwwddr.",
      "..rdddddddddddddddddddr.",
      "..rrrrrrrrrrrrrrrrrrrrr.",
      "........................",
      "........................",
      "........................",
      "........................",
      "........................",
      "........................",
    ],
    k,
  );
  return r;
}

function bread() {
  const r = new Raster(24, 24);
  r.ellipse(12, 13, 10, 6, C.bread);
  r.ellipse(12, 11.5, 9, 4.5, C.breadLight);
  r.ellipse(12, 12.5, 8.5, 4, C.bread);
  // Three scores across the crust.
  r.line(6, 10, 9, 14, C.breadDark, 1.2);
  r.line(11, 9, 14, 13, C.breadDark, 1.2);
  r.line(16, 10, 19, 14, C.breadDark, 1.2);
  r.rim(C.breadDark);
  r.set(5, 11, C.breadLight);
  return r;
}

function draft() {
  const r = new Raster(24, 24);
  // Three gusts, each a curl that thins as it trails off to the left.
  r.polyline(
    [
      [3, 7],
      [8, 5],
      [14, 5],
      [19, 7],
      [21, 10],
      [18, 12],
      [15, 10],
    ],
    C.draft,
    2,
  );
  r.polyline(
    [
      [2, 14],
      [8, 12],
      [15, 12],
      [21, 14],
    ],
    C.draft,
    2,
  );
  r.polyline(
    [
      [4, 19],
      [10, 17],
      [16, 17],
      [20, 19],
      [18, 21],
    ],
    C.draftFaint,
    2,
  );
  r.set(1, 15, C.draftFaint);
  r.set(2, 8, C.draftFaint);
  r.set(2, 20, C.draftFaint);
  return r;
}

export function producePickups(tools, out) {
  drawSprite(tools, `${out}/sprites/pickups/chest.png`, chest());
  drawSprite(tools, `${out}/sprites/pickups/bread.png`, bread());
  drawSprite(tools, `${out}/sprites/pickups/draft.png`, draft());
}

// ---- The death puff --------------------------------------------------------

export function producePuff(tools, out) {
  drawSheet(tools, `${out}/sprites/puff`, 24, 24, 4, (sheet) => {
    const f0 = new Raster(24, 24);
    f0.disc(12, 12, 4, C.puff);
    f0.disc(12, 12, 2, C.white);
    sheet.frame(0, f0);

    const f1 = new Raster(24, 24);
    f1.disc(12, 11, 6, C.puffMid);
    f1.disc(8, 14, 4, C.puffMid);
    f1.disc(16, 14, 4, C.puffMid);
    f1.disc(12, 10, 3, C.puff);
    sheet.frame(1, f1);

    const f2 = new Raster(24, 24);
    for (const [x, y] of [
      [12, 5],
      [6, 9],
      [18, 9],
      [5, 16],
      [19, 16],
      [12, 19],
    ]) {
      f2.disc(x, y, 3, C.puffFaint);
    }
    f2.disc(12, 12, 2, C.puffMid);
    sheet.frame(2, f2);

    const f3 = new Raster(24, 24);
    for (const [x, y] of [
      [12, 3],
      [4, 7],
      [20, 7],
      [3, 17],
      [21, 17],
      [12, 21],
      [8, 12],
      [16, 12],
    ]) {
      f3.disc(x, y, 1.5, C.puffGone);
    }
    sheet.frame(3, f3);
  });
}
