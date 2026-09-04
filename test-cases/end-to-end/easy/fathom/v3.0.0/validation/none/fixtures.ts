// Fathom — the posed-fixture machinery. CASE-PROVIDED.
//
// WHAT IS SHARED. This file is byte-identical in `validation/none/`,
// `validation/simple-2d/` and `validation/structured-2d/`. It drives the game,
// which `maze.ts` never does, but it drives it through {@link FixtureHost} — a
// structural reading of the debug surface's imperative form that every engine's
// harness already satisfies. Every operation it calls is one
// `specs/instrumentation.md` fixes, and every one of them is declared
// {@link Awaitable}, because reaching a build through a browser page answers
// with a promise and reaching one in process does not. Every call below is
// awaited, which is correct under both.
//
// WHAT IS NOT SHARED, AND WHY. Nothing in this file, which is the point: a check
// that poses a straight run, a corner or an occluded pair reads the same under
// every engine, and the ASCII art it poses is one drawing rather than three. The
// pure parts — the tile alphabet, the reachability reads, the walled-side
// reading {@link faceWall} takes — live in `maze.ts` instead, so only the driving
// is here. The whole library is carried under every engine even where one
// engine's checks do not yet call every poser, because one file is what keeps
// the fixtures one drawing.
//
// WHY A CHECK POSES THE GEOMETRY IT IS ABOUT. The maze is the build's own design
// (`specs/maze.md` fixes its rules and nothing else), so a scenario that needs a
// shape — a straight run of a given length, a corner to turn, a corridor ending
// in rock, two tiles with a band of rock between them — can otherwise only go
// hunting for one in whatever board this build happened to draw, and take what
// it finds. What it finds differs from build to build: a different amount of
// room, a different approach, sometimes nothing usable. A check that POSES the
// shape it is about measures the behavior it names instead of the layout it
// landed in.
//
// `setMaze` is what makes that legitimate. `specs/instrumentation.md` exempts a
// posed fixture from every rule in `specs/maze.md` — dead ends, corridors wider
// than one tile, asymmetry, disconnected regions, a missing wrap tunnel are all
// legal in a fixture — and requires the game to keep running on one exactly as
// though it were the maze it had laid out itself. The eight `maze/*` points are
// the exception that proves it: they read the build's OWN board, because finding
// those properties there is the check (see `maze.ts`).
//
// THE ART IS THE FIXTURE, drawn the way it reads on screen: one string per row,
// one character per tile.
//
//   `#` or a space   rock
//   `.`              corridor
//   `d` / `g`        den interior / the den gate
//   any `A`-`Z`      corridor, AND a named anchor the check asks for by letter
//
// Anchors are what keep a scenario readable: it draws the corridor it wants and
// labels the tiles that matter, rather than computing offsets. `F........P` is a
// ten-tile straight run with the forager's tile at one end and a predator's at
// the other. Everything outside the art is rock, and the art is centred in the
// build's OWN reported grid, so a build whose maze is not `36 x 18` still gets
// its fixture stamped somewhere valid rather than a layout of the wrong size.
//
// THE WORLD A FIXTURE POSES HOLDS ONLY WHAT THE CHECK IS ABOUT. {@link poseMaze}
// lays the art down as the whole maze and then EMPTIES the board: every predator
// off the roster, every drifter off the maze, every plankton off the layout, and
// the fog back to unrevealed. A check then spawns back exactly the creature its
// requirement concerns, on a tile it names, and puts a plankton where it wants
// one.
//
// REMOVAL RATHER THAN CONTAINMENT, which is the whole reason the surface carries
// `clearPredators`, `clearDrifters` and `clearPlankton`. A hunter parked in a
// walled ring, a den sealed on three sides, a larder of pellets nothing can
// reach: every one of those leans on the game's own rules holding — that rock is
// solid, that a denned hunter stays denned, that an unreachable pellet is never
// eaten — and those rules are exactly what a broken build gets wrong. A build
// that lets a body cross rock takes fifty scenarios apart at once and each of
// them reports the wreckage under its own heading. A board with nothing on it
// cannot come apart, because there is nothing left to escape.
//
// WHAT EMPTYING SETTLES, point by point.
//
//   - THE MAZE CANNOT CLEAR. `specs/gameplay.md` clears a maze when the forager
//     eats a plankton with none left after it, so a board carrying none is
//     never cleared however far the forager travels, and the descent that would
//     end a scenario mid-measurement cannot happen.
//   - NO DRIFTER ARRIVES. The bonus cadence admits a drifter only while plankton
//     remain (`specs/gameplay.md`), so an emptied board stays drifter-free
//     without a single rule being suspended.
//   - NOTHING IS EATEN UNDERFOOT. A forager placed on a bare tile eats nothing,
//     so the brightness a check poses is the brightness it measures.
//   - NO HUNTER IS RELEASED. The staggered schedule runs on the roster
//     (`specs/predators.md`), and an empty roster runs none.
//   - THE FOG IS FRESH. `setMaze` leaves the revealed-tile memory exactly as it
//     stands (`specs/instrumentation.md`), so the fixture clears it rather than
//     measuring what the previous board had lit.
//
// AND WITHIN THE CREATURE A CHECK IS ABOUT, ONLY THE FACULTIES ITS REQUIREMENT
// EXERCISES. Emptying the board settles the bystanders; the subject is settled by
// the two switches `specs/instrumentation.md` gives every creature. A check about
// what a hunter SENSES gives it its mind and holds its travel, so it acquires,
// alerts and reports from the tile the fixture stood it on and never walks out of
// the scenario. A check that needs a body present but inert holds its mind, and
// nothing is decided for it to carry out. A check about how a hunter TRAVELS holds
// neither, because travel is the thing it grades. Each hold is READ BACK at the
// pose, so a build whose switch does nothing fails the check that asked for it
// rather than being measured in a world it never posed.
//
// THE FORAGER IS PLACED EXPLICITLY. `setMaze` moves nothing, so the forager
// stands wherever it stood on the board before — which the new layout may have
// closed over. Every poser below puts it on a named anchor of its own fixture,
// and so must any scenario that poses art of its own.

import { fail } from "./assert";
import {
  CORRIDOR,
  DEN,
  GATE,
  ROCK,
  walledDir,
  type Dir,
  type MazeView,
  type Tile,
} from "./maze";

/** A value a driver may answer with directly or through a promise. */
export type Awaitable<T> = T | Promise<T>;

/** The forager, as much of it as a poser reads (`specs/state.md`). */
export interface ForagerView {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: string;
  moving: boolean;
}

/** One predator, as much of it as a poser reads (`specs/state.md`). */
export interface PredatorView {
  kind: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: string;
  released: boolean;
  mind: boolean;
  travel: boolean;
}

/** One bonus drifter, as much of it as a poser reads (`specs/state.md`). */
export interface DrifterView {
  x: number;
  y: number;
  tx: number;
  ty: number;
  mind: boolean;
  travel: boolean;
}

/**
 * The board a fixture reads back after posing itself.
 *
 * Structural rather than imported from a `surface.ts`, so this module is the
 * same file under every engine: each engine's own full snapshot type satisfies
 * it, and a check keeps that fuller type by reading the harness directly.
 */
export interface FixtureBoard extends MazeView {
  screen: string;
  forager: ForagerView;
  predators: readonly PredatorView[];
  drifters: readonly DrifterView[];
}

/** The three states `setPredatorState` poses (`specs/instrumentation.md`). */
export type PosedPredatorState = "den" | "wander" | "chase";

/** The operations a fixture drives, exactly as `specs/instrumentation.md` fixes them. */
export interface FixtureOps {
  setMaze(rows: readonly string[]): Awaitable<void>;
  clearPredators(): Awaitable<void>;
  clearDrifters(): Awaitable<void>;
  clearPlankton(): Awaitable<void>;
  clearFog(): Awaitable<void>;
  setPlankton(tx: number, ty: number, present: boolean): Awaitable<void>;
  setForagerTile(tx: number, ty: number): Awaitable<void>;
  setForagerDir(dir: Dir): Awaitable<void>;
  addPredator(kind: string, tx: number, ty: number): Awaitable<void>;
  setPredatorTile(index: number, tx: number, ty: number): Awaitable<void>;
  setPredatorDir(index: number, dir: Dir): Awaitable<void>;
  setPredatorState(index: number, value: PosedPredatorState): Awaitable<void>;
  setPredatorReleased(index: number, released: boolean): Awaitable<void>;
  setPredatorMind(index: number, enabled: boolean): Awaitable<void>;
  setPredatorTravel(index: number, enabled: boolean): Awaitable<void>;
  spawnDrifter(tx: number, ty: number): Awaitable<void>;
  setDrifterMind(index: number, enabled: boolean): Awaitable<void>;
  setDrifterTravel(index: number, enabled: boolean): Awaitable<void>;
}

/** What a poser needs of a harness: the surface, and a read of the board. */
export interface FixtureHost {
  readonly debug: FixtureOps;
  snapshot(): Awaitable<FixtureBoard>;
}

/* -------------------------------------------------------------------------- */
/* Stamping a fixture                                                         */
/* -------------------------------------------------------------------------- */

/** Where the art was stamped, and what each of its letters labels. */
export interface Stamped {
  /** The layout to hand `setMaze`, one string per grid row. */
  rows: string[];
  /** Each capital letter of the art, and every tile it labels, in reading order. */
  marks: Record<string, Tile[]>;
  /** The top-left tile of the board the art was stamped at. */
  at: Tile;
}

/** A posed fixture, as a scenario reads its own anchors back. */
export interface Posed extends Stamped {
  /** The one tile `letter` labels. Throws when the art labels it any other number of times. */
  mark(letter: string): Tile;
  /** Every tile `letter` labels, in reading order. */
  all(letter: string): Tile[];
}

export interface StampOptions {
  /** The top-left tile to stamp the art at. It is centred when this is omitted. */
  at?: Tile;
}

/**
 * Stamp a piece of ASCII art into a full-size layout, ready for `setMaze`.
 *
 * Pure: it reads the grid's frame and returns rows. Nothing is posed until
 * {@link poseMaze} takes them.
 */
export function stampLayout(
  view: MazeView,
  art: readonly string[],
  options: StampOptions = {},
): Stamped {
  const { cols, rows } = view.grid;
  const height = art.length;
  const width = Math.max(0, ...art.map((line) => line.length));
  const top = options.at ? options.at.ty : Math.floor((rows - height) / 2);
  const left = options.at ? options.at.tx : Math.floor((cols - width) / 2);
  if (top < 0 || left < 0 || top + height > rows || left + width > cols) {
    // The fixture is stamped into the grid the BUILD reports, and
    // `specs/overview.md` fixes that grid at GRID_COLS (36) by GRID_ROWS (18),
    // which holds every fixture this suite draws. A grid that cannot hold one is
    // a grid of the wrong size, so the check that reached for it fails here.
    fail(
      `a grid that holds this check's ${width}x${height} fixture at ` +
        `(${left}, ${top}); specs/overview.md fixes the grid at GRID_COLS (36) ` +
        `by GRID_ROWS (18)`,
      `${cols}x${rows}`,
    );
  }

  const cells: string[][] = Array.from({ length: rows }, () =>
    new Array<string>(cols).fill(ROCK),
  );
  const marks: Record<string, Tile[]> = {};
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < art[row].length; col += 1) {
      const glyph = art[row][col];
      if (glyph === ROCK || glyph === " ") continue;
      const tile: Tile = { tx: left + col, ty: top + row };
      if (glyph === CORRIDOR || glyph === DEN || glyph === GATE) {
        cells[tile.ty][tile.tx] = glyph;
        continue;
      }
      if (!/^[A-Z]$/.test(glyph)) {
        throw new Error(
          `stampLayout: unknown fixture character ${JSON.stringify(glyph)} ` +
            `at art (${col}, ${row})`,
        );
      }
      cells[tile.ty][tile.tx] = CORRIDOR;
      (marks[glyph] ??= []).push(tile);
    }
  }

  const stamped = cells.map((line) => line.join(""));
  const pierced = stamped.findIndex(
    (line) => line[0] !== ROCK && line[line.length - 1] !== ROCK,
  );
  if (pierced >= 0) {
    throw new Error(
      `stampLayout: the fixture opens both border columns on row ${pierced}, ` +
        "which poses a wrap tunnel the scenario did not ask for",
    );
  }
  return { rows: stamped, marks, at: { tx: left, ty: top } };
}

/* -------------------------------------------------------------------------- */
/* Posing one                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Empty the board of everything but the forager, leaving the layout as it stands.
 *
 * What {@link poseMaze} does after it has set the layout, and what the handful of
 * points that read the game's OWN maze — the wrap tunnel, the structural rules,
 * the descent — call directly. Every predator off the roster, every drifter off
 * the maze, every plankton off the layout, and the fog back to unrevealed.
 */
export async function clearWorld(h: FixtureHost): Promise<void> {
  await h.debug.clearPredators();
  await h.debug.clearDrifters();
  await h.debug.clearPlankton();
  await h.debug.clearFog();
}

/**
 * Pose a fixture as the whole maze on an EMPTIED board, and hand back its
 * anchors.
 *
 * `setMaze` sets the layout and nothing else (`specs/instrumentation.md`), so
 * everything the previous board carried is still standing after it: the roster,
 * the drifters, the plankton and the revealed-tile memory. This takes all four
 * away, leaving a world holding the forager alone. A caller then places the
 * forager and spawns back exactly the creatures its requirement concerns.
 *
 * Every `pose*` helper below is built on this one, and a scenario whose shape
 * none of them draws calls it directly with art of its own.
 */
export async function poseMaze(
  h: FixtureHost,
  art: readonly string[],
  options: StampOptions = {},
): Promise<Posed> {
  const before = await h.snapshot();
  const stamped = stampLayout(before, art, options);
  await h.debug.setMaze(stamped.rows);
  await clearWorld(h);

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
 * Place the forager on `tile`, facing `dir` where one is given.
 *
 * Every poser ends with one of these. The two operations are atomic
 * (`specs/instrumentation.md`), so a facing is posed beside a tile rather than
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

/** Place one predator on a tile, and face it and state it where asked. */
export async function placePredator(
  h: FixtureHost,
  index: number,
  tile: Tile,
  options: { dir?: Dir; state?: PosedPredatorState } = {},
): Promise<void> {
  await h.debug.setPredatorTile(index, tile.tx, tile.ty);
  if (options.dir !== undefined) {
    await h.debug.setPredatorDir(index, options.dir);
  }
  if (options.state !== undefined) {
    await h.debug.setPredatorState(index, options.state);
  }
}

/** How a scenario asks for one hunter of its own. */
export interface SpawnOptions {
  /** The facing to give it. Left at the `"up"` a new predator arrives on when omitted. */
  dir?: Dir;
  /** The state to put it in. Left at the `"wander"` it arrives on when omitted. */
  state?: PosedPredatorState;
  /** Pass `false` to hold it inert: present and solid, sensing and deciding nothing. */
  mind?: boolean;
  /** Pass `false` to hold its body still while its mind runs on. */
  travel?: boolean;
}

/**
 * Add one hunter of `kind` to an emptied roster and hand back its index.
 *
 * `addPredator` puts it at the end of `predators` loose, released, minded and
 * facing `"up"` (`specs/instrumentation.md`), so a check that spawned nothing
 * else gets index `0`, the second `1`, and so on. Reading the roster back rather
 * than counting is what keeps that true of a build whose `addPredator` answers
 * differently: the index this returns is the one the snapshot actually holds.
 *
 * THE TWO FACULTIES ARE POSED SEPARATELY, because a requirement rarely exercises
 * both. `mind: false` is how a scenario keeps a hunter that must be PRESENT but
 * must not act — the second body a sonar mark or a flare is read against, the
 * prop a shape or a sheet is read off. It senses nothing and decides nothing, so
 * nothing is carried out and it holds where it stands, while contact with it
 * still costs a life. `travel: false` is how a scenario keeps a hunter that must
 * SENSE but must not travel — the hunter an alert, a fix, a lock or a ping is
 * read off. Its mind runs untouched through the code play runs, and only its
 * body is held (`specs/instrumentation.md`).
 *
 * A check whose subject is how a hunter MOVES — its speed, its routing, its
 * cornering, its release — passes neither, because travel is the thing it grades.
 */
export async function spawnPredator(
  h: FixtureHost,
  kind: string,
  tile: Tile,
  options: SpawnOptions = {},
): Promise<number> {
  await h.debug.addPredator(kind, tile.tx, tile.ty);
  const index = (await h.snapshot()).predators.length - 1;
  if (options.dir !== undefined)
    await h.debug.setPredatorDir(index, options.dir);
  if (options.state !== undefined) {
    await h.debug.setPredatorState(index, options.state);
  }
  if (options.mind === false) await h.debug.setPredatorMind(index, false);
  if (options.travel === false) await h.debug.setPredatorTravel(index, false);
  if (options.mind === false || options.travel === false) {
    const posed = (await h.snapshot()).predators[index];
    if (options.mind === false) {
      requireHeld(posed?.mind, `the ${kind}`, "mind", "setPredatorMind");
    }
    if (options.travel === false) {
      requireHeld(posed?.travel, `the ${kind}`, "travel", "setPredatorTravel");
    }
  }
  return index;
}

/**
 * A faculty a scenario asked to hold is REPORTED held, or the check that asked
 * fails.
 *
 * A pose that did not take is a world the check could not arrange, and a check
 * measuring a scenario it did not pose is worth nothing: `specs/state.md` has
 * every creature report both faculties, and `specs/instrumentation.md` makes the
 * surface a deliverable of the build like any other. So the read-back happens at
 * the pose, where the failure can still name the operation, rather than
 * surfacing later as whatever an unheld body wandered into.
 */
function requireHeld(
  reported: boolean | undefined,
  who: string,
  faculty: string,
  operation: string,
): void {
  if (reported === false) return;
  fail(
    `${who} to report \`${faculty}\` false after ${operation}(index, false), ` +
      "which this scenario poses so that it holds",
    reported === undefined
      ? "the creature was not on the board to be read back"
      : `${faculty} read ${JSON.stringify(reported)}`,
  );
}

/**
 * Hold every predator on the roster where it stands, each one's mind running on.
 *
 * For the points that read the roster a maze LAID OUT rather than spawning a
 * hunter of their own — the release schedule, what a catch costs, what a posed
 * layout leaves alone. None of those is about how a hunter travels, and a roster
 * left free to travel is a roster of bystanders any one of which can end the
 * scenario by walking into the forager. `setPredatorTravel(index, false)` holds
 * one body and leaves its mind untouched (`specs/instrumentation.md`), so the
 * schedule still turns `released` over on time and contact still costs a life.
 *
 * Hands back how many it held, which is a caller's reading of the roster it
 * found.
 */
export async function holdPredators(h: FixtureHost): Promise<number> {
  const board = await h.snapshot();
  for (let index = 0; index < board.predators.length; index += 1) {
    await h.debug.setPredatorTravel(index, false);
  }
  const held = await h.snapshot();
  for (const [index, predator] of held.predators.entries()) {
    requireHeld(
      predator.travel,
      `the ${predator.kind} at index ${index}`,
      "travel",
      "setPredatorTravel",
    );
  }
  return board.predators.length;
}

/**
 * Empty the roster and stand ONE hunter on `tile`, holding its body there.
 *
 * The staged catch, for the points whose requirement is what a CONTACT costs
 * rather than what the roster does. `specs/gameplay.md` costs a life for contact
 * "whatever that predator's kind and whatever it is doing", so the world those
 * points concern holds exactly one hunter, and every other body comes off the
 * board rather than being frozen on it: a held bystander is still a body the
 * game's own rules could set moving again, and one that escaped would take the
 * very life the point is counting.
 *
 * Its travel is held and its mind left running, which is the pair that makes a
 * posed contact stand still long enough to be resolved
 * (`specs/instrumentation.md`), and it is posed into `"chase"` so the hunter that
 * takes the life is a hunter that has the forager rather than one that wandered
 * onto it.
 *
 * CALL IT AGAIN FOR EVERY ATTEMPT. A lost life sets the maze up afresh
 * (`specs/progression.md`), which lays the depth's whole roster back out, so the
 * one hunter this staged is gone by the time the next attempt opens.
 */
export async function stageCatch(h: FixtureHost, tile: Tile): Promise<number> {
  await h.debug.clearPredators();
  return spawnPredator(h, CATCH_KIND, tile, {
    state: "chase",
    travel: false,
  });
}

/**
 * The kind {@link stageCatch} stands on the forager.
 *
 * Deliberately a NAMED kind rather than the roster's index `0`: with the roster
 * emptied there is no release order left to index into, and `specs/gameplay.md`
 * makes contact cost a life whatever the kind, so which one it is says nothing
 * about the reading.
 */
const CATCH_KIND = "lanternjaw";

/**
 * Add one bonus drifter and hand back its index, on the same reading.
 *
 * Its two faculties are posed separately, as a hunter's are. `mind: false`
 * leaves it deciding nothing, so nothing is carried out and it holds where it
 * stands; `travel: false` holds its body while its wander runs on. Under either
 * it is still drawn, still eaten by a forager whose tile it shares, and still
 * worth the ordinary bonus (`specs/instrumentation.md`).
 */
export async function spawnDrifter(
  h: FixtureHost,
  tile: Tile,
  options: { mind?: boolean; travel?: boolean } = {},
): Promise<number> {
  await h.debug.spawnDrifter(tile.tx, tile.ty);
  const index = (await h.snapshot()).drifters.length - 1;
  if (options.mind === false) await h.debug.setDrifterMind(index, false);
  if (options.travel === false) await h.debug.setDrifterTravel(index, false);
  if (options.mind === false || options.travel === false) {
    const posed = (await h.snapshot()).drifters[index];
    if (options.mind === false) {
      requireHeld(posed?.mind, "the drifter", "mind", "setDrifterMind");
    }
    if (options.travel === false) {
      requireHeld(posed?.travel, "the drifter", "travel", "setDrifterTravel");
    }
  }
  return index;
}

/**
 * Put a plankton on every open corridor tile of the board, as a laid-out maze
 * carries one (`specs/gameplay.md`).
 *
 * For the handful of checks whose subject IS the grazing — what a pellet is
 * worth, what the light does when one is eaten, what clearing pays. Everything
 * else runs on the bare board {@link poseMaze} leaves, where nothing is eaten by
 * accident and the maze can never clear.
 *
 * `except` names tiles to leave bare, which is how a check keeps the tile it
 * parks the forager on from being a pellet the first tick eats.
 */
export async function stockPlankton(
  h: FixtureHost,
  except: readonly Tile[] = [],
): Promise<number> {
  const board = await h.snapshot();
  const skip = new Set(except.map((tile) => `${tile.tx},${tile.ty}`));
  let placed = 0;
  for (let ty = 0; ty < board.tiles.length; ty += 1) {
    for (let tx = 0; tx < board.tiles[ty].length; tx += 1) {
      if (board.tiles[ty][tx] !== CORRIDOR) continue;
      if (skip.has(`${tx},${ty}`)) continue;
      await h.debug.setPlankton(tx, ty, true);
      placed += 1;
    }
  }
  return placed;
}

/**
 * Face the forager at rock, so a build whose forager travels on with no action
 * held still holds the tile it was placed on.
 *
 * `specs/movement.md` has a forager at rest take its desired direction when the
 * tile that way is open and stay at rest otherwise, so a heading that leads into
 * rock cannot take it off the tile under any conforming reading. Where the tile
 * is a full crossroads the facing is left alone, which is the best available and
 * is what a resting build does anyway.
 *
 * Only for a scenario whose forager is a BYSTANDER. A check that reads the
 * forager's own heading poses that heading itself.
 */
export async function faceWall(
  h: FixtureHost,
  tile: Tile,
): Promise<Dir | null> {
  const wall = walledDir(await h.snapshot(), tile);
  if (wall === null) return null;
  await h.debug.setForagerDir(wall);
  return wall;
}

/**
 * The index of the first predator of `kind` on the roster, or `null`.
 *
 * `specs/state.md` lists the predators in release order and the surface's
 * predator operations select one by that index, so this is how a scenario about
 * a particular hunter names it. A roster that holds none of that kind is the
 * roster's verdict rather than the caller's, so this reports rather than throws.
 */
export function predatorIndex(
  board: FixtureBoard,
  kind: string,
): number | null {
  const index = board.predators.findIndex((predator) => predator.kind === kind);
  return index < 0 ? null : index;
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
 * rock the instant a scenario sets it moving. `refugeGap` adds a SEALED pocket
 * that many tiles further on, for a scenario that then puts the forager
 * somewhere a light, a ping or a patrol cannot follow: sealed rather than merely
 * distant, because the whole point of moving it is that what happens next cannot
 * be the predator arriving.
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
 * turn keeps going rather than being stopped by rock — which is what lets a
 * check tell "it took the turn" from "it ran out of corridor". The forager rests
 * on `back`, facing along the approach.
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
 * its subject. A posed board may do what `specs/maze.md` forbids a laid-out one
 * — that page requires one connected region, and a fixture is exempt — and
 * simply put them in different rooms, so "far away" holds for as long as the
 * check needs. The ring is a loop rather than a hallway, so a patrol has
 * somewhere to go and keeps moving instead of pacing a dead end.
 *
 * `near` is how much corridor the forager's own room has, which matters whenever
 * the check measures something that TRAVELS along corridors: a sonar pulse
 * floods by corridor step, so a pulse cast in a three-tile room reports a
 * three-tile reach however far its range is set.
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
 * WHY A BAND RATHER THAN ONE ROCK ON THE LINE. These points watch a predator
 * that is still patrolling, so what matters is not that ONE pair of tiles is
 * occluded but that every tile the predator can reach is. A single rock with a
 * way around it leaves tiles at grazing angles where a check's own reading and a
 * build's line of sight can legitimately disagree, and the point then reads that
 * disagreement as a predator lit through rock. With a full band, every line from
 * one corridor to the other crosses solid rock, whatever either party rounds.
 *
 * OCCLUSION IS NOT DARKNESS. Two tiles apart is `64` units, which sits inside
 * the forager's own light pocket at any brightness (`V` is `96` at `G = 0`), and
 * a build is entitled to paint that pocket as a glow. A check reading PIXELS
 * across the band stands its pair five tiles apart instead: past the pocket, and
 * still inside the kindle circle.
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
  /** Corridor steps from the forager's tile — the unit `E` is measured in. */
  steps: number;
}

/**
 * A dog-leg corridor, and the tiles a pulse from the forager reaches around the
 * bend, nearest first.
 *
 * These are tiles the pulse can flood to but the LIGHT cannot see: the return
 * leg sits directly under the outward leg with a band of rock between, so every
 * line from the forager to a target crosses solid rock while the corridor still
 * joins them in a few steps. That separation is the whole point of the sonar
 * points — anything revealed out there was revealed by the pulse and not by
 * standing close.
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
  /** The rock that closes the corridor, `run + 1` tiles along. */
  wall: Tile;
  /** The corridor tile on the far side of that rock, which the light must not reach. */
  behind: Tile;
  /** The rock the forager itself stands against, across the corridor. */
  flankWalls: Tile[];
}

/**
 * A corridor of `run` tiles ahead of the forager, closed by one rock tile, with
 * a corridor tile behind it.
 *
 * WHY AN AXIAL RAY. `specs/sensing.md` fixes the light as a straight line — a
 * tile is lit when its center is within `V` and the segment joining the two
 * centers crosses no rock other than that tile itself — but the rock flanking a
 * corridor a few tiles away sits at a grazing angle, where two conforming builds
 * may honestly disagree about a segment that clips a corner. The rock squarely
 * at the END of a corridor the forager looks down does not: that line runs along
 * the corridor's center line through nothing but open tiles.
 *
 * `behind` is what makes the point decidable — a tile the light must NOT reach —
 * and a corridor that simply ran into the board's border has no far side at all.
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
 * distance — far enough that a hunter still holding the stale fix cannot reach
 * the slip, which is what the check measures.
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
  /** The direction the check's action names. */
  dir: Dir;
  /** The rock the forager is posed facing, across the corridor. */
  facing: Dir;
  /** How many tiles of corridor run ahead of it that way. */
  ahead: number;
}

/**
 * A straight corridor along the tested direction's OWN axis, with the forager
 * resting in the middle of it, facing the rock across the corridor.
 *
 * POSED RATHER THAN FOUND. Whether a tile has corridor on the side a given
 * action pushes, and how much of it, is a property of the board a build
 * invented: on one board "hold left" had four tiles to cross and on another it
 * had one and a wall. Here every direction gets the same run, so the eight
 * movement-action points measure the same thing eight times.
 *
 * THE FORAGER IS FACED INTO THE ROCK ACROSS THE CORRIDOR, never along the run.
 * Faced along it, a build that ignored the keyboard entirely and simply
 * travelled the way it was pointing would travel exactly as a conforming one
 * does, and the check would pass a game no action reaches. Facing rock, the
 * forager cannot leave its tile until the action is read and honoured —
 * `specs/movement.md`: "A forager at rest takes the desired direction when the
 * tile that way is open to it, and stays at rest otherwise" — so the travel a
 * check measures is the action's doing and nothing else's. The corridor is one
 * tile wide, so both tiles across it are rock and either serves.
 */
export async function poseMoveKeyRun(
  h: FixtureHost,
  dir: Dir,
  options: { ahead?: number } = {},
): Promise<MoveKeyRun> {
  const ahead = options.ahead ?? 3;
  const arm = CORRIDOR.repeat(ahead);
  const vertical = dir === "up" || dir === "down";
  const art = vertical
    ? [...arm.split(""), "S", ...arm.split("")]
    : [arm + "S" + arm];
  const posed = await poseMaze(h, art);
  const start = posed.mark("S");
  const facing: Dir = vertical ? "left" : "up";
  await placeForager(h, start, facing);
  return { start, dir, facing, ahead };
}

/** A lit room, and a sealed patch of corridor the light never reaches. */
export interface DarkPatch {
  /** The forager's tile, in its own small room. */
  home: Tile;
  /** A corridor tile no light has touched, across solid rock. */
  dark: Tile;
  /** The rock tile directly above that corridor tile, equally untouched. */
  darkRock: Tile;
  /** How far apart `home` and `dark` are, in tiles. */
  tiles: number;
}

/**
 * A small room for the forager and, `gap` tiles of solid rock away, a sealed
 * three-tile corridor nothing has ever lit.
 *
 * The fog points need a tile that is genuinely unrevealed — never touched by the
 * forager's light, a pulse or a flare — and a rock tile beside it that is
 * equally untouched, so the two can be compared. The room and the pocket share a
 * row with rock between them, and the pocket's whole surround is rock by
 * construction, so `darkRock` is a rock tile whichever way a build traces a
 * sight line.
 */
export async function poseDarkPatch(
  h: FixtureHost,
  options: { gap?: number } = {},
): Promise<DarkPatch> {
  const gap = options.gap ?? 8;
  const posed = await poseMaze(h, [
    "F" + CORRIDOR.repeat(2) + " ".repeat(gap) + CORRIDOR + "D" + CORRIDOR,
  ]);
  const home = posed.mark("F");
  const dark = posed.mark("D");
  await placeForager(h, home, "left");
  return {
    home,
    dark,
    darkRock: { tx: dark.tx, ty: dark.ty - 1 },
    tiles: dark.tx - home.tx,
  };
}
