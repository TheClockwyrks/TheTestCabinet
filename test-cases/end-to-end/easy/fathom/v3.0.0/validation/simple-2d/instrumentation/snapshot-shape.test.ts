// instrumentation/snapshot-shape — the snapshot reports the whole documented
// shape, over a board that exercises every branch of it.
//
// specs/state.md gives `snapshot()` as "a plain, JSON-serializable object
// carrying every field below", and closes with the contract: "Every field above
// is present from the moment the game has initialized, and none of them is
// optional. A field whose kind does not carry it reports `null`, as the predator
// fields state, rather than going missing." So this reads every field by name,
// holds it to its documented type, and holds the four per-kind predator fields to
// the kind rule that decides between a number and `null`.
//
// WHY IT NEEDS A POSED SCENE. Three of the lists are empty on a board nothing has
// happened on, and an empty list says nothing about the shape of what goes in it.
// So the board carries a drifter, an ink cloud, a sonar wavefront in flight, and
// all three hunters out of the den at once, and each entry is read the same way
// the scalars are.
//
// THE HUNTERS ARE POSED WHERE THEY CANNOT REACH ANYTHING. Each stands on a
// single corridor tile boxed in by rock, so a predator that ran its mind for the
// two ticks this drives could not travel anywhere, and `setCreatureAI(false)`
// holds every creature exactly where it was posed (specs/instrumentation.md)
// while the pulse and the ink carry on travelling, which is what this reads.
//
// THE PULSE AND THE INK COME FROM THE REAL CONTROLS. There is no operation that
// casts one, and specs/movement.md binds them to `a` (`Space`) and `b`
// (`ShiftLeft`). A build whose controls do not fire them has a defect that
// `controls/sonar-key` and `controls/ink-key` own, so this stands down rather
// than reporting it as a shape fault.
//
// THE TILE COORDINATES ARE HELD AGAINST THE POSITIONS THEY COME FROM.
// specs/state.md defines `tx`/`ty` as "the tile it is on, the tile whose bounds
// contain its center" and specs/overview.md fixes the frame those bounds come
// from, so for every body on the board the pair is arithmetic on `x`, `y` and the
// grid block the same snapshot reports.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertNull,
} from "../assert";
import {
  BINDINGS,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
} from "../../src/constants";
import { poseMaze } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  graded,
  parkForager,
  sceneGuard,
  sceneHeld,
  unmetPrecondition,
} from "../scene";
import { FATHOM_DEBUG_VERSION, type FathomSnapshot } from "../surface";

/**
 * The board: a nine-tile corridor for the forager and the drifter, and, three
 * rows below it, three single-tile pockets each sealed in on all four sides.
 *
 * A hunter on a boxed tile has no open neighbor, so specs/predators.md has it
 * stay there however long it stands; the pockets are what let all three be out of
 * the den at once without any of them reaching the forager. `D` is where the
 * drifter is spawned, one tile along the forager's corridor.
 */
const ART = ["F.D......", "#########", "#########", "#A#B#C###"] as const;

/** Which pocket each kind is posed on, in the order the roster lists them. */
const POCKETS = ["A", "B", "C"] as const;

/** The three hunters, in the release order specs/predators.md fixes. */
const KINDS = ["lanternjaw", "gloamfin", "flarefish"] as const;

/** The keys specs/movement.md binds the sonar pulse and the ink to. */
const SONAR_KEY = BINDINGS.a[0];
const INK_KEY = BINDINGS.b[0];

/** The seven screens specs/state.md names. */
const SCREENS = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "cleared",
  "gameover",
];

/** The four cardinals a body faces. */
const DIRS = ["up", "down", "left", "right"];

/** What a predator may be doing. */
const STATES = ["den", "wander", "chase", "search"];

/** The tile alphabet, and the visibility alphabet, specs/state.md fixes. */
const TILE_CHARS = "#.gd";
const VISIBILITY_CHARS = "url";

/** Ticks run after the two taps, so both effects are in flight when read. */
const SETTLE_TICKS = 2;

/** `typeof actual` is `type`. */
function assertType(actual: unknown, type: string, context: string): void {
  assertEqual(typeof actual, type, context);
}

/** The field is present, and is a number. */
function assertNumber(host: object, key: string, context: string): void {
  assertHasProperty(host, key, context);
  assertType((host as Record<string, unknown>)[key], "number", context);
}

/** The field is present, and is a boolean. */
function assertBoolean(host: object, key: string, context: string): void {
  assertHasProperty(host, key, context);
  assertType((host as Record<string, unknown>)[key], "boolean", context);
}

/**
 * The field is present, and is a number when the kind carries it or `null` when
 * it does not — the rule specs/state.md states for the four per-kind fields.
 */
function assertCarried(
  host: object,
  key: string,
  carried: boolean,
  type: "number" | "boolean",
  context: string,
): void {
  assertHasProperty(host, key, context);
  const value = (host as Record<string, unknown>)[key];
  if (carried) assertType(value, type, context);
  else assertNull(value, context);
}

/** The tile a position falls in, from the grid frame the snapshot reports. */
function tileOf(
  grid: FathomSnapshot["grid"],
  x: number,
  y: number,
): { tx: number; ty: number } {
  return {
    tx: Math.floor((x - grid.originX) / grid.tile),
    ty: Math.floor((y - grid.originY) / grid.tile),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every documented field, with its documented type", async (ctx) => {
  await graded(ctx, async () => {
    await startPlaying(h);
    const board = await poseMaze(h, ART);
    const home = board.mark("F");
    await parkForager(h, home);

    const roster = h.snapshot();
    assertLength(
      roster.predators,
      KINDS.length,
      "the depth-1 roster, which specs/predators.md gives one of each kind",
    );
    for (let index = 0; index < KINDS.length; index += 1) {
      const pocket = board.mark(POCKETS[index]);
      h.debug.setPredatorTile(index, pocket.tx, pocket.ty);
      h.debug.setPredatorState(index, "wander");
    }
    const drop = board.mark("D");
    h.debug.spawnDrifter(drop.tx, drop.ty);
    // Every creature holds exactly where it was posed from here on, so the two
    // ticks below carry the pulse and the ink and nothing else
    // (specs/instrumentation.md).
    h.debug.setCreatureAI(false);
    const guard = await sceneGuard(h);

    h.debug.setSonarCooldown(0);
    h.debug.setInkCooldown(0);
    await h.tap(INK_KEY);
    await h.tap(SONAR_KEY);
    await h.advance(SETTLE_TICKS);

    const snap = h.snapshot();
    // Before the assertions, so a failing check still leaves the picture of the
    // board the shape was read off.
    captureStill(h, "posed");

    assertNull(sceneHeld(snap, guard), "the scenario held to the end");

    // The scene the shape is read over: a build whose controls never fired the two
    // effects has a defect the control points own, and this stands aside.
    if (snap.pulses.length === 0) {
      unmetPrecondition(
        `no sonar wavefront was in flight after ${SONAR_KEY} was pressed with the ` +
          `cooldown ready, so the pulses list had nothing in it to read — whether ` +
          `the sonar control fires is controls/sonar-key's verdict, not this one's`,
      );
    }
    if (snap.inkClouds.length === 0) {
      unmetPrecondition(
        `no ink cloud was standing after ${INK_KEY} was pressed with the cooldown ` +
          `ready, so the inkClouds list had nothing in it to read — whether the ink ` +
          `control fires is controls/ink-key's verdict, not this one's`,
      );
    }
    if (snap.drifters.length === 0) {
      unmetPrecondition(
        "spawnDrifter added no drifter, so the drifters list had nothing in it to " +
          "read — the operation itself is instrumentation/surface-present's verdict",
      );
    }

    // ---- The run --------------------------------------------------------------
    assertEqual(snap.version, FATHOM_DEBUG_VERSION, "snapshot().version");
    assertContains(SCREENS, snap.screen, "snapshot().screen");
    assertEqual(snap.screen, "playing", "the screen this scene was read on");
    assertNumber(snap, "depth", "snapshot().depth");
    assertGreaterThanOrEqual(
      snap.depth,
      1,
      "snapshot().depth, a whole number from 1",
    );
    assertNumber(snap, "score", "snapshot().score");
    assertNumber(snap, "lives", "snapshot().lives");
    assertBoolean(snap, "muted", "snapshot().muted");
    assertBoolean(snap, "creatureAI", "snapshot().creatureAI");
    assertNumber(snap, "planktonRemaining", "snapshot().planktonRemaining");
    assertNumber(snap, "brightness", "snapshot().brightness");
    assertBetween(snap.brightness, 0, 1, "snapshot().brightness, G in [0, 1]");
    assertNumber(snap, "visionRadius", "snapshot().visionRadius");
    assertNumber(snap, "simTime", "snapshot().simTime");

    // ---- The two cooldown blocks ----------------------------------------------
    assertBoolean(snap.sonar, "ready", "snapshot().sonar.ready");
    assertNumber(snap.sonar, "cooldown", "snapshot().sonar.cooldown");
    assertNumber(snap.sonar, "range", "snapshot().sonar.range");
    assertBoolean(snap.ink, "ready", "snapshot().ink.ready");
    assertNumber(snap.ink, "cooldown", "snapshot().ink.cooldown");

    // ---- The grid frame -------------------------------------------------------
    assertEqual(snap.grid.cols, GRID_COLS, "snapshot().grid.cols (GRID_COLS)");
    assertEqual(snap.grid.rows, GRID_ROWS, "snapshot().grid.rows (GRID_ROWS)");
    assertEqual(snap.grid.tile, TILE, "snapshot().grid.tile (TILE)");
    assertEqual(
      snap.grid.originX,
      GRID_ORIGIN_X,
      "snapshot().grid.originX (GRID_ORIGIN_X)",
    );
    assertEqual(
      snap.grid.originY,
      GRID_ORIGIN_Y,
      "snapshot().grid.originY (GRID_ORIGIN_Y)",
    );

    // ---- The two layouts ------------------------------------------------------
    assertLength(snap.tiles, GRID_ROWS, "snapshot().tiles, one string per row");
    assertLength(
      snap.visibility,
      GRID_ROWS,
      "snapshot().visibility, one string per row",
    );
    for (let ty = 0; ty < GRID_ROWS; ty += 1) {
      assertLength(snap.tiles[ty], GRID_COLS, `snapshot().tiles[${ty}]`);
      assertLength(
        snap.visibility[ty],
        GRID_COLS,
        `snapshot().visibility[${ty}]`,
      );
      for (let tx = 0; tx < GRID_COLS; tx += 1) {
        assertContains(
          TILE_CHARS,
          snap.tiles[ty][tx],
          `snapshot().tiles[${ty}][${tx}], one of the tile alphabet "${TILE_CHARS}"`,
        );
        assertContains(
          VISIBILITY_CHARS,
          snap.visibility[ty][tx],
          `snapshot().visibility[${ty}][${tx}], one of "${VISIBILITY_CHARS}"`,
        );
      }
    }

    // ---- The forager ----------------------------------------------------------
    assertNumber(snap.forager, "x", "snapshot().forager.x");
    assertNumber(snap.forager, "y", "snapshot().forager.y");
    assertNumber(snap.forager, "tx", "snapshot().forager.tx");
    assertNumber(snap.forager, "ty", "snapshot().forager.ty");
    assertContains(DIRS, snap.forager.dir, "snapshot().forager.dir");
    assertBoolean(snap.forager, "moving", "snapshot().forager.moving");
    const foragerTile = tileOf(snap.grid, snap.forager.x, snap.forager.y);
    assertEqual(
      `${snap.forager.tx},${snap.forager.ty}`,
      `${foragerTile.tx},${foragerTile.ty}`,
      `the forager's reported tile against the tile its center ` +
        `(${snap.forager.x}, ${snap.forager.y}) falls in`,
    );

    // ---- The drifters ---------------------------------------------------------
    for (const [index, drifter] of snap.drifters.entries()) {
      const where = `snapshot().drifters[${index}]`;
      assertNumber(drifter, "x", `${where}.x`);
      assertNumber(drifter, "y", `${where}.y`);
      assertNumber(drifter, "tx", `${where}.tx`);
      assertNumber(drifter, "ty", `${where}.ty`);
      const tile = tileOf(snap.grid, drifter.x, drifter.y);
      assertEqual(
        `${drifter.tx},${drifter.ty}`,
        `${tile.tx},${tile.ty}`,
        `${where}'s reported tile against the tile its center falls in`,
      );
    }

    // ---- The predators --------------------------------------------------------
    assertLength(
      snap.predators,
      KINDS.length,
      "the depth-1 roster, which specs/predators.md gives one of each kind",
    );
    for (const [index, predator] of snap.predators.entries()) {
      const where = `snapshot().predators[${index}] (${predator.kind})`;
      assertContains(KINDS, predator.kind, `${where}.kind`);
      assertNumber(predator, "x", `${where}.x`);
      assertNumber(predator, "y", `${where}.y`);
      assertNumber(predator, "tx", `${where}.tx`);
      assertNumber(predator, "ty", `${where}.ty`);
      assertContains(DIRS, predator.dir, `${where}.dir`);
      assertContains(STATES, predator.state, `${where}.state`);
      assertBoolean(predator, "released", `${where}.released`);
      assertNumber(predator, "speed", `${where}.speed`);
      assertBoolean(predator, "alert", `${where}.alert`);
      assertBoolean(predator, "lit", `${where}.lit`);
      // The four per-kind fields, held to the rule specs/state.md gives them: a
      // value for the kind that carries it, `null` for the kinds that do not.
      const lightSensed =
        predator.kind === "lanternjaw" || predator.kind === "flarefish";
      const hears = predator.kind === "gloamfin";
      const flares = predator.kind === "flarefish";
      assertCarried(
        predator,
        "detectRange",
        lightSensed,
        "number",
        `${where}.detectRange`,
      );
      assertCarried(
        predator,
        "hearingRange",
        hears,
        "number",
        `${where}.hearingRange`,
      );
      assertCarried(
        predator,
        "hearingLock",
        hears,
        "boolean",
        `${where}.hearingLock`,
      );
      assertCarried(
        predator,
        "flareCharging",
        flares,
        "boolean",
        `${where}.flareCharging`,
      );
      assertCarried(predator, "flaring", flares, "boolean", `${where}.flaring`);
      assertCarried(
        predator,
        "flareRadius",
        flares,
        "number",
        `${where}.flareRadius`,
      );
      const tile = tileOf(snap.grid, predator.x, predator.y);
      assertEqual(
        `${predator.tx},${predator.ty}`,
        `${tile.tx},${tile.ty}`,
        `${where}'s reported tile against the tile its center falls in`,
      );
    }

    // ---- The wavefronts and the ink -------------------------------------------
    for (const [index, pulse] of snap.pulses.entries()) {
      const where = `snapshot().pulses[${index}]`;
      assertContains(["forager", "gloamfin"], pulse.source, `${where}.source`);
      assertContains(["cyan", "violet", "orange"], pulse.tint, `${where}.tint`);
      assertNumber(pulse, "ox", `${where}.ox`);
      assertNumber(pulse, "oy", `${where}.oy`);
      assertNumber(pulse, "front", `${where}.front`);
      assertNumber(pulse, "range", `${where}.range`);
    }
    for (const [index, cloud] of snap.inkClouds.entries()) {
      const where = `snapshot().inkClouds[${index}]`;
      assertNumber(cloud, "x", `${where}.x`);
      assertNumber(cloud, "y", `${where}.y`);
      assertNumber(cloud, "radius", `${where}.radius`);
      assertNumber(cloud, "remaining", `${where}.remaining`);
    }
  });
});
