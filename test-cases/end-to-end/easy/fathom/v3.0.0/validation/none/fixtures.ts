// Fathom — the posed-fixture machinery. CASE-PROVIDED, and shared
// byte-identically by every engine's validator project.
//
// WHY A CHECK POSES ITS OWN GEOMETRY. The maze is the BUILD's to design
// (`specs/maze.md` fixes only the rules it satisfies), so a scenario that needs a
// shape — a straight run of a given length, a corner to turn, a corridor ending
// in rock, two tiles with a band of rock between them — can only go hunting for
// one in the board this build happened to draw, and take whatever it finds. What
// it finds differs from build to build: a different amount of room, a different
// approach, sometimes nothing usable at all. A check that POSES the shape it is
// about measures the behavior it names instead of the layout it landed in.
//
// `specs/instrumentation.md` is what makes that legitimate. `setMaze(rows)`
// replaces the layout with a fixture, the fixture is "used exactly as given" and
// "exempt from every rule in `specs/maze.md`", and the game "behaves in every
// respect as though the posed layout were the maze it had laid out itself". So
// the real sensing, the real pathfinding and the real contact rules run on the
// board a check drew.
//
// THE EXCEPTION is `maze/*`: those eight items decide whether the board the build
// invented satisfies `specs/maze.md`, so finding those properties THERE is the
// check. They read `snapshot().tiles` and never come through here. `maze.ts` holds
// their measures.
//
// FOUR RULES EVERY FIXTURE HERE FOLLOWS, each of them paid for by a real run that
// graded a conforming build as broken:
//
//   1. A SEALED LARDER. Plankton sit on every corridor tile
//      (`specs/gameplay.md`), and eating the last one clears the maze and
//      descends — which resets the board, re-dens every predator and ends the
//      scenario mid-measurement. A fixture is a handful of tiles, so a forager
//      that keeps swimming empties it in a couple of seconds, and whether it does
//      is not something a check gets to decide: `specs/movement.md` lets a
//      forager with no action held carry on to the next center. Pellets it cannot
//      reach settle it outright — `planktonRemaining` never reaches `0`, whatever
//      the forager does.
//   2. A SEALED DEN. `setMaze` returns every predator to a den tile, so a fixture
//      with no den asks each build what "back to the den" means when there is no
//      den, and they answer differently. Giving the fixture a real one takes the
//      question away. Sealed means sealed: the gate sits above the chamber with
//      rock on its other three sides, so even a build that runs the release
//      schedule anyway — which `specs/instrumentation.md` says it must not — gets
//      no further than the gate.
//   3. EVERY POSER PLACES THE FORAGER, on a named anchor of its own fixture.
//      `setMaze` rests it on "the first corridor tile in reading order", which
//      that page is explicit is "a defined resting place rather than a meaningful
//      one". A poser that relied on it would be relying on a tie-break the
//      specification deliberately left the build.
//   4. THE HOUSING IS CHECKED, NARROWLY. See {@link requireHoused}.
//
// IT IMPORTS ONLY `maze.ts`, and describes the harness it drives structurally, so
// this module is the same file under every engine.

import {
  ALL_DIRS,
  isCorridor,
  step,
  type Dir,
  type GridFrame,
  type MazeView,
  type TileRef,
} from "./maze";

/* -------------------------------------------------------------------------- */
/* What a poser needs of the game                                             */
/* -------------------------------------------------------------------------- */

/** One predator, as far as a poser reads it (`specs/state.md`). */
export interface PredatorView {
  kind: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: string;
  released: boolean;
}

/** The forager, as far as a poser reads it (`specs/state.md`). */
export interface ForagerView {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: string;
  moving: boolean;
}

/**
 * The part of a snapshot the shared oracle reads.
 *
 * Structural rather than imported, so this module is byte-identical under every
 * engine: each engine's own full snapshot type satisfies it, and a poser hands
 * that full type back to its caller rather than this narrowing of it.
 */
export interface BoardSnapshot extends MazeView {
  screen: string;
  lives: number;
  planktonRemaining: number;
  brightness: number;
  visibility: readonly string[];
  forager: ForagerView;
  predators: readonly PredatorView[];
}

/**
 * The operations a poser calls, in the imperative convention every engine's
 * checks share.
 *
 * Each is declared as possibly returning a promise, because reaching a build
 * through a browser page is asynchronous and reaching one through an engine is
 * not. A poser awaits every call, which is correct under both.
 */
export interface PoseOps {
  setMaze(rows: readonly string[]): void | Promise<void>;
  beginPlay(): void | Promise<void>;
  setForagerTile(tx: number, ty: number): void | Promise<void>;
  setForagerDir(dir: Dir): void | Promise<void>;
  setPredatorTile(index: number, tx: number, ty: number): void | Promise<void>;
  setPredatorDir(index: number, dir: Dir): void | Promise<void>;
  setPredatorState(
    index: number,
    value: "den" | "wander" | "chase",
  ): void | Promise<void>;
  setCreatureAI(enabled: boolean): void | Promise<void>;
  setBrightness(g: number): void | Promise<void>;
}

/**
 * What a poser needs of a harness: a read, the surface, and a way to refuse.
 *
 * `unmet` raises an UNMET PRECONDITION — the scenario could not be constructed
 * against this build, so the check declines to decide rather than failing the
 * point it backs. Each claim a refusal stands aside on has an item of its own
 * that does fail for it; see {@link requireHoused}.
 */
export interface PoseHarness<S extends BoardSnapshot> {
  snapshot(): S | Promise<S>;
  advance(ticks: number): void | Promise<void>;
  skip(ticks: number): void | Promise<void>;
  unmet(reason: string): never;
  readonly debug: PoseOps;
}

/* -------------------------------------------------------------------------- */
/* Stamping a fixture                                                         */
/* -------------------------------------------------------------------------- */

/** A fixture that does not fit the grid the build reported. */
export class FixtureTooLarge extends Error {}

/** What {@link stampLayout} produced: the layout, its anchors, and where it sits. */
export interface Stamped {
  /** The rows to hand `setMaze`, one string per grid row. */
  rows: string[];
  /** Each anchor letter's tiles, in reading order. */
  marks: Record<string, TileRef[]>;
  /** The top-left tile the art was stamped at. */
  at: TileRef;
}

export interface StampOptions {
  /** Where the art's top-left corner sits. Centred in the grid when omitted. */
  at?: TileRef;
  /**
   * Add the sealed larder and the sealed den to the bottom two rows. On by
   * default, and turned off only by a scenario that keeps the board unclearable
   * and its predators housed some other way — which no scenario yet does.
   */
  larder?: boolean;
}

/**
 * Stamp a small piece of ASCII art into a full-size layout, ready for `setMaze`.
 *
 * The art is the fixture, drawn the way it reads on screen — one string per row,
 * one character per tile:
 *
 * | Character | The tile is |
 * | --- | --- |
 * | `#` or a space | rock |
 * | `.` | corridor |
 * | `d` / `g` | den interior / the den gate |
 * | any `A`-`Z` | corridor, AND a named anchor the scenario asks for by that letter |
 *
 * Anchors are what keeps a scenario readable: it draws the corridor it wants and
 * labels the tiles that matter rather than computing offsets. `F........P` is a
 * ten-tile straight run with the forager's tile at one end and a predator's at
 * the other.
 *
 * Everything outside the art is rock. The art is centred in the build's OWN
 * reported grid unless `at` places it, so a build whose grid is not the specified
 * `36 x 18` gets its fixture stamped somewhere valid rather than a layout of the
 * wrong size. A letter used twice yields both tiles, in reading order.
 *
 * Pure: it reads a frame and a layout and returns another layout, so it is the
 * one part of this module a test can drive without a build.
 */
export function stampLayout(
  view: { grid: GridFrame },
  art: readonly string[],
  options: StampOptions = {},
): Stamped {
  const { cols, rows: gridRows } = view.grid;
  const height = art.length;
  const width = Math.max(0, ...art.map((line) => line.length));
  const top = options.at ? options.at.ty : Math.floor((gridRows - height) / 2);
  const left = options.at ? options.at.tx : Math.floor((cols - width) / 2);
  if (top < 0 || left < 0 || top + height > gridRows || left + width > cols) {
    throw new FixtureTooLarge(
      `a ${width}x${height} fixture does not fit this build's ${cols}x${gridRows} ` +
        `grid at (${left}, ${top})`,
    );
  }

  const grid: string[][] = Array.from({ length: gridRows }, () =>
    new Array<string>(cols).fill("#"),
  );
  const marks: Record<string, TileRef[]> = {};
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < art[row].length; col += 1) {
      const character = art[row][col];
      if (character === "#" || character === " ") continue;
      const tx = left + col;
      const ty = top + row;
      if (character === "." || character === "d" || character === "g") {
        grid[ty][tx] = character;
        continue;
      }
      if (!/[A-Z]/.test(character)) {
        throw new Error(
          `stampLayout: unknown fixture character ${JSON.stringify(character)} ` +
            `at art (${col}, ${row})`,
        );
      }
      grid[ty][tx] = ".";
      (marks[character] ??= []).push({ tx, ty });
    }
  }

  if (options.larder !== false) {
    const last = gridRows - 1;
    const above = gridRows - 2;
    if (
      grid[last].some((cell) => cell !== "#") ||
      grid[above].some((cell) => cell !== "#")
    ) {
      throw new Error(
        "stampLayout: the fixture reaches the bottom two rows, which the larder " +
          "and the den need; pass { larder: false } and keep the board " +
          "unclearable and its predators housed another way",
      );
    }
    // The larder: a walled-off run of corridor the forager can never reach, so
    // `planktonRemaining` never reaches `0` however long the scenario grazes.
    for (let tx = 1; tx <= Math.min(3, cols - 2); tx += 1) grid[last][tx] = ".";
    // And the den, sealed in the same two rows: the gate above the chamber with
    // rock on its other three sides, so a build that runs the release schedule
    // anyway gets no further than the gate tile.
    const gate = cols - 3;
    grid[above][gate] = "g";
    for (let tx = gate - 1; tx <= gate + 1; tx += 1) grid[last][tx] = "d";
  }

  return {
    rows: grid.map((row) => row.join("")),
    marks,
    at: { tx: left, ty: top },
  };
}

/* -------------------------------------------------------------------------- */
/* Posing one                                                                 */
/* -------------------------------------------------------------------------- */

/** The board a poser left standing, and how to find its anchors. */
export interface PosedBoard<S extends BoardSnapshot> {
  /** The state after the layout is in place and the forager has been placed. */
  snap: S;
  /** The top-left tile the art was stamped at. */
  at: TileRef;
  /** The single tile an anchor letter labels. Fails loudly if it labels several. */
  mark(letter: string): TileRef;
  /** Every tile an anchor letter labels, in reading order. */
  all(letter: string): TileRef[];
}

export interface PoseMazeOptions extends StampOptions {
  /**
   * Check that `setMaze` housed every predator. On by default; the one item that
   * OWNS that claim — `controls/setmaze-houses-predators` — poses with it off and
   * asserts the housing itself.
   */
  housed?: boolean;
}

/** Every den or gate tile of a board, as the keys a housing check holds. */
export function housedTiles(view: MazeView): Set<string> {
  const housed = new Set<string>();
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      const tile = view.tiles[ty]?.[tx];
      if (tile === "d" || tile === "g") housed.add(`${tx},${ty}`);
    }
  }
  return housed;
}

/** One predator standing outside the den, described by the ground it stands on. */
export interface LoosePredator extends TileRef {
  kind: string;
  /** `"open corridor"`, `"rock"`, or `"off the board"`. */
  ground: string;
  /** The phrase both the refusal and the item that owns the claim report. */
  where: string;
}

/** The predators standing outside `housed`, in the snapshot's own order. */
export function loosePredators(
  snap: BoardSnapshot,
  housed: Set<string>,
): LoosePredator[] {
  return snap.predators
    .filter((predator) => !housed.has(`${predator.tx},${predator.ty}`))
    .map((predator) => {
      const tile = snap.tiles[predator.ty]?.[predator.tx];
      const ground =
        tile === "."
          ? "open corridor"
          : tile === undefined
            ? "off the board"
            : "rock";
      return {
        kind: predator.kind,
        tx: predator.tx,
        ty: predator.ty,
        ground,
        where: `the ${predator.kind} at (${predator.tx}, ${predator.ty}), on ${ground}`,
      };
    });
}

/**
 * Refuse to grade a posed scenario whose predators were not put away by
 * `setMaze` — and refuse NARROWLY.
 *
 * `specs/instrumentation.md` has the op leave "every predator returned to a den
 * tile with its `released` flag `false`", and every fixture from
 * {@link stampLayout} carries a real den for them to be returned TO. A build that
 * rebuilds the board but leaves its hunters wherever its own den used to be drops
 * them onto whatever the fixture put at those coordinates, which is frequently
 * the corridor the scenario is about. One run went exactly that way: a Lanternjaw
 * stood in the middle of a posed corridor, the forager swam into it a quarter of
 * a second in, and the item reported "holding ArrowUp gives the forager an upward
 * heading — expected up, actual left", `left` being the facing it respawns on.
 * Three items blamed input and turning for an unmet `setMaze` contract, and
 * nothing named `setMaze`.
 *
 * ONLY A PREDATOR THAT CAN GET ANYWHERE STOPS THE SCENARIO. A build that misses
 * the fixture's den misses it by whatever offset its own den sat at, and the tile
 * it lands on is as often rock as corridor. Movement is tile-locked and rock is
 * solid to every body (`specs/movement.md`), so a hunter embedded in rock cannot
 * reach the forager, the subject, or anything else: the scenario around it is the
 * one the check meant to pose, and refusing to grade it would throw a real
 * measurement away over bookkeeping. A hunter on OPEN CORRIDOR is the one that
 * can swim into the scene.
 *
 * The full contract — every predator housed, rock included — is graded by
 * `controls/setmaze-houses-predators`. This is the narrower question of whether
 * THIS scenario can still be read. A layout with no den is not checked at all:
 * `specs/instrumentation.md` says a predator returned to a den that is not there
 * "is held out of play", which fixes no tile for it to be on.
 */
export function requireHoused<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  snap: S,
): void {
  const housed = housedTiles(snap);
  if (housed.size === 0) return;
  const loose = loosePredators(snap, housed).filter(
    (predator) => predator.ground === "open corridor",
  );
  if (loose.length === 0) return;
  h.unmet(
    `setMaze left a predator loose in the posed fixture — ` +
      `${loose.map((predator) => predator.where).join("; ")}. ` +
      `specs/instrumentation.md has the op return every predator to a den tile, ` +
      `and this fixture carries a den; a hunter standing in open corridor can ` +
      `reach the forager and end the scenario, so what happens next is not this ` +
      `check's verdict — see controls/setmaze-houses-predators`,
  );
}

/**
 * Pose a fixture as the maze and hand back what a scenario needs to place things
 * on it.
 *
 * `setMaze` leaves the dive on a fresh board — a plankton on every corridor tile,
 * the fog back to unrevealed, every predator returned to the den unreleased and
 * the release schedule suspended — so a caller poses the forager and the
 * predators it wants afterwards, exactly as it would on a generated board.
 *
 * Every `pose*` helper below is built on this one, and a scenario whose shape
 * none of them draws calls it directly with art of its own.
 */
export async function poseMaze<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  art: readonly string[],
  options: PoseMazeOptions = {},
): Promise<PosedBoard<S>> {
  const before = await h.snapshot();
  let stamped: Stamped;
  try {
    stamped = stampLayout(before, art, options);
  } catch (error) {
    if (error instanceof FixtureTooLarge) {
      // The fixture is stamped into the grid the BUILD reports, so a fixture that
      // does not fit is a statement about that grid rather than about the subject
      // of this check. `specs/overview.md` fixes the grid at 36 x 18 and
      // `instrumentation/snapshot-shape` is the item that reads it back.
      h.unmet(
        `${error.message} — the grid \`specs/overview.md\` fixes would hold it; ` +
          `see instrumentation/snapshot-shape`,
      );
    }
    throw error;
  }

  await h.debug.setMaze(stamped.rows);
  // If the build read the new board as a new maze and opened a dive countdown,
  // put it back into live play. `specs/instrumentation.md` has `setMaze` leave the
  // screen as it is, so this is a no-op on a conforming build — but every
  // scenario below needs live play, none of them is ABOUT which screen `setMaze`
  // leaves, and `beginPlay` is the documented way to end a countdown, so
  // normalising here keeps that reading out of fifty-odd unrelated verdicts.
  if ((await h.snapshot()).screen === "countdown") await h.debug.beginPlay();

  const snap = await h.snapshot();
  if (options.housed !== false) requireHoused(h, snap);

  return {
    snap,
    at: stamped.at,
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

/** Place the forager on a tile at rest, and face it `dir` when one is given. */
export async function placeForager<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  tile: TileRef,
  dir?: Dir,
): Promise<void> {
  await h.debug.setForagerTile(tile.tx, tile.ty);
  if (dir !== undefined) await h.debug.setForagerDir(dir);
}

/** Place one predator on a tile, and face it and state it where asked. */
export async function placePredator<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  index: number,
  tile: TileRef,
  options: { dir?: Dir; state?: "den" | "wander" | "chase" } = {},
): Promise<void> {
  await h.debug.setPredatorTile(index, tile.tx, tile.ty);
  if (options.dir !== undefined)
    await h.debug.setPredatorDir(index, options.dir);
  if (options.state !== undefined) {
    await h.debug.setPredatorState(index, options.state);
  }
}

/**
 * The index of the first predator of `kind` in the snapshot's list, or `null`.
 *
 * `specs/state.md` lists the predators in release order and the surface's
 * predator operations select one by that index, so this is how a scenario about a
 * particular hunter names it. A roster that holds none of that kind is the
 * roster's verdict rather than the caller's, so this reports rather than throws.
 */
export function predatorIndex(
  snap: BoardSnapshot,
  kind: string,
): number | null {
  const index = snap.predators.findIndex((predator) => predator.kind === kind);
  return index < 0 ? null : index;
}

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

/** A straight corridor posed as the whole board: `len` tiles running right. */
export interface StraightRun extends TileRef {
  dir: Dir;
  len: number;
}

/**
 * A straight corridor of `len` tiles posed as the whole board, the forager placed
 * at its left end facing along it.
 *
 * `spare` adds a second sealed pocket well clear of the run: ground the light has
 * never touched, for a check that reads a build's own unrevealed fog color.
 */
export async function poseStraightRun<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  len: number,
  options: { spare?: boolean } = {},
): Promise<StraightRun> {
  const tail = options.spare === true ? " ".repeat(8) + "..." : "";
  const board = await poseMaze(h, ["S" + ".".repeat(len - 1) + tail]);
  const start = board.mark("S");
  await placeForager(h, start, "right");
  return { tx: start.tx, ty: start.ty, dir: "right", len };
}

/** A straight corridor along ONE axis with the forager in the middle of it. */
export interface MoveKeyRun {
  /** The tile the forager was placed on, at rest. */
  tile: TileRef;
  /** The direction the run extends in, which the check's action names. */
  dir: Dir;
  /** The rock the forager is posed facing, across the corridor. */
  facing: Dir;
  /** How many tiles of corridor lie ahead of the forager along `dir`. */
  ahead: number;
}

/**
 * A straight corridor along the axis `dir` names, with the forager at rest in the
 * middle of it, already facing `dir`.
 *
 * POSED RATHER THAN FOUND, because whether a tile has corridor on the side a
 * given action pushes — and how much of it — is a property of the board a build
 * invented: on one board "hold left" had four tiles to cross and on another it
 * had one and a wall. Here every direction gets the same run, so the eight
 * movement-action points measure the same thing eight times.
 *
 * THE FORAGER IS FACED INTO THE ROCK ACROSS THE CORRIDOR, never along the run.
 * Faced along it, a build that ignored the keyboard entirely and simply swam the
 * way it was pointing would travel exactly as a conforming one does, and the
 * check would pass a game no key reaches. Facing rock, the forager cannot leave
 * its tile until the action is read and honoured — `specs/movement.md`: "A
 * forager at rest takes the desired direction when the tile that way is open to
 * it, and stays at rest otherwise" — so the travel a check measures is the
 * action's doing and nothing else's. The corridor is one tile wide, so both
 * tiles across it are rock and either serves.
 */
export async function poseMoveKeyRun<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  dir: Dir,
  options: { ahead?: number; behind?: number } = {},
): Promise<MoveKeyRun> {
  const ahead = options.ahead ?? 3;
  const behind = options.behind ?? 3;
  const vertical = dir === "up" || dir === "down";
  // The anchor sits `behind` tiles from the end the run starts at and `ahead`
  // from the far end, measured along `dir`, so the corridor reads the same
  // whichever of the four a check names.
  const before = dir === "up" || dir === "left" ? ahead : behind;
  const after = dir === "up" || dir === "left" ? behind : ahead;
  const art = vertical
    ? [
        ...Array<string>(before).fill("."),
        "S",
        ...Array<string>(after).fill("."),
      ]
    : [".".repeat(before) + "S" + ".".repeat(after)];
  const board = await poseMaze(h, art);
  const tile = board.mark("S");
  const facing: Dir = vertical ? "left" : "up";
  await placeForager(h, tile, facing);
  return { tile, dir, facing, ahead };
}

/** Two tiles on one straight corridor with clear line of sight between them. */
export interface SightLine {
  forager: TileRef;
  pred: TileRef;
  /** The heading that points from the forager down the corridor at the predator. */
  dir: Dir;
  /** The heading that points from the predator back at the forager. */
  toForager: Dir;
  /** How many tiles apart they stand. */
  tiles: number;
  /** A sealed pocket further along, when `refugeGap` asked for one. */
  refuge: TileRef | null;
}

/**
 * Two tiles `gapTiles` apart on one straight corridor, posed as the whole board,
 * with the forager placed on the near one.
 *
 * `lead` and `tail` are spare corridor beyond each of them, so neither party runs
 * into rock the instant it starts moving. `refugeGap` adds a SEALED pocket that
 * many tiles further on, for a scenario that then sends the forager somewhere the
 * predator's light, ping or patrol cannot follow — sealed rather than merely
 * distant, because the whole point of moving it is that what happens next cannot
 * be the predator arriving.
 */
export async function poseSightLine<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  gapTiles: number,
  options: { lead?: number; tail?: number; refugeGap?: number } = {},
): Promise<SightLine> {
  const lead = options.lead ?? 1;
  const tail = options.tail ?? 1;
  const refugeGap = options.refugeGap ?? 0;
  let art =
    ".".repeat(lead) + "F" + ".".repeat(gapTiles - 1) + "P" + ".".repeat(tail);
  if (refugeGap > 0) art += " ".repeat(refugeGap) + "R..";
  const board = await poseMaze(h, [art]);
  await placeForager(h, board.mark("F"), "right");
  return {
    forager: board.mark("F"),
    pred: board.mark("P"),
    dir: "right",
    toForager: "left",
    tiles: gapTiles,
    refuge: refugeGap > 0 ? board.mark("R") : null,
  };
}

/** A right-angle junction, and the tiles either arm of it runs through. */
export interface Corner {
  junction: TileRef;
  /** The heading that reaches the junction from `back`. */
  approach: Dir;
  back: TileRef;
  /** The heading a turn at the junction takes. */
  perp: Dir;
  /** The first tile along `perp` past the junction. */
  perpTile: TileRef;
}

/**
 * A right-angle junction posed as the whole board, with the forager placed on
 * `back` facing along the approach.
 *
 * Both arms run ON PAST the junction, so a body that does NOT turn keeps going
 * rather than being stopped by rock — which is what lets a check tell "it took
 * the turn" from "it ran out of corridor".
 */
export async function poseCorner<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  options: { arm?: number } = {},
): Promise<Corner> {
  const arm = options.arm ?? 4;
  const art = ["BJ" + ".".repeat(arm)];
  for (let i = 0; i < arm; i += 1) art.push(" ." + " ".repeat(arm));
  const board = await poseMaze(h, art);
  const junction = board.mark("J");
  await placeForager(h, board.mark("B"), "right");
  return {
    junction,
    approach: "right",
    back: board.mark("B"),
    perp: "down",
    perpTile: { tx: junction.tx, ty: junction.ty + 1 },
  };
}

/**
 * Two tiles that are far apart AND cannot reach each other: the forager's own
 * corridor, and across solid rock a separate ring for a creature to patrol.
 *
 * WHY THE TWO HALVES ARE SEALED OFF. These scenarios want a creature that keeps
 * to itself — wandering, pinging, flaring — while the forager stands somewhere
 * else as a bystander. On a real board "somewhere else" is only ever a head
 * start: a patrol crosses the whole grid in a few seconds, so a long watch ends
 * with the creature arriving, finding the forager and making the check about
 * something other than its subject. A posed board can do what a generated one may
 * not (`specs/maze.md` requires one connected region; a fixture is exempt) and
 * simply put them in different rooms.
 *
 * The ring is a loop rather than a hallway, so a patrol has somewhere to go and
 * keeps moving instead of pacing a dead end. `near` is how much corridor the
 * forager's own room has, which matters whenever the check measures something that
 * TRAVELS along corridors: a sonar pulse floods by corridor step, so a pulse cast
 * in a three-tile room reports a three-tile reach however far its range is set.
 */
export async function poseApart<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  minTiles: number,
  options: { ring?: number; spare?: boolean; near?: number } = {},
): Promise<{ near: TileRef; far: TileRef }> {
  const ring = options.ring ?? 3;
  const near = options.near ?? 3;
  const gap = Math.max(2, minTiles - near);
  const pad = " ".repeat(gap);
  const tail = options.spare === true ? " ".repeat(8) + "..." : "";
  const blank = " ".repeat(near);
  const art = [
    "N" + ".".repeat(near - 1) + pad + "F" + ".".repeat(ring) + tail,
    blank + pad + "." + " ".repeat(ring - 1) + ".",
    blank + pad + "." + ".".repeat(ring),
  ];
  const board = await poseMaze(h, art);
  await placeForager(h, board.mark("N"));
  return { near: board.mark("N"), far: board.mark("F") };
}

/** A straight-corridor ink standoff: where to ink, who waits, and where to flee. */
export interface InkStandoff {
  ink: TileRef;
  pred: TileRef;
  /** The heading from the ink tile toward the predator. */
  dir: Dir;
  /** The heading the forager swims to get clear of its own cloud. */
  flee: Dir;
  clearTiles: number;
}

/**
 * An ink standoff posed as the whole board: the forager inks on `ink`, the
 * predator waits `gap` tiles along the same corridor, and `flee` is the way the
 * forager then swims to get clear of its own `INK_RADIUS` cloud — which leaves
 * the cloud squarely between the two. `clearTiles` of corridor sit behind the ink
 * tile for that retreat.
 */
export async function poseInkStandoff<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  options: { gap: number; clearTiles?: number },
): Promise<InkStandoff> {
  const clearTiles = options.clearTiles ?? 3;
  const art = ".".repeat(clearTiles) + "I" + ".".repeat(options.gap - 1) + "P";
  const board = await poseMaze(h, [art]);
  await placeForager(h, board.mark("I"), "right");
  return {
    ink: board.mark("I"),
    pred: board.mark("P"),
    dir: "right",
    flee: "left",
    clearTiles,
  };
}

/**
 * Two open tiles with a SOLID BAND of rock on every line between them, posed as
 * the whole board. `tiles` is how far apart they stand, which decides whether the
 * pair sits inside a sensing radius the check cares about.
 *
 * WHY A BAND RATHER THAN ONE ROCK ON THE LINE. These checks watch a predator that
 * is still patrolling, so what matters is not that ONE pair of tiles is occluded
 * but that every tile the predator can reach is. A single rock with a way around
 * it gives the predator tiles at grazing angles where a check's own raycast and a
 * build's line of sight can legitimately disagree — and the check then reads that
 * disagreement as a predator lit through rock. Two parallel corridors with a full
 * band between them leave no such tile.
 *
 * TWO TILES IS NOT ENOUGH DISTANCE for a check about DARKNESS, only about line of
 * sight: a pair two tiles apart sits inside the forager's own light pocket
 * (`V >= 96`), and a build is entitled to paint that pocket as a glow. A check
 * that reads pixels stands its pair five tiles apart, past the pocket.
 */
export async function poseOccludedPair<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  options: { tiles?: number; len?: number } = {},
): Promise<{ forager: TileRef; pred: TileRef; tiles: number }> {
  const tiles = options.tiles ?? 2;
  const len = options.len ?? 5;
  const art = ["F" + ".".repeat(len - 1)];
  for (let i = 1; i < tiles; i += 1) art.push("");
  art.push("P" + ".".repeat(len - 1));
  const board = await poseMaze(h, art);
  await placeForager(h, board.mark("F"), "right");
  return { forager: board.mark("F"), pred: board.mark("P"), tiles };
}

/** One tile a sonar pulse floods to, and how many corridor steps out it is. */
export interface SonarTarget extends TileRef {
  /** Corridor steps from the forager's tile — the unit `E` is measured in. */
  steps: number;
}

/**
 * A dog-leg corridor posed as the whole board, returning the tiles a pulse from
 * the forager reaches AROUND THE BEND, nearest first.
 *
 * These are tiles the pulse can flood to but the LIGHT cannot see: the return leg
 * sits directly under the outward leg with a band of rock between, so every line
 * from the forager to a target crosses rock while the corridor still joins them
 * in a few steps. That separation is the whole point of the sonar checks —
 * anything revealed out there was revealed by the pulse and not by standing
 * close.
 */
export async function poseSonarSense<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  count = 1,
): Promise<SonarTarget[]> {
  const board = await poseMaze(h, ["F..", "  .", "..."]);
  const forager = board.mark("F");
  await placeForager(h, forager, "right");
  return [
    { tx: forager.tx + 2, ty: forager.ty + 2, steps: 4 },
    { tx: forager.tx + 1, ty: forager.ty + 2, steps: 5 },
    { tx: forager.tx, ty: forager.ty + 2, steps: 6 },
  ].slice(0, count);
}

/** A corridor closed by rock, and the tiles the light must and must not reach. */
export interface LitWallProbe extends TileRef {
  dir: Dir;
  run: number;
  /** The rock that closes the corridor, `run + 1` tiles along. */
  wall: TileRef;
  /** The corridor tile on the FAR side of that rock, which must stay unrevealed. */
  behind: TileRef;
  /** The rock the forager itself stands against. */
  flankWalls: TileRef[];
}

/**
 * A short corridor closed by rock, posed as the whole board, with the forager at
 * one end facing down it.
 *
 * `behind` is what makes the check decidable — a tile the light must NOT reach —
 * and a corridor that simply ran into the grid border, as one found on a build's
 * own board often does, has no far side at all.
 */
export async function poseLitWallProbe<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  options: { run?: number } = {},
): Promise<LitWallProbe> {
  const run = options.run ?? 3;
  const board = await poseMaze(h, ["F" + ".".repeat(run) + "#."]);
  const forager = board.mark("F");
  await placeForager(h, forager, "right");
  return {
    tx: forager.tx,
    ty: forager.ty,
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

/**
 * A standoff on one straight run: a hunter on `pred`, the forager on `fix` where
 * the hunter takes its fix, and `slip` further along, where the forager goes
 * afterwards — far enough that a hunter still holding the stale fix cannot reach
 * it, which is what the check measures.
 */
export async function poseDimStandoff<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  options: { predTiles?: number; slipTiles?: number } = {},
): Promise<{ pred: TileRef; fix: TileRef; slip: TileRef; dir: Dir }> {
  const predTiles = options.predTiles ?? 2;
  const slipTiles = options.slipTiles ?? 6;
  const art =
    "P" + ".".repeat(predTiles - 1) + "X" + ".".repeat(slipTiles - 1) + "S";
  const board = await poseMaze(h, [art]);
  await placeForager(h, board.mark("X"), "right");
  return {
    pred: board.mark("P"),
    fix: board.mark("X"),
    slip: board.mark("S"),
    dir: "right",
  };
}

/**
 * A rock spine a chasing hunter must go the long way around, posed as the whole
 * board: the hunter on `pred`, the forager on `fix`, and a band of rock across
 * the straight line between them.
 *
 * The two rows are joined at their right-hand ends alone, so the only route from
 * one to the other rounds the spine. A hunter that reaches the forager's row
 * without ever standing on rock has honoured `specs/movement.md`; a hunter that
 * arrives by walking through the band has not.
 */
export async function poseRockSpine<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  options: { len?: number } = {},
): Promise<{ pred: TileRef; fix: TileRef; spine: TileRef[] }> {
  const len = options.len ?? 5;
  const spineWidth = len - 1;
  const art = [
    "P" + ".".repeat(len - 1),
    "#".repeat(spineWidth) + ".",
    "F" + ".".repeat(len - 1),
  ];
  const board = await poseMaze(h, art);
  await placeForager(h, board.mark("F"), "right");
  const spine: TileRef[] = [];
  for (let i = 0; i < spineWidth; i += 1) {
    spine.push({ tx: board.at.tx + i, ty: board.at.ty + 1 });
  }
  return { pred: board.mark("P"), fix: board.mark("F"), spine };
}

/**
 * A single corridor tile with no open neighbor at all, and a corridor elsewhere
 * for the forager to stand in, posed as the whole board.
 *
 * The other half of the same rule: `specs/movement.md` says "a body standing on a
 * tile whose neighbors are all closed to it stays where it stands", so a
 * conforming predator posed on `boxed` never moves however hard it is chasing. A
 * build that fails the spine shape often passes this one and the other way about,
 * which is why the item asks both.
 */
export async function poseBoxedTile<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  options: { gap?: number } = {},
): Promise<{ boxed: TileRef; forager: TileRef }> {
  const gap = options.gap ?? 3;
  const board = await poseMaze(h, ["B" + " ".repeat(gap) + "F.."]);
  await placeForager(h, board.mark("F"), "right");
  return { boxed: board.mark("B"), forager: board.mark("F") };
}

/* -------------------------------------------------------------------------- */
/* Reading a posed board                                                      */
/* -------------------------------------------------------------------------- */

/** The logical center of a tile, from the frame the snapshot reports. */
export function tileCenterOf(
  grid: GridFrame,
  tile: TileRef,
): { x: number; y: number } {
  return {
    x: grid.originX + tile.tx * grid.tile + grid.tile / 2,
    y: grid.originY + tile.ty * grid.tile + grid.tile / 2,
  };
}

/** The straight-line distance between two tile centers, in logical units. */
export function tileGap(grid: GridFrame, a: TileRef, b: TileRef): number {
  const from = tileCenterOf(grid, a);
  const to = tileCenterOf(grid, b);
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** The visibility character reported for a tile (`u`, `r` or `l`). */
export function visibilityAt(
  snap: BoardSnapshot,
  tile: TileRef,
): string | undefined {
  return snap.visibility[tile.ty]?.[tile.tx];
}

/**
 * A direction from `tile` with no corridor beyond it, or `null` at a crossroads.
 *
 * What a bystander scenario faces the forager into: a heading that leads nowhere
 * cannot take it off its tile under either reading of `specs/movement.md`.
 */
export function walledDir(view: MazeView, tile: TileRef): Dir | null {
  for (const dir of ALL_DIRS) {
    const next = step(view, tile.tx, tile.ty, dir);
    if (!isCorridor(view, next.tx, next.ty)) return dir;
  }
  return null;
}
