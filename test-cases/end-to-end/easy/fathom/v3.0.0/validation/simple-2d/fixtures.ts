// Fathom — the posed-fixture oracle. CASE-PROVIDED, and byte-identical in every
// engine directory.
//
// WHY A CHECK POSES ITS OWN GEOMETRY. The maze is the build's to design
// (specs/maze.md fixes rules, never a layout), so a scenario that needs a shape —
// a straight run of a given length, a corner to turn, a corridor ending in rock,
// two tiles with solid rock on the line between them — can only go hunting for
// one in whatever maze this build happened to draw, and take what it finds. What
// it finds differs from build to build: a different amount of room, a different
// approach, sometimes nothing usable. A check that POSES the shape it is about
// measures the behavior it names instead of the layout it landed in.
//
// specs/instrumentation.md's `setMaze` is what makes that possible, and it says
// exactly what a fixture is entitled to: the posed layout is used as given and is
// exempt from every rule in specs/maze.md, so dead ends, wider corridors,
// asymmetry, disconnected regions, a missing wrap tunnel and a missing den are
// all legal in one, and the game keeps running on it.
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
// build's OWN reported grid, so a build whose maze is not 36 x 18 still gets its
// fixture stamped somewhere valid rather than a layout of the wrong size.
//
// FOUR RULES EVERY FIXTURE OBEYS, each of them a run that was lost without it.
//
// 1. A SEALED LARDER. Plankton sit on every corridor tile, and eating the last
//    one clears the maze, descends, re-dens every predator and ends the scenario.
//    A fixture is a handful of tiles, so a forager that keeps swimming empties it
//    in a couple of seconds. Three tiles of corridor the forager can never reach
//    put `planktonRemaining` permanently above zero, and no amount of grazing can
//    clear the maze whatever the forager does.
// 2. A SEALED DEN. `setMaze` returns every predator to a den tile, so a fixture
//    without one asks each build what "back to the den" means when there is no
//    den, and they answer differently. The fixture carries a real chamber, walled
//    on three sides with its gate above it, so even a build that runs the release
//    schedule anyway — which `setMaze` says it must not — gets no further than
//    the gate, and never into the scenario.
// 3. THE FORAGER IS PLACED EXPLICITLY. `setMaze` rests it on "the first corridor
//    tile in reading order", which the specification is explicit is "a defined
//    resting place rather than a meaningful one". Every poser below then puts it
//    on a named anchor of its own fixture, so no scenario depends on how a build
//    reads that sentence.
// 4. THE HOUSING IS CHECKED, NARROWLY. {@link requireHoused} stands a scenario
//    down when `setMaze` left a predator standing in the posed corridor, because
//    a hunter that can reach the forager ends the measurement. It refuses only for
//    a predator on OPEN CORRIDOR: one embedded in rock cannot move, so the
//    scenario around it is still the one the check meant to pose. The full
//    contract is `controls/setmaze-houses-predators`'s to grade.

import {
  isOpen,
  tileAt,
  type Dir,
  type Grid,
  type MazeView,
  type Tile,
} from "./maze";
import { unmetPrecondition, type Scene, type SceneSnapshot } from "./scene";

/** How many tiles of unreachable corridor the larder holds. */
export const LARDER_TILES = 3;

/** A stamped fixture: the layout to pose, and where its anchors landed. */
export interface Fixture {
  /** `grid.rows` strings of `grid.cols` characters, ready for `setMaze`. */
  rows: string[];
  /** Every tile each anchor letter labels, in reading order. */
  marks: Record<string, Tile[]>;
  /** The top-left tile the art was stamped at. */
  at: Tile;
}

/** Where a fixture is stamped, and whether it carries the larder and den. */
export interface StampOptions {
  /** The top-left tile to stamp at. Centred in the grid when omitted. */
  at?: Tile;
  /** Carry the sealed larder and den. Defaults to `true`. */
  larder?: boolean;
}

/**
 * Stamp a piece of ASCII art into a full-size layout, ready for `setMaze`.
 *
 * Pure: it reads the grid's frame and returns rows. Nothing is posed until
 * {@link poseMaze} takes them.
 */
export function stampLayout(
  grid: Grid,
  art: readonly string[],
  options: StampOptions = {},
): Fixture {
  const { at, larder = true } = options;
  const height = art.length;
  const width = Math.max(...art.map((line) => line.length));
  const top = at ? at.ty : Math.floor((grid.rows - height) / 2);
  const left = at ? at.tx : Math.floor((grid.cols - width) / 2);
  if (
    top < 0 ||
    left < 0 ||
    top + height > grid.rows ||
    left + width > grid.cols
  ) {
    unmetPrecondition(
      `a ${width}x${height} fixture does not fit this build's ${grid.cols}x${grid.rows} ` +
        `grid at (${left}, ${top})`,
    );
  }
  const cells: string[][] = Array.from({ length: grid.rows }, () =>
    new Array<string>(grid.cols).fill("#"),
  );
  const marks: Record<string, Tile[]> = {};
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < art[r].length; c += 1) {
      const glyph = art[r][c];
      if (glyph === "#" || glyph === " ") continue;
      const tx = left + c;
      const ty = top + r;
      if (glyph === "." || glyph === "d" || glyph === "g") {
        cells[ty][tx] = glyph;
        continue;
      }
      if (!/^[A-Z]$/.test(glyph)) {
        throw new Error(
          `stampLayout: unknown fixture character ${JSON.stringify(glyph)} at art ` +
            `(${c}, ${r})`,
        );
      }
      cells[ty][tx] = ".";
      (marks[glyph] ??= []).push({ tx, ty });
    }
  }

  if (larder) {
    const last = grid.rows - 1;
    const above = grid.rows - 2;
    if (
      cells[last].some((cell) => cell !== "#") ||
      cells[above].some((cell) => cell !== "#")
    ) {
      throw new Error(
        "stampLayout: the fixture reaches the bottom two rows, which the larder and " +
          "the den need; pass { larder: false } and keep the board unclearable and " +
          "its predators housed another way",
      );
    }
    for (let c = 1; c <= Math.min(LARDER_TILES, grid.cols - 2); c += 1) {
      cells[last][c] = ".";
    }
    // The chamber sits hard against the far end of the same row, well clear of
    // the larder, with its single gate above the middle tile and rock on the
    // other three sides of that gate.
    const gate = grid.cols - 3;
    cells[above][gate] = "g";
    for (let c = gate - 1; c <= gate + 1; c += 1) cells[last][c] = "d";
  }

  const rows = cells.map((row) => row.join(""));
  const pierced = rows.findIndex(
    (row) => row[0] !== "#" && row[row.length - 1] !== "#",
  );
  if (pierced >= 0) {
    throw new Error(
      `stampLayout: the fixture opens both border columns on row ${pierced}, which ` +
        "poses a wrap tunnel the scenario did not ask for",
    );
  }
  return { rows, marks, at: { tx: left, ty: top } };
}

/** Every den-interior or den-gate tile of a layout, as `"tx,ty"` keys. */
export function housedTiles(view: MazeView): Set<string> {
  const housed = new Set<string>();
  for (let r = 0; r < view.grid.rows; r += 1) {
    for (let c = 0; c < view.grid.cols; c += 1) {
      const at = tileAt(view, c, r);
      if (at === "d" || at === "g") housed.add(`${c},${r}`);
    }
  }
  return housed;
}

/** One predator standing outside the den, and the kind of tile it is on. */
export interface LoosePredator {
  kind: string;
  tx: number;
  ty: number;
  /** The tile it is on: `"open corridor"`, `"rock"`, or `"off the board"`. */
  ground: string;
  /** The whole of it as a phrase, for a failure or a precondition to name. */
  where: string;
}

/** Every predator of `snapshot` standing on a tile that is not `housed`. */
export function looseOf(
  snapshot: SceneSnapshot,
  housed: ReadonlySet<string>,
): LoosePredator[] {
  return snapshot.predators
    .filter((p) => !housed.has(`${p.tx},${p.ty}`))
    .map((p) => {
      const at = tileAt(snapshot, p.tx, p.ty);
      const ground =
        at === "."
          ? "open corridor"
          : at === undefined
            ? "off the board"
            : "rock";
      return {
        kind: p.kind,
        tx: p.tx,
        ty: p.ty,
        ground,
        where: `the ${p.kind} at (${p.tx}, ${p.ty}), on ${ground}`,
      };
    });
}

/**
 * Stand a posed scenario down when `setMaze` left a predator loose in it.
 *
 * specs/instrumentation.md has the operation leave the board in the state a
 * freshly laid-out maze starts in, with "every predator returned to a den tile
 * with its `released` flag `false`". Every fixture from {@link stampLayout}
 * carries a real den for them to be returned to, sealed off in the bottom rows,
 * so on such a layout every predator's tile is a den or gate tile: there is
 * nowhere else it is entitled to be.
 *
 * ONLY A PREDATOR THAT CAN GET ANYWHERE STOPS THE SCENARIO. A build that misses
 * the fixture's den misses it by whatever offset its own den sat at, and the tile
 * it lands on is as often rock as corridor. Movement is over open tiles and rock
 * is solid to every body (specs/movement.md), so a hunter embedded in rock cannot
 * reach the forager, the subject, or anything else: the scenario around it is the
 * one the check meant to pose, and refusing to grade it would throw a real
 * measurement away over bookkeeping. A hunter on OPEN CORRIDOR is the one that
 * can swim into the scene.
 *
 * The full contract — every predator housed, rock included — is graded by
 * `controls/setmaze-houses-predators`, which poses with `housed: false` and
 * asserts it directly. This is the narrower question of whether THIS scenario can
 * still be read. A layout with no den is not checked: the same page has a
 * predator returned to a den that is not there held out of play, which fixes no
 * tile for it to be on.
 */
export function requireHoused(snapshot: SceneSnapshot): void {
  const housed = housedTiles(snapshot);
  if (housed.size === 0) return;
  const loose = looseOf(snapshot, housed).filter(
    (p) => p.ground === "open corridor",
  );
  if (loose.length === 0) return;
  unmetPrecondition(
    `setMaze left a predator loose in the posed fixture — ${loose
      .map((p) => p.where)
      .join("; ")}. specs/instrumentation.md has the operation return every ` +
      `predator to a den tile and this fixture carries one; a hunter standing in ` +
      `open corridor can reach the forager and end the scenario, so what happens ` +
      `next is not this check's verdict — see controls/setmaze-houses-predators`,
  );
}

/** What {@link poseMaze} hands back: the posed state, and the fixture's anchors. */
export interface PosedBoard {
  /** The state after the layout is in place. */
  snap: SceneSnapshot;
  /** The top-left tile the art was stamped at. */
  at: Tile;
  /** The one tile `letter` labels; an error when it labels none or several. */
  mark(letter: string): Tile;
  /** Every tile `letter` labels, in reading order. */
  all(letter: string): Tile[];
  /** The layout that was posed. */
  rows: readonly string[];
}

/** How {@link poseMaze} stamps, and whether it grades the housing itself. */
export interface PoseOptions extends StampOptions {
  /**
   * Check that `setMaze` housed every predator. Defaults to `true`; only
   * `controls/setmaze-houses-predators`, which owns the claim, passes `false`.
   */
  housed?: boolean;
}

/**
 * Pose a fixture as the whole maze and hand back what a scenario needs to place
 * things on it.
 *
 * `setMaze` leaves the dive on a fresh board — plankton on every corridor tile,
 * fog back to unrevealed, every predator held in the den — so a caller poses the
 * forager and the predators it wants afterwards, exactly as it would on a
 * generated maze.
 */
export async function poseMaze(
  scene: Scene,
  art: readonly string[],
  options: PoseOptions = {},
): Promise<PosedBoard> {
  const before = await scene.snapshot();
  const fixture = stampLayout(before.grid, art, options);
  await scene.debug.setMaze(fixture.rows);
  // specs/instrumentation.md has `setMaze` leave the screen as it is, so a call
  // made during live play leaves the game in live play and this is a no-op. It is
  // here because every scenario below needs live play, none of them is ABOUT which
  // screen the operation leaves, and `beginPlay` is the documented way to end a
  // countdown: normalising keeps that one reading out of a hundred unrelated
  // verdicts. `controls/setmaze-*` is where the screen contract is graded.
  if ((await scene.snapshot()).screen === "countdown") {
    await scene.debug.beginPlay();
  }
  const snap = await scene.snapshot();
  if (options.housed !== false) requireHoused(snap);
  return {
    snap,
    at: fixture.at,
    rows: fixture.rows,
    mark: (letter) => {
      const hits = fixture.marks[letter];
      if (hits === undefined || hits.length !== 1) {
        throw new Error(
          `poseMaze: the fixture labels ${letter} ${hits?.length ?? 0} times, ` +
            "expected exactly one",
        );
      }
      return hits[0];
    },
    all: (letter) => fixture.marks[letter] ?? [],
  };
}

/** Put the forager on a tile and face it, in one step every poser repeats. */
async function restForager(scene: Scene, tile: Tile, dir?: Dir): Promise<void> {
  await scene.debug.setForagerTile(tile.tx, tile.ty);
  if (dir !== undefined) await scene.debug.setForagerDir(dir);
}

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

/** A straight corridor, and the tile a mover starts from. */
export interface StraightRun extends Tile {
  /** The way the run travels from `tx, ty`. */
  dir: Dir;
  /** How many tiles the run holds, including the start. */
  len: number;
}

/**
 * A single straight corridor of `len` tiles posed as the whole board, with the
 * forager resting on its first tile.
 *
 * `dir` runs the corridor to the right or downward, so a check that reads travel
 * can read it on either axis. `spare` adds a second sealed pocket well clear of
 * the run: ground the light has never touched, for a check that reads a build's
 * own unrevealed fog color.
 */
export async function poseStraightRun(
  scene: Scene,
  len: number,
  options: { spare?: boolean; dir?: "right" | "down" } = {},
): Promise<StraightRun> {
  const dir = options.dir ?? "right";
  const spare = options.spare === true;
  const art =
    dir === "right"
      ? [`S${".".repeat(len - 1)}${spare ? `${" ".repeat(8)}...` : ""}`]
      : ["S", ...Array.from({ length: len - 1 }, () => ".")].concat(
          spare ? [`${" ".repeat(8)}...`] : [],
        );
  const board = await poseMaze(scene, art);
  const start = board.mark("S");
  await restForager(scene, start, dir);
  return { tx: start.tx, ty: start.ty, dir, len };
}

/** Two tiles on one straight corridor, with clear sight between them. */
export interface SightLine {
  forager: Tile;
  pred: Tile;
  /** The heading that points from the forager down the corridor at the predator. */
  dir: Dir;
  /** The heading that points from the predator back at the forager. */
  toForager: Dir;
  /** How many tiles apart they stand. */
  tiles: number;
  /** A sealed pocket `refugeGap` tiles further on, when one was asked for. */
  refuge: Tile | null;
}

/**
 * Two tiles `gapTiles` apart on one straight corridor, with clear line of sight
 * between them, posed as the whole board. The forager rests on its own anchor.
 *
 * `lead` and `tail` are spare corridor beyond each of them, so a mover is under
 * way without either end running into rock the instant it starts. `refugeGap`
 * adds a SEALED pocket further along for a scenario that then sends the forager
 * somewhere the predator's light, ping or patrol cannot follow: sealed rather
 * than merely distant, because the whole point of moving it is that what happens
 * next cannot be the predator arriving.
 */
export async function poseSightLine(
  scene: Scene,
  gapTiles: number,
  options: { lead?: number; tail?: number; refugeGap?: number } = {},
): Promise<SightLine> {
  const { lead = 1, tail = 1, refugeGap = 0 } = options;
  let art = `${".".repeat(lead)}F${".".repeat(gapTiles - 1)}P${".".repeat(tail)}`;
  if (refugeGap > 0) art += `${" ".repeat(refugeGap)}R..`;
  const board = await poseMaze(scene, [art]);
  await restForager(scene, board.mark("F"), "right");
  return {
    forager: board.mark("F"),
    pred: board.mark("P"),
    dir: "right",
    toForager: "left",
    tiles: gapTiles,
    refuge: refugeGap > 0 ? board.mark("R") : null,
  };
}

/** A right-angle junction, and the arms that meet at it. */
export interface Corner {
  junction: Tile;
  /** The heading a mover on `back` travels to reach the junction. */
  approach: Dir;
  back: Tile;
  /** The heading it may turn onto at the junction. */
  perp: Dir;
  /** The first tile along `perp`. */
  perpTile: Tile;
}

/**
 * A right-angle junction posed as the whole board, with the forager resting at
 * the near end of the approach arm.
 *
 * Both arms run on past the junction, so a mover that does NOT turn keeps going
 * rather than being stopped by rock, which is what lets a check tell "took the
 * turn" from "ran out of corridor".
 */
export async function poseCorner(
  scene: Scene,
  options: { arm?: number } = {},
): Promise<Corner> {
  const arm = options.arm ?? 4;
  const art = [`BJ${".".repeat(arm)}`];
  for (let i = 0; i < arm; i += 1) art.push(` .${" ".repeat(arm)}`);
  const board = await poseMaze(scene, art);
  const junction = board.mark("J");
  await restForager(scene, board.mark("B"), "right");
  return {
    junction,
    approach: "right",
    back: board.mark("B"),
    perp: "down",
    perpTile: { tx: junction.tx, ty: junction.ty + 1 },
  };
}

/** Two rooms with no way between them: the forager's, and a creature's ring. */
export interface ApartRooms {
  /** The forager's tile, in its own room. */
  near: Tile;
  /** A tile in the creature's ring, across solid rock. */
  far: Tile;
}

/**
 * Two rooms sealed off from each other, posed as the whole board: the forager's
 * corridor, and across solid rock a separate ring for a creature to patrol.
 *
 * WHY THE HALVES ARE SEALED. These scenarios want a creature that keeps to itself
 * — wandering, pinging, flaring — while the forager stands somewhere else as a
 * bystander. On a real maze "somewhere else" is only ever a head start: a patrol
 * crosses the whole board in a few seconds, so a long watch ends with the creature
 * arriving and the check reporting something other than its subject. A posed board
 * may do what a generated one may not (specs/maze.md requires one connected
 * region; a fixture is exempt) and simply put them in different rooms.
 *
 * The ring is a loop rather than a hallway, so a patrol has somewhere to go and
 * keeps moving instead of pacing a dead end. `near` is how much corridor the
 * forager's own room holds, which matters whenever the check measures something
 * that TRAVELS along corridors: a sonar pulse floods by corridor step, so a pulse
 * cast in a three-tile room reports a three-tile reach however far its range is.
 */
export async function poseApart(
  scene: Scene,
  minTiles: number,
  options: { ring?: number; spare?: boolean; near?: number } = {},
): Promise<ApartRooms> {
  const { ring = 3, spare = false, near = 3 } = options;
  const gap = Math.max(2, minTiles - near);
  const pad = " ".repeat(gap);
  const tail = spare ? `${" ".repeat(8)}...` : "";
  const blank = " ".repeat(near);
  const art = [
    `N${".".repeat(near - 1)}${pad}F${".".repeat(ring)}${tail}`,
    `${blank}${pad}.${" ".repeat(ring - 1)}.`,
    `${blank}${pad}.${".".repeat(ring)}`,
  ];
  const board = await poseMaze(scene, art);
  await restForager(scene, board.mark("N"));
  return { near: board.mark("N"), far: board.mark("F") };
}

/** A straight-corridor ink standoff. */
export interface InkStandoff {
  /** Where the forager releases the cloud. */
  ink: Tile;
  /** Where the predator waits, along the same corridor. */
  pred: Tile;
  /** The heading from the ink tile toward the predator. */
  dir: Dir;
  /** The heading the forager retreats along to get clear of its own cloud. */
  flee: Dir;
  /** How much corridor sits behind the ink tile for that retreat. */
  clearTiles: number;
}

/**
 * An ink standoff posed as the whole board: the forager inks where it stands, the
 * predator waits `gap` tiles along the same corridor, and `clearTiles` of
 * corridor sit behind the forager so it can back out of its own cloud and leave
 * that cloud squarely between the two.
 */
export async function poseInkStandoff(
  scene: Scene,
  options: { gap: number; clearTiles?: number },
): Promise<InkStandoff> {
  const { gap, clearTiles = 3 } = options;
  const art = `${".".repeat(clearTiles)}I${".".repeat(gap - 1)}P`;
  const board = await poseMaze(scene, [art]);
  await restForager(scene, board.mark("I"), "right");
  return {
    ink: board.mark("I"),
    pred: board.mark("P"),
    dir: "right",
    flee: "left",
    clearTiles,
  };
}

/** Two corridors with a solid band of rock between them. */
export interface OccludedPair {
  forager: Tile;
  pred: Tile;
  /** How many tiles apart the two corridors are, on the perpendicular axis. */
  tiles: number;
}

/**
 * Two parallel corridors with a full band of rock between them, posed as the
 * whole board, and the forager resting on its own.
 *
 * WHY A BAND RATHER THAN ONE ROCK ON THE LINE. These checks watch a predator that
 * is still patrolling, so what matters is not that ONE pair of tiles is occluded
 * but that every tile the predator can reach is. A single rock with a way around
 * it gives the predator tiles at grazing angles where a check's own sight line and
 * a build's can legitimately disagree, and the check then reads that disagreement
 * as a predator lit through rock. A full band leaves no such tile.
 *
 * `tiles` is how far apart they stand, which decides whether the pair sits inside
 * a sensing radius the check cares about. Two tiles is `2 * TILE` logical units,
 * which is INSIDE the forager's own light pocket at every brightness: stand a pair
 * that must be dark five tiles apart instead, past the pocket.
 */
export async function poseOccludedPair(
  scene: Scene,
  options: { tiles?: number; len?: number } = {},
): Promise<OccludedPair> {
  const { tiles = 2, len = 5 } = options;
  const art = [`F${".".repeat(len - 1)}`];
  for (let i = 1; i < tiles; i += 1) art.push("");
  art.push(`P${".".repeat(len - 1)}`);
  const board = await poseMaze(scene, art);
  await restForager(scene, board.mark("F"), "right");
  return { forager: board.mark("F"), pred: board.mark("P"), tiles };
}

/** A tile a sonar pulse floods to, and how many corridor steps out it is. */
export interface SonarTarget extends Tile {
  /** Corridor distance from the forager, in tiles. */
  steps: number;
}

/**
 * A dog-leg corridor posed as the whole board, returning the tiles a pulse from
 * the forager reaches around the bend, nearest first.
 *
 * These are tiles the pulse can flood to but the LIGHT cannot see: the return leg
 * sits directly under the outward leg with rock between, so every line from the
 * forager to a target crosses solid rock while the corridor still joins them in a
 * few steps. That separation is the whole point of the sonar checks — anything
 * revealed out there was revealed by the pulse and not by standing close.
 */
export async function poseSonarSense(
  scene: Scene,
  count = 1,
): Promise<SonarTarget[]> {
  const board = await poseMaze(scene, ["F..", "  .", "..."]);
  const f = board.mark("F");
  await restForager(scene, f, "right");
  return [
    { tx: f.tx + 2, ty: f.ty + 2, steps: 4 },
    { tx: f.tx + 1, ty: f.ty + 2, steps: 5 },
    { tx: f.tx, ty: f.ty + 2, steps: 6 },
  ].slice(0, count);
}

/** A short corridor closed by rock, for reading what the light lands on. */
export interface LitWallProbe extends Tile {
  /** The heading the forager looks along. */
  dir: Dir;
  /** How many open tiles lie along the corridor beyond the forager. */
  run: number;
  /** The rock that closes the corridor. */
  wall: Tile;
  /** The corridor tile on that rock's far side, which the light must not reach. */
  behind: Tile;
  /** The rock the forager itself stands against, across the corridor. */
  flankWalls: Tile[];
}

/**
 * A short corridor closed by rock, posed as the whole board, with a further
 * corridor tile beyond that rock.
 *
 * WHY AN AXIAL RAY. specs/sensing.md fixes the light as a straight line — a tile
 * is lit when its center is within `V` and the segment joining the two centers
 * crosses no rock other than that tile itself — but the rock flanking a corridor
 * a few tiles away sits at a grazing angle, where two conforming builds may
 * honestly disagree about a segment that clips a corner. The rock squarely at the
 * END of a corridor the forager looks down does not: that line runs along the
 * corridor's center line through nothing but open tiles.
 *
 * `behind` is what makes the check decidable — a tile the light must NOT reach —
 * and a corridor that simply ran into the maze border has no far side at all.
 */
export async function poseLitWallProbe(
  scene: Scene,
  options: { run?: number } = {},
): Promise<LitWallProbe> {
  const run = options.run ?? 3;
  const board = await poseMaze(scene, [`F${".".repeat(run)}#.`]);
  const f = board.mark("F");
  await restForager(scene, f, "right");
  return {
    tx: f.tx,
    ty: f.ty,
    dir: "right",
    run,
    wall: { tx: f.tx + run + 1, ty: f.ty },
    behind: { tx: f.tx + run + 2, ty: f.ty },
    flankWalls: [
      { tx: f.tx, ty: f.ty - 1 },
      { tx: f.tx, ty: f.ty + 1 },
    ],
  };
}

/** A standoff a hunter takes a fix from, and the tile the forager slips to. */
export interface DimStandoff {
  pred: Tile;
  /** Where the forager stands while the hunter takes its fix. */
  fix: Tile;
  /** Where the forager slips to, out of reach of a stale fix. */
  slip: Tile;
  dir: Dir;
}

/**
 * A straight corridor holding a hunter standoff, posed as the whole board: the
 * hunter on `pred`, the forager on `fix` where the fix is taken, and `slip` a
 * further `slipTiles` along.
 *
 * All three sit on one straight run, so the only thing between them is distance.
 */
export async function poseDimStandoff(
  scene: Scene,
  options: { predTiles?: number; slipTiles?: number } = {},
): Promise<DimStandoff> {
  const { predTiles = 2, slipTiles = 6 } = options;
  const art = `P${".".repeat(predTiles - 1)}X${".".repeat(slipTiles - 1)}S`;
  const board = await poseMaze(scene, [art]);
  await restForager(scene, board.mark("X"), "right");
  return {
    pred: board.mark("P"),
    fix: board.mark("X"),
    slip: board.mark("S"),
    dir: "right",
  };
}

/** A corridor along one axis, with the forager pinned in the middle of it. */
export interface MoveKeyRun extends Tile {
  /** The direction the check's key points, along the corridor. */
  dir: Dir;
  /** The rock the forager is posed facing, across the corridor. */
  facing: Dir;
  /** How many tiles of corridor lie ahead in `dir`. */
  run: number;
}

/**
 * A straight corridor along the key's OWN axis, posed as the whole board, with
 * the forager at rest in the middle of it facing the rock across the corridor.
 *
 * POSED, NOT FOUND. Whether a tile has corridor on the side a given key pushes,
 * and how much, is a property of the maze a build invented: on one board "press
 * left" has four tiles to cross and on another it has one and a wall. Here every
 * direction gets the same run.
 *
 * FACING ROCK ACROSS THE CORRIDOR, never along it. specs/movement.md gives a
 * forager at rest one rule — it "takes the desired direction when the tile that
 * way is open to it, and stays at rest otherwise" — and a forager pinned against
 * a perpendicular wall exercises exactly that rule when the key lands. It also
 * makes the heading a real question: the pose does not already answer it, and it
 * is not a REVERSAL, which specs/movement.md honors under a different rule.
 */
export async function poseMoveKeyRun(
  scene: Scene,
  dir: Dir,
  options: { run?: number } = {},
): Promise<MoveKeyRun> {
  const run = options.run ?? 3;
  const vertical = dir === "up" || dir === "down";
  const before = ".".repeat(run);
  const after = ".".repeat(run);
  const art = vertical
    ? [...before.split(""), "S", ...after.split("")]
    : [`${before}S${after}`];
  const board = await poseMaze(scene, art);
  const spot = board.mark("S");
  // The corridor is one tile wide, so both tiles across it are rock; either is a
  // wall the forager cannot travel into.
  const facing: Dir = vertical ? "left" : "up";
  await restForager(scene, spot, facing);
  return { tx: spot.tx, ty: spot.ty, dir, facing, run };
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
 * The fog checks need a tile that is genuinely unrevealed — never touched by the
 * forager's light, a pulse or a flare — and a rock tile beside it that is equally
 * untouched, so the two can be compared. The room and the pocket share a row with
 * rock between them, and the pocket's whole surround is rock by construction, so
 * `darkRock` is a rock tile whichever way a build traces a sight line.
 */
export async function poseDarkPatch(
  scene: Scene,
  options: { gap?: number } = {},
): Promise<DarkPatch> {
  const gap = options.gap ?? 8;
  const board = await poseMaze(scene, [`F..${" ".repeat(gap)}.D.`]);
  const home = board.mark("F");
  const dark = board.mark("D");
  await restForager(scene, home, "left");
  return {
    home,
    dark,
    darkRock: { tx: dark.tx, ty: dark.ty - 1 },
    tiles: dark.tx - home.tx,
  };
}

/**
 * A corridor tile of the posed board that is not part of the scenario, for a
 * check that needs somewhere to put something out of the way.
 *
 * Reads the layout rather than assuming one, so it answers on a fixture and on a
 * build's own maze alike.
 */
export function firstOpenTile(view: MazeView): Tile | null {
  for (let r = 0; r < view.grid.rows; r += 1) {
    for (let c = 0; c < view.grid.cols; c += 1) {
      if (isOpen(view, c, r)) return { tx: c, ty: r };
    }
  }
  return null;
}
