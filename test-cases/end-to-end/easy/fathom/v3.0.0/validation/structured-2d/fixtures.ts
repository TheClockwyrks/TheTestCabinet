// Fathom — the posed-fixture machinery. CASE-PROVIDED, and SHARED
// BYTE-IDENTICALLY across `validation/none/`, `validation/simple-2d/` and
// `validation/structured-2d/`.
//
// WHY A CHECK POSES THE GEOMETRY IT IS ABOUT. The maze is the build's own design
// (specs/maze.md fixes its rules and nothing else), so a scenario that needs a
// shape — a straight run of a given length, a corner to turn, a corridor ending
// in rock, two tiles with a band of rock between them — can otherwise only go
// hunting for one in whatever board this build happened to draw, and take what it
// finds. What it finds differs from build to build: a different amount of room, a
// different approach, sometimes nothing usable. A check that POSES the shape it
// is about measures the behavior it names instead of the layout it landed in.
//
// `setMaze` is what makes that legitimate. specs/instrumentation.md exempts a
// posed fixture from every rule in specs/maze.md — dead ends, corridors wider
// than one tile, asymmetry, disconnected regions, a missing wrap tunnel are all
// legal in a fixture — and requires the game to keep running on one exactly as
// though it were the maze it had laid out itself. The eight `maze/*` points are
// the exception that proves it: they read the build's OWN board, because finding
// those properties there is the check (see `maze.ts`).
//
// This module drives the surface, so it names the operations it needs as an
// interface of its own rather than importing a `surface.ts`: the engineless
// project has none, and its operations cross into a page and answer with
// promises. Every call below is awaited, which is correct under both.

import { fail } from "./assert";
import { unmetPrecondition } from "./scene";
import {
  CORRIDOR,
  DEN,
  DIRS,
  GATE,
  OPPOSITE,
  ROCK,
  corridorDirs,
  type BoardView,
  type Dir,
  type Tile,
} from "./maze";

/** A value a driver may answer with directly or through a promise. */
export type Awaitable<T> = T | Promise<T>;

/** One predator, as much of it as a fixture reads. */
export interface PredatorPose {
  kind: string;
  tx: number;
  ty: number;
  state: string;
  released: boolean;
}

/** The board a fixture reads back after posing itself. */
export interface FixtureBoard extends BoardView {
  screen: string;
  predators: readonly PredatorPose[];
}

/** The operations a fixture drives, exactly as specs/instrumentation.md fixes them. */
export interface FixtureOps {
  setMaze(rows: readonly string[]): Awaitable<void>;
  beginPlay(): Awaitable<void>;
  setForagerTile(tx: number, ty: number): Awaitable<void>;
  setForagerDir(dir: Dir): Awaitable<void>;
}

/** What a poser needs of a harness: the surface, and a read of the board. */
export interface FixtureHost {
  readonly debug: FixtureOps;
  snapshot(): Awaitable<FixtureBoard>;
}

/** Where the art was stamped, and what each of its letters labels. */
export interface Stamped {
  /** The layout to hand `setMaze`, one string per row. */
  rows: string[];
  /** Each capital letter of the art, and every tile it labels, in reading order. */
  marks: Record<string, Tile[]>;
  /** The top-left tile of the board the art was stamped at. */
  at: Tile;
}

/** A posed fixture, as a scenario reads its own anchors back. */
export interface Posed extends Stamped {
  /** The one tile `letter` labels. Fails when the art labels it any other number of times. */
  mark(letter: string): Tile;
  /** Every tile `letter` labels, in reading order. */
  all(letter: string): Tile[];
}

export interface StampOptions {
  /** The top-left tile to stamp the art at. It is centred when this is omitted. */
  at?: Tile;
  /**
   * Add the sealed larder and the sealed den in the bottom two rows. On by
   * default, and switched off only by a fixture that needs those rows for
   * itself and keeps the board unclearable and its predators housed some other
   * way.
   */
  larder?: boolean;
}

export interface PoseOptions extends StampOptions {
  /**
   * Refuse to grade a scenario `setMaze` left a predator loose in.
   *
   * On by default. `controls/setmaze-houses-predators` is the point that OWNS
   * that claim, so it poses with `housed: false` and asserts the housing itself.
   */
  housed?: boolean;
}

/**
 * Stamp a piece of ASCII art into a full-size layout, ready for `setMaze`.
 *
 * The art is the fixture, drawn the way it reads on screen — one string per row,
 * one character per tile:
 *
 * | Character | The tile is |
 * | --- | --- |
 * | `#` or a space | Rock. |
 * | `.` | Corridor. |
 * | `d` / `g` | Den interior / the den gate. A fixture needs neither of its own. |
 * | any `A`-`Z` | Corridor, AND a named anchor the scenario asks for by that letter. |
 *
 * Anchors are what keeps a scenario readable: it draws the corridor it wants and
 * labels the two tiles that matter, rather than computing offsets.
 * `F........P` is a ten-tile straight run with the forager's tile at one end and
 * a predator's at the other. A letter used twice yields both tiles, in reading
 * order.
 *
 * Everything outside the art is rock. The art is centred in the BUILD's own
 * reported grid unless `at` places it, so a build whose grid is not `36 x 18`
 * still gets its fixture stamped somewhere valid rather than a layout of the
 * wrong size.
 */
export function stampLayout(
  board: BoardView,
  art: readonly string[],
  options: StampOptions = {},
): Stamped {
  const { cols, rows } = board.grid;
  const height = art.length;
  const width = Math.max(...art.map((line) => line.length));
  const top = options.at ? options.at.ty : Math.floor((rows - height) / 2);
  const left = options.at ? options.at.tx : Math.floor((cols - width) / 2);
  if (top < 0 || left < 0 || top + height > rows || left + width > cols) {
    fail(
      `a grid this suite's ${width}x${height} fixture fits at ` +
        `(${left}, ${top}); specs/overview.md fixes GRID_COLS (36) by ` +
        `GRID_ROWS (18)`,
      `${cols}x${rows}`,
    );
  }

  const grid: string[][] = Array.from({ length: rows }, () =>
    new Array<string>(cols).fill(ROCK),
  );
  const marks: Record<string, Tile[]> = {};
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < art[r].length; c += 1) {
      const glyph = art[r][c];
      if (glyph === ROCK || glyph === " ") continue;
      const tile: Tile = { tx: left + c, ty: top + r };
      if (glyph === CORRIDOR || glyph === DEN || glyph === GATE) {
        grid[tile.ty][tile.tx] = glyph;
        continue;
      }
      if (!/^[A-Z]$/.test(glyph)) {
        throw new Error(
          `stampLayout: unknown fixture character ${JSON.stringify(glyph)} ` +
            `at art (${c}, ${r})`,
        );
      }
      grid[tile.ty][tile.tx] = CORRIDOR;
      (marks[glyph] ??= []).push(tile);
    }
  }

  if (options.larder ?? true) {
    stampLarderAndDen(grid, cols, rows);
  }

  return {
    rows: grid.map((row) => row.join("")),
    marks,
    at: { tx: left, ty: top },
  };
}

/**
 * THE SEALED LARDER AND THE SEALED DEN, in the bottom two rows of every fixture.
 *
 * THE LARDER is a short run of corridor the forager can never reach. A maze is
 * laid out with a plankton on every corridor tile and eating the one that leaves
 * none behind CLEARS the maze (specs/gameplay.md), which descends, lays out a
 * fresh board, re-dens every predator and ends the scenario. A fixture is a
 * handful of tiles, so a forager that keeps traveling can graze all of them in a
 * couple of seconds — and whether it does is not a check's to decide, because
 * specs/movement.md has the forager travel while a movement action is held and a
 * scenario is entitled to hold one. Pellets it cannot reach settle it outright:
 * `planktonRemaining` never reaches `0`, so no amount of grazing can clear the
 * maze, whatever the forager does. It costs the scenario nothing, because the
 * tiles are sealed off from everything else on the board.
 *
 * THE DEN is a three-tile chamber with its gate above the middle tile and rock on
 * the gate's other three sides. Every board a build lays out has one
 * (specs/maze.md), and `setMaze` returns every predator to a den tile — so a
 * fixture without one asks each build what "back to the den" means when there is
 * no den. Giving the fixture a real den takes the question away: there is
 * somewhere to put them, and it is nowhere near the scenario. Sealed means
 * SEALED: even a build that runs the release schedule anyway, which `setMaze`
 * says it must not, gets no further than the gate tile.
 *
 * The two sit at opposite ends of those rows, so the larder is no more reachable
 * from the den than from the fixture.
 */
function stampLarderAndDen(grid: string[][], cols: number, rows: number): void {
  const last = rows - 1;
  const above = rows - 2;
  const used = (row: string[]): boolean => row.some((cell) => cell !== ROCK);
  if (used(grid[last]) || used(grid[above])) {
    throw new Error(
      "stampLayout: the fixture reaches the bottom two rows, which the larder " +
        "and the den need; pass { larder: false } and keep the board " +
        "unclearable and its predators housed another way",
    );
  }
  for (let c = 1; c <= Math.min(3, cols - 2); c += 1) grid[last][c] = CORRIDOR;

  const gateCol = cols - 3;
  grid[above][gateCol] = GATE;
  for (let c = gateCol - 1; c <= gateCol + 1; c += 1) grid[last][c] = DEN;
}

/** The den and gate tiles of a board, keyed `"tx,ty"`: where a predator belongs. */
export function housedTiles(board: BoardView): Set<string> {
  const housed = new Set<string>();
  for (let ty = 0; ty < board.grid.rows; ty += 1) {
    for (let tx = 0; tx < board.grid.cols; tx += 1) {
      const at = board.tiles[ty]?.[tx];
      if (at === DEN || at === GATE) housed.add(`${tx},${ty}`);
    }
  }
  return housed;
}

/** One predator standing outside the den, and the kind of tile it stands on. */
export interface LoosePredator extends PredatorPose {
  /** `"open corridor"`, `"rock"`, or `"off the board"`. */
  ground: string;
  /** The phrase both the precondition and the point that owns the claim report. */
  where: string;
}

/** Every predator of `board` standing outside `housed`. */
export function looseOf(
  board: FixtureBoard,
  housed: Set<string>,
): LoosePredator[] {
  return board.predators
    .filter((predator) => !housed.has(`${predator.tx},${predator.ty}`))
    .map((predator) => {
      const at = board.tiles[predator.ty]?.[predator.tx];
      const ground =
        at === CORRIDOR
          ? "open corridor"
          : at === undefined
            ? "off the board"
            : "rock";
      return {
        ...predator,
        ground,
        where: `the ${predator.kind} at (${predator.tx}, ${predator.ty}), on ${ground}`,
      };
    });
}

/**
 * Refuse to grade a posed scenario whose predators `setMaze` did not put away.
 *
 * specs/instrumentation.md is explicit about what the operation does with them:
 * the board is left in the state a freshly laid-out maze starts in, with every
 * predator returned to a den tile and its `released` flag `false`. A fixture from
 * {@link stampLayout} always carries a real den for them to be returned TO, so on
 * such a layout every predator's tile is a den or gate tile; there is nowhere else
 * it is entitled to be.
 *
 * IT REFUSES NARROWLY. A build that misses the fixture's den misses it by
 * whatever offset its own den sat at, and the tile it lands on is as often rock as
 * corridor. Movement is confined to open tiles and rock is solid to every body
 * (specs/movement.md), so a hunter embedded in rock cannot reach the forager, the
 * subject, or anything else: the scenario around it is the one the check meant to
 * pose, and refusing to grade it would throw a real measurement away over
 * bookkeeping. A hunter on OPEN CORRIDOR is the one that can travel into the
 * scene, and it is the only one that stops the scenario.
 *
 * The full contract, rock included, is graded by
 * `controls/setmaze-houses-predators`, which poses with `housed: false` and
 * asserts the housing itself. This is the narrower question of whether THIS
 * scenario can still be read, so it DECLINES, naming that point as the one that
 * owns the verdict.
 *
 * A layout with no den at all is not checked: specs/instrumentation.md holds such
 * a predator out of play rather than fixing a tile for it.
 */
export function requireHoused(board: FixtureBoard): void {
  const housed = housedTiles(board);
  if (housed.size === 0) return;
  const loose = looseOf(board, housed).filter(
    (one) => one.ground === "open corridor",
  );
  if (loose.length === 0) return;
  unmetPrecondition(
    "Expected: setMaze to return every predator to a den tile of the posed " +
      "fixture, which carries one (specs/instrumentation.md); a hunter left " +
      "standing in open corridor can reach the forager and end the scenario, " +
      "so this point's own claim was never measured — the housing contract is " +
      "controls/setmaze-houses-predators' verdict to give\nActual: " +
      loose.map((one) => one.where).join("; "),
  );
}

/**
 * Pose a fixture as the whole maze, and hand back its anchors.
 *
 * `setMaze` leaves the dive on a fresh board — a plankton on every corridor tile,
 * the fog back to unrevealed, every predator returned to the den with `released`
 * false and the release schedule suspended — so a caller poses the forager and the
 * predators it wants afterwards, exactly as it would on a generated maze. Every
 * poser below places the forager EXPLICITLY on an anchor of its own fixture, and
 * so must any scenario that poses its own art: the operation rests the forager on
 * the first corridor tile in reading order, which specs/instrumentation.md is
 * explicit is a defined resting place rather than a meaningful one.
 */
export async function poseMaze(
  h: FixtureHost,
  art: readonly string[],
  options: PoseOptions = {},
): Promise<Posed> {
  const before = await h.snapshot();
  const stamped = stampLayout(before, art, options);
  await h.debug.setMaze(stamped.rows);

  // specs/instrumentation.md leaves the screen exactly as it was, so a build in
  // live play is still in live play here and this is a no-op. A build that read
  // the new board as a new maze and opened a countdown is put back into play
  // rather than having that reading reported against fifty unrelated points; the
  // screen `setMaze` leaves is nobody's subject below.
  if ((await h.snapshot()).screen === "countdown") await h.debug.beginPlay();

  if (options.housed !== false) requireHoused(await h.snapshot());

  return {
    ...stamped,
    mark(letter) {
      const hits = stamped.marks[letter];
      if (hits === undefined || hits.length !== 1) {
        throw new Error(
          `poseMaze: the fixture labels ${letter} ${hits?.length ?? 0} times, ` +
            `expected exactly one`,
        );
      }
      return hits[0];
    },
    all: (letter) => stamped.marks[letter] ?? [],
  };
}

/**
 * Place the forager on `tile`, facing `dir`.
 *
 * Every poser ends with one of these. The two operations are atomic
 * (specs/instrumentation.md), so a facing is posed beside a tile rather than
 * with it.
 */
export async function placeForager(
  h: FixtureHost,
  tile: Tile,
  dir?: Dir,
): Promise<void> {
  await h.debug.setForagerTile(tile.tx, tile.ty);
  if (dir !== undefined) await h.debug.setForagerDir(dir);
}

/**
 * Face the forager at rock, so a build whose forager travels on with no action
 * held still holds the tile it was placed on.
 *
 * specs/movement.md has a forager at rest take its desired direction when the
 * tile that way is open and stay at rest otherwise, so a heading that leads into
 * rock cannot take it off the tile under any conforming reading. Where the tile
 * is a full crossroads the facing is left alone, which is the best available.
 *
 * Only for a scenario whose forager is a BYSTANDER. A check that reads the
 * forager's own heading poses that heading itself.
 */
export async function faceWall(
  h: FixtureHost,
  tile: Tile,
): Promise<Dir | null> {
  const board = await h.snapshot();
  const open = corridorDirs(board, tile.tx, tile.ty);
  const walled = DIRS.filter((dir) => !open.includes(dir));
  if (walled.length === 0) return null;
  await h.debug.setForagerDir(walled[0]);
  return walled[0];
}

/* -------------------------------------------------------------------------- */
/* The fixture library                                                        */
/* -------------------------------------------------------------------------- */
//
// Each of these poses one shape and returns the tiles a scenario places things
// on. They fix GEOMETRY alone: how long a run is, how far apart two tiles stand,
// which side the rock is on. Every threshold a check asserts is stated in the
// check itself, derived from the figure or rule the specs give for it.

/** A straight corridor posed as the whole board. */
export interface StraightRun {
  /** The run's first tile, where the forager is placed. */
  start: Tile;
  /** The way it runs from there. */
  dir: Dir;
  /** How many tiles long it is, the start included. */
  len: number;
}

/**
 * A straight corridor of `len` tiles, with the forager resting on its first tile
 * facing along it.
 *
 * `dir` is the way it runs, `"right"` by default. A `"down"` run stamps the same
 * corridor as one tile per row, so a check whose claim is about travel rather
 * than about a heading can take the same reading on either axis.
 *
 * `spare` adds a second sealed pocket of corridor well clear of the run, for a
 * scenario that needs ground the light has never touched to read a build's own
 * unrevealed fog color from.
 */
export async function poseStraightRun(
  h: FixtureHost,
  len: number,
  options: { spare?: boolean; dir?: "right" | "down" } = {},
): Promise<StraightRun> {
  const dir = options.dir ?? "right";
  const spare = options.spare === true;
  const art =
    dir === "right"
      ? ["S" + CORRIDOR.repeat(len - 1) + (spare ? " ".repeat(8) + "..." : "")]
      : ["S", ...Array.from({ length: len - 1 }, () => CORRIDOR)].concat(
          spare ? [" ".repeat(8) + "..."] : [],
        );
  const posed = await poseMaze(h, art);
  const start = posed.mark("S");
  await placeForager(h, start, dir);
  return { start, dir, len };
}

/** Two tiles on one straight corridor with clear line of sight between them. */
export interface SightLine {
  /** Where the forager rests. */
  forager: Tile;
  /** Where the scenario poses a predator. */
  pred: Tile;
  /** The heading from the forager toward the predator. */
  dir: Dir;
  /** The heading from the predator back down the corridor at the forager. */
  toForager: Dir;
  /** How many tiles apart the two stand. */
  tiles: number;
  /** A sealed pocket the forager can be moved to, when one was asked for. */
  refuge: Tile | null;
}

/**
 * The forager and a predator `gapTiles` apart on one straight corridor.
 *
 * `lead` and `tail` are spare corridor beyond each of them, so neither runs into
 * rock the instant a scenario sets it moving. `refugeGap` adds a sealed pocket
 * that many tiles further on, for a scenario that then puts the forager somewhere
 * a light, a ping or a patrol cannot follow: sealed rather than merely distant,
 * because the whole point of moving it is that what happens next cannot be the
 * predator arriving.
 */
export async function poseSightLine(
  h: FixtureHost,
  gapTiles: number,
  options: { lead?: number; tail?: number; refugeGap?: number } = {},
): Promise<SightLine> {
  const { lead = 1, tail = 1, refugeGap = 0 } = options;
  let art =
    CORRIDOR.repeat(lead) +
    "F" +
    CORRIDOR.repeat(gapTiles - 1) +
    "P" +
    CORRIDOR.repeat(tail);
  if (refugeGap > 0) art += " ".repeat(refugeGap) + "R" + CORRIDOR.repeat(2);
  const posed = await poseMaze(h, [art]);
  const forager = posed.mark("F");
  await placeForager(h, forager, "right");
  return {
    forager,
    pred: posed.mark("P"),
    dir: "right",
    toForager: "left",
    tiles: gapTiles,
    refuge: refugeGap > 0 ? posed.mark("R") : null,
  };
}

/** A right-angle junction posed as the whole board. */
export interface Corner {
  /** The tile the two arms meet at. */
  junction: Tile;
  /** The heading that carries a body from `back` to the junction. */
  approach: Dir;
  /** The tile a body starts on, one step before the junction. */
  back: Tile;
  /** The heading the perpendicular arm runs on. */
  perp: Dir;
  /** The first tile of that arm. */
  perpTile: Tile;
}

/**
 * A corner with both arms running on past the junction, so a body that does NOT
 * turn keeps going rather than being stopped by rock. The forager rests on
 * `back`, facing along the approach.
 */
export async function poseCorner(
  h: FixtureHost,
  options: { arm?: number } = {},
): Promise<Corner> {
  const arm = options.arm ?? 4;
  const art = ["BJ" + CORRIDOR.repeat(arm)];
  for (let i = 0; i < arm; i += 1) art.push(" " + CORRIDOR + " ".repeat(arm));
  const posed = await poseMaze(h, art);
  const junction = posed.mark("J");
  const back = posed.mark("B");
  await placeForager(h, back, "right");
  return {
    junction,
    approach: "right",
    back,
    perp: "down",
    perpTile: { tx: junction.tx, ty: junction.ty + 1 },
  };
}

/** Two rooms with no way between them. */
export interface ApartRooms {
  /** The forager's own room, where it rests. */
  near: Tile;
  /** The first tile of the ring a creature patrols, across solid rock. */
  far: Tile;
}

/**
 * The forager's corridor and, across solid rock, a separate ring for a creature
 * to patrol.
 *
 * WHY THE TWO HALVES ARE SEALED FROM EACH OTHER. These scenarios want a creature
 * that keeps to itself — wandering, pinging, flaring — while the forager stands
 * somewhere else as a bystander. On a generated maze "somewhere else" is only a
 * head start: a patrol crosses the board in a few seconds, so a long watch ends
 * with the creature arriving and the point becoming about something other than
 * its subject. A posed board may do what specs/maze.md forbids a laid-out one and
 * simply put them in different rooms, so "far away" holds for as long as the check
 * needs. The ring is a loop rather than a hallway, so a patrol has somewhere to go
 * and keeps moving instead of pacing a dead end.
 *
 * `near` is how much corridor the forager's own room has, which matters whenever
 * the check measures something that TRAVELS along corridors: a sonar pulse floods
 * by corridor step, so a pulse cast in a three-tile room reports a three-tile
 * reach however far its range is set.
 */
export async function poseApart(
  h: FixtureHost,
  minTiles: number,
  options: { ring?: number; spare?: boolean; near?: number } = {},
): Promise<ApartRooms> {
  const { ring = 3, spare = false, near = 3 } = options;
  const gap = Math.max(2, minTiles - near);
  const pad = " ".repeat(gap);
  const tail = spare ? " ".repeat(8) + CORRIDOR.repeat(3) : "";
  const blank = " ".repeat(near);
  const art = [
    "N" + CORRIDOR.repeat(near - 1) + pad + "F" + CORRIDOR.repeat(ring) + tail,
    blank + pad + CORRIDOR + " ".repeat(ring - 1) + CORRIDOR,
    blank + pad + CORRIDOR + CORRIDOR.repeat(ring),
  ];
  const posed = await poseMaze(h, art);
  const nearTile = posed.mark("N");
  await placeForager(h, nearTile, "right");
  return { near: nearTile, far: posed.mark("F") };
}

/** A straight-corridor ink standoff. */
export interface InkStandoff {
  /** Where the forager rests and releases its cloud. */
  ink: Tile;
  /** Where the scenario poses the hunter, along the same corridor. */
  pred: Tile;
  /** The heading from the ink tile toward the hunter. */
  dir: Dir;
  /** The heading the forager retreats on to get clear of its own cloud. */
  flee: Dir;
  /** How much corridor sits behind the ink tile for that retreat. */
  clearTiles: number;
}

/**
 * The forager on one tile, a hunter `gap` tiles along the same corridor, and
 * `clearTiles` of corridor behind the forager for it to retreat down — which
 * leaves the cloud squarely between the two.
 */
export async function poseInkStandoff(
  h: FixtureHost,
  options: { gap: number; clearTiles?: number },
): Promise<InkStandoff> {
  const clearTiles = options.clearTiles ?? 3;
  const art =
    CORRIDOR.repeat(clearTiles) + "I" + CORRIDOR.repeat(options.gap - 1) + "P";
  const posed = await poseMaze(h, [art]);
  const ink = posed.mark("I");
  await placeForager(h, ink, "right");
  return { ink, pred: posed.mark("P"), dir: "right", flee: "left", clearTiles };
}

/** Two corridors separated by a solid band of rock. */
export interface OccludedPair {
  /** Where the forager rests. */
  forager: Tile;
  /** The tile across the rock, where the scenario poses a predator. */
  pred: Tile;
  /** How many tiles apart the two stand. */
  tiles: number;
}

/**
 * Two parallel corridors with a full band of rock between them, `tiles` apart.
 *
 * WHY A BAND RATHER THAN ONE ROCK ON THE LINE. These points watch a predator that
 * is still patrolling, so what matters is not that ONE pair of tiles is occluded
 * but that every tile the predator can reach is. A single rock with a way around
 * it leaves tiles at grazing angles where a check's own reading and a build's line
 * of sight can legitimately disagree, and the point then reads that disagreement
 * as a predator lit through rock. With a full band, every line from one corridor
 * to the other crosses solid rock, whatever either party rounds.
 *
 * OCCLUSION IS NOT DARKNESS. Two tiles apart is `64` units, which sits inside the
 * forager's own light pocket at any brightness (`V` is `96` at `G = 0`), and a
 * build is entitled to paint that pocket as a glow. A check reading PIXELS across
 * the band stands its pair five tiles apart instead: past the pocket, and still
 * inside the kindle circle.
 */
export async function poseOccludedPair(
  h: FixtureHost,
  options: { tiles?: number; len?: number } = {},
): Promise<OccludedPair> {
  const { tiles = 2, len = 5 } = options;
  const art = ["F" + CORRIDOR.repeat(len - 1)];
  for (let i = 1; i < tiles; i += 1) art.push("");
  art.push("P" + CORRIDOR.repeat(len - 1));
  const posed = await poseMaze(h, art);
  const forager = posed.mark("F");
  await placeForager(h, forager, "right");
  return { forager, pred: posed.mark("P"), tiles };
}

/** A tile a sonar pulse floods to, and how many corridor steps out it lies. */
export interface SonarTarget extends Tile {
  /** Corridor steps from the forager's tile. */
  steps: number;
}

/**
 * A dog-leg corridor, and the tiles a pulse from the forager reaches around the
 * bend, nearest first.
 *
 * These are tiles the pulse can flood to but the LIGHT cannot see: the return leg
 * sits directly under the outward leg with a band of rock between, so every line
 * from the forager to a target crosses solid rock while the corridor still joins
 * them in a few steps. That separation is the whole point of the sonar points —
 * anything revealed out there was revealed by the pulse and not by standing close.
 */
export async function poseSonarSense(
  h: FixtureHost,
  count = 1,
): Promise<SonarTarget[]> {
  const posed = await poseMaze(h, ["F..", "  .", "..."]);
  const forager = posed.mark("F");
  await placeForager(h, forager, "right");
  return [
    { tx: forager.tx + 2, ty: forager.ty + 2, steps: 4 },
    { tx: forager.tx + 1, ty: forager.ty + 2, steps: 5 },
    { tx: forager.tx, ty: forager.ty + 2, steps: 6 },
  ].slice(0, count);
}

/** A short corridor closed by rock, with a corridor tile behind that rock. */
export interface LitWallProbe {
  /** Where the forager rests, at the open end. */
  forager: Tile;
  /** The heading down the corridor. */
  dir: Dir;
  /** How many corridor tiles run ahead of the forager. */
  run: number;
  /** The rock that closes the corridor. */
  wall: Tile;
  /** The corridor tile on the far side of that rock, which the light must not reach. */
  behind: Tile;
  /** The rock the forager itself stands against. */
  flankWalls: Tile[];
}

/**
 * A corridor of `run` tiles ahead of the forager, closed by one rock tile, with a
 * corridor tile behind it.
 *
 * `behind` is what makes the point decidable: it is a tile the light must NOT
 * reach, and a corridor that simply ran into the board's border has no far side
 * at all.
 */
export async function poseLitWallProbe(
  h: FixtureHost,
  options: { run?: number } = {},
): Promise<LitWallProbe> {
  const run = options.run ?? 3;
  const posed = await poseMaze(h, [
    "F" + CORRIDOR.repeat(run) + ROCK + CORRIDOR,
  ]);
  const forager = posed.mark("F");
  await placeForager(h, forager, "right");
  return {
    forager,
    dir: "right",
    run,
    wall: { tx: forager.tx + run + 1, ty: forager.ty },
    behind: { tx: forager.tx + run + 2, ty: forager.ty },
    flankWalls: [
      { tx: forager.tx, ty: forager.ty - 1 },
      { tx: forager.tx, ty: forager.ty + 1 },
    ],
  };
}

/** A straight run holding a hunter, the tile it takes its fix on, and a slip. */
export interface DimStandoff {
  /** Where the scenario poses the hunter. */
  pred: Tile;
  /** Where the forager stands while the hunter takes its fix. */
  fix: Tile;
  /** Where the forager slips to afterwards, further along the same run. */
  slip: Tile;
  /** The heading the run travels on. */
  dir: Dir;
}

/**
 * A hunter, the tile the forager is fixed on, and a tile `slipTiles` further
 * along, all three on one straight run so the only thing between them is
 * distance.
 */
export async function poseDimStandoff(
  h: FixtureHost,
  options: { predTiles?: number; slipTiles?: number } = {},
): Promise<DimStandoff> {
  const { predTiles = 2, slipTiles = 6 } = options;
  const art =
    "P" +
    CORRIDOR.repeat(predTiles - 1) +
    "X" +
    CORRIDOR.repeat(slipTiles - 1) +
    "S";
  const posed = await poseMaze(h, [art]);
  const fix = posed.mark("X");
  await placeForager(h, fix, "right");
  return { pred: posed.mark("P"), fix, slip: posed.mark("S"), dir: "right" };
}

/** A run along one axis, with the forager standing still in the middle of it. */
export interface MoveKeyRun {
  /** The tile the forager rests on. */
  start: Tile;
  /** The direction under test. */
  dir: Dir;
  /** The heading the forager was left resting on. */
  facing: Dir;
  /** How many tiles of corridor run ahead of it that way. */
  ahead: number;
}

/**
 * A straight corridor along the tested direction's OWN axis, with the forager
 * resting in the middle of it.
 *
 * Posed rather than found: whether a tile has corridor on the side a given action
 * pushes, and how much, is a property of the maze a build invented, so on one
 * board "hold left" has four tiles to cross and on another it has one and a wall.
 * Here every direction gets the same run.
 *
 * THE FORAGER RESTS FACING THE OTHER WAY, which is what keeps the reading
 * non-vacuous. A check about `right` that posed the forager already facing right
 * would assert a heading the arrangement itself had set, and — on a build whose
 * forager travels with no action held — would read travel in the tested direction
 * that the tested action had nothing to do with. Resting it on the opposite
 * heading makes both readings the action's own: specs/movement.md honors a desired
 * direction opposite the current heading at once, wherever the forager stands, so
 * a conforming build turns and travels on the very tick the action arrives.
 */
export async function poseMoveKeyRun(
  h: FixtureHost,
  dir: Dir,
  options: { ahead?: number; facing?: Dir } = {},
): Promise<MoveKeyRun> {
  const ahead = options.ahead ?? 3;
  const facing = options.facing ?? OPPOSITE[dir];
  const arm = CORRIDOR.repeat(ahead);
  const vertical = dir === "up" || dir === "down";
  const art = vertical
    ? [...arm.split(""), "S", ...arm.split("")]
    : [arm + "S" + arm];
  const posed = await poseMaze(h, art);
  const start = posed.mark("S");
  await placeForager(h, start, facing);
  return { start, dir, facing, ahead };
}
