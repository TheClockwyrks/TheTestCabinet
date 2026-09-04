// Fathom — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it, and `initialize` returns it beside the state it
// built, as the pair `[state, debug]`: the engine holds the second element and
// returns it from `engine.debug`, which is the one way a caller reaches it.
// Nothing is installed on the page, nothing here holds state, and the surface is
// inert during normal play — nothing below runs until something calls it.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the
// next one, and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.setScreen(s, "playing"))`. A READING takes
// the current state and returns what it read, as `debug.snapshot(engine.state)`.
//
// EACH POSE SETS ONE THING and leaves the rest of the game as it stands, so a
// caller that wants several things arranged makes several calls, in the order it
// wants them, and nothing it did not ask for happens. That is what lets a caller
// stand the game in a world holding only what it is about: clear the predators,
// clear the drifters, clear the plankton, and add back exactly the one creature
// under test.
//
// The other half of that split is that a pose ARRANGES THE GAME and never
// fabricates an outcome: it puts the game into a situation, and the game's own
// sensing, pathfinding, release schedule and contact rules run from there when
// the engine advances a frame — through the very functions `update` calls. So a
// scenario driven from code behaves exactly like one played by hand. Every screen
// here is entered through `src/flow.ts`, every predator posed through
// `src/predators.ts`, and every drifter built by `src/simulate.ts`, so there is
// no second path into the game.
//
// Everything about DRIVING A BROWSER GAME rather than about Fathom belongs to
// the engine and is deliberately absent: there is no clock operation (the engine
// owns the clock and runs exact frames), no key operation (the engine drives the
// registered actions, and a dispatched keyboard event moves the forager exactly
// as a player's key does), and no overlay operation (the engine draws the panel
// and owns the backtick key).

import {
  BRIGHT_HOLD,
  DEFAULT_SEED,
  FATHOM_DEBUG_VERSION,
  LINGER_TIME,
  PREDATOR_KINDS,
  type PredatorKind,
} from "./constants";
import { DIRS, centerX, centerY, tileIndex } from "./grid";
import { SCREENS, enterScreen, housePredators, openingState } from "./flow";
import {
  foragerCanEnter,
  isDen,
  isGate,
  layoutProblem,
  loadLayout,
  predatorCanEnter,
} from "./maze";
import { itemRect, menuItems, type Rect } from "./menu";
import { addedPredator, chaseSpeedOf, denPose, wanderSpeed } from "./predators";
import { bodyTile } from "./entities";
import { createDrifter } from "./simulate";
import { emptyGrid } from "./sensing";
import { snapshotOf, type FathomSnapshot } from "./snapshot";
import type {
  Dir,
  DrifterState,
  FathomState,
  MazeState,
  PredatorState,
  Screen,
  Tile,
} from "./state";
import type { DeepReadonly } from "ts-essentials";

/** The states `setPredatorState` poses. `"search"` is reached only by behavior. */
export type PosedPredatorMode = "den" | "wander" | "chase";

/**
 * The surface. Every pose takes the current state and returns the next; the one
 * reading, `snapshot`, takes the current state and returns what it read.
 */
export interface FathomDebugApi {
  version: number;
  reset(state: DeepReadonly<FathomState>, seed?: number): FathomState;
  snapshot(state: DeepReadonly<FathomState>): FathomSnapshot;
  menuItemRect(state: DeepReadonly<FathomState>, index: number): Rect | null;
  setScreen(state: DeepReadonly<FathomState>, s: Screen): FathomState;
  setMenuIndex(state: DeepReadonly<FathomState>, index: number): FathomState;
  setTitleIndex(state: DeepReadonly<FathomState>, index: number): FathomState;
  setScore(state: DeepReadonly<FathomState>, points: number): FathomState;
  setLives(state: DeepReadonly<FathomState>, n: number): FathomState;
  setDepth(state: DeepReadonly<FathomState>, d: number): FathomState;
  setMaze(
    state: DeepReadonly<FathomState>,
    rows: readonly string[],
  ): FathomState;
  setPlankton(
    state: DeepReadonly<FathomState>,
    tx: number,
    ty: number,
    present: boolean,
  ): FathomState;
  clearPlankton(state: DeepReadonly<FathomState>): FathomState;
  clearFog(state: DeepReadonly<FathomState>): FathomState;
  setForagerTile(
    state: DeepReadonly<FathomState>,
    tx: number,
    ty: number,
  ): FathomState;
  setForagerDir(state: DeepReadonly<FathomState>, dir: Dir): FathomState;
  setBrightness(state: DeepReadonly<FathomState>, g: number): FathomState;
  setBrightHold(state: DeepReadonly<FathomState>, seconds: number): FathomState;
  clearPredators(state: DeepReadonly<FathomState>): FathomState;
  addPredator(
    state: DeepReadonly<FathomState>,
    kind: PredatorKind,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorTile(
    state: DeepReadonly<FathomState>,
    index: number,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorDir(
    state: DeepReadonly<FathomState>,
    index: number,
    dir: Dir,
  ): FathomState;
  setPredatorState(
    state: DeepReadonly<FathomState>,
    index: number,
    value: PosedPredatorMode,
  ): FathomState;
  setPredatorReleased(
    state: DeepReadonly<FathomState>,
    index: number,
    released: boolean,
  ): FathomState;
  setPredatorMind(
    state: DeepReadonly<FathomState>,
    index: number,
    enabled: boolean,
  ): FathomState;
  setPredatorTravel(
    state: DeepReadonly<FathomState>,
    index: number,
    enabled: boolean,
  ): FathomState;
  spawnDrifter(
    state: DeepReadonly<FathomState>,
    tx: number,
    ty: number,
  ): FathomState;
  clearDrifters(state: DeepReadonly<FathomState>): FathomState;
  setDrifterMind(
    state: DeepReadonly<FathomState>,
    index: number,
    enabled: boolean,
  ): FathomState;
  setDrifterTravel(
    state: DeepReadonly<FathomState>,
    index: number,
    enabled: boolean,
  ): FathomState;
  setSonarCooldown(
    state: DeepReadonly<FathomState>,
    seconds: number,
  ): FathomState;
  setInkCooldown(
    state: DeepReadonly<FathomState>,
    seconds: number,
  ): FathomState;
}

// ---- Domains -------------------------------------------------------------
//
// An argument outside the domain its operation states is invalid, and so is a
// call whose subject is not in the condition the operation states. Either fails
// loudly rather than guessing what was meant.

function requireDir(op: string, dir: Dir): Dir {
  if (!DIRS.includes(dir)) {
    throw new RangeError(
      `Fathom: ${op} direction ${JSON.stringify(dir)} — expected one of ${DIRS.join(", ")}`,
    );
  }
  return dir;
}

function requireSeconds(op: string, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(
      `Fathom: ${op} seconds ${seconds} — expected a finite number of seconds, at least 0`,
    );
  }
  return seconds;
}

function requireWhole(op: string, name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `Fathom: ${op} ${name} ${value} — expected a whole number, at least 0`,
    );
  }
  return value;
}

function requireCorridor(
  op: string,
  maze: MazeState,
  tx: number,
  ty: number,
): Tile {
  if (!foragerCanEnter(maze, tx, ty)) {
    throw new RangeError(
      `Fathom: ${op} tile (${tx}, ${ty}) — expected an open corridor tile`,
    );
  }
  return { tx, ty };
}

function requirePredator(
  op: string,
  predators: readonly PredatorState[],
  index: number,
): PredatorState {
  if (!Number.isInteger(index) || index < 0 || index >= predators.length) {
    throw new RangeError(
      `Fathom: ${op} index ${index} — the roster holds ${predators.length} predators, indexed from 0`,
    );
  }
  return predators[index];
}

function requireDrifter(
  op: string,
  drifters: readonly DrifterState[],
  index: number,
): DrifterState {
  if (!Number.isInteger(index) || index < 0 || index >= drifters.length) {
    throw new RangeError(
      `Fathom: ${op} index ${index} — the maze holds ${drifters.length} drifters, indexed from 0`,
    );
  }
  return drifters[index];
}

/** The predators with the one at `index` replaced. */
function withPredator(
  predators: readonly PredatorState[],
  index: number,
  predator: PredatorState,
): readonly PredatorState[] {
  return predators.map((p, at) => (at === index ? predator : p));
}

/** The drifters with the one at `index` replaced. */
function withDrifter(
  drifters: readonly DrifterState[],
  index: number,
  drifter: DrifterState,
): readonly DrifterState[] {
  return drifters.map((d, at) => (at === index ? drifter : d));
}

// ---- The surface ---------------------------------------------------------

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): FathomDebugApi {
  return {
    version: FATHOM_DEBUG_VERSION,

    /**
     * Every field of the observable state back at its title-screen value, with
     * the game's randomness reseeded.
     *
     * `muted` is deliberately untouched, because muting is a player preference
     * rather than a value a dive opens with, and the art is carried through
     * because it is the project's rather than the dive's.
     */
    reset(state, seed = DEFAULT_SEED) {
      return openingState(state.sheets, seed, state.muted);
    },

    /** A pure read. It poses nothing, so it returns no state. */
    snapshot(state) {
      return snapshotOf(state, FATHOM_DEBUG_VERSION);
    },

    /**
     * Where this build drew item `index` of the menu the current screen shows,
     * in logical units. A pure read: it poses nothing, so it returns no state.
     *
     * `null` on the four screens that show no menu, and for an index the current
     * menu does not hold, which is what `specs/instrumentation.md` fixes.
     */
    menuItemRect(state, index) {
      return itemRect(state.screen, index);
    },

    /**
     * The screen the game is showing, and no other field.
     *
     * It enters the screen by the same route the game's own transitions do, so
     * each screen's own behavior follows: the countdown counts down, the maze is
     * frozen while paused, and the den's staggered schedule — which runs on live
     * play alone — takes its origin from the moment `screen` becomes `"playing"`.
     */
    setScreen(state, s) {
      if (!SCREENS.includes(s)) {
        throw new RangeError(
          `Fathom: setScreen screen ${JSON.stringify(s)} — expected one of ${SCREENS.join(", ")}`,
        );
      }
      return enterScreen(state, s);
    },

    /**
     * The highlighted item of whichever menu the current screen shows, and no
     * other field: the screen, the maze and every body stay exactly as they
     * stand, and a `confirm` from there takes the item this named.
     */
    setMenuIndex(state, index) {
      const items = menuItems(state.screen);
      if (items.length === 0) {
        throw new RangeError(
          `Fathom: setMenuIndex — the ${state.screen} screen shows no menu`,
        );
      }
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        throw new RangeError(
          `Fathom: setMenuIndex index ${index} — expected one of the ` +
            `${items.length} items the ${state.screen} menu holds`,
        );
      }
      return { ...state, menuIndex: index };
    },

    /**
     * The title menu's remembered selection, and nothing else: the screen and
     * the highlighted item stay as they stand, so the value set here is the one
     * the next arrival at the title selects.
     */
    setTitleIndex(state, index) {
      const items = menuItems("title");
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        throw new RangeError(
          `Fathom: setTitleIndex index ${index} — expected one of the ` +
            `${items.length} items the title menu holds`,
        );
      }
      return { ...state, titleIndex: index };
    },

    /** The running score. Play carries on from that figure. */
    setScore(state, points) {
      return { ...state, score: requireWhole("setScore", "points", points) };
    },

    /**
     * The lives held in reserve. The life being played is not among them, so
     * `setLives(0)` leaves one attempt running.
     */
    setLives(state, n) {
      return { ...state, lives: requireWhole("setLives", "lives", n) };
    },

    /**
     * The depth, from which what the specification derives from depth follows:
     * the sonar range is the one `specs/progression.md` gives, and the roster is
     * the one `specs/predators.md` gives for `d`, laid out in the den with every
     * `released` flag false, exactly as a maze at that depth lays it out. It
     * changes neither the maze, the plankton, the fog nor the screen.
     */
    setDepth(state, d) {
      if (!Number.isInteger(d) || d < 1) {
        throw new RangeError(
          `Fathom: setDepth depth ${d} — expected a whole number, at least 1`,
        );
      }
      return {
        ...state,
        depth: d,
        predators: housePredators(state.maze, d),
      };
    },

    /**
     * The maze layout replaced by a posed fixture, used exactly as given.
     *
     * The fixture is exempt from every rule in `specs/maze.md`, so only the three
     * ways a layout is not a layout are refused: the wrong size, a character
     * outside the alphabet, and den tiles without exactly one gate. Everything the
     * maze derives comes back off the new rows — the wrap tunnel, the gate and the
     * den — so a structure the fixture does not have simply takes no part.
     *
     * THE LAYOUT IS THE WHOLE OF WHAT IT SETS. The plankton, the fog, the roster,
     * every body's tile and facing, the cooldowns, the score, the lives, the depth
     * and the screen are left exactly as they stand, so a caller poses each of
     * those itself. A body the new layout leaves on a tile closed to it holds that
     * tile and travels nowhere, because `src/entities.ts` carries a body only
     * along tiles open to it.
     */
    setMaze(state, rows) {
      const problem = layoutProblem(rows);
      if (problem !== null) {
        throw new RangeError(`Fathom: setMaze rows — ${problem}`);
      }
      return { ...state, maze: loadLayout(rows) };
    },

    /**
     * A plankton put on an open corridor tile or taken off it, with
     * `planktonRemaining` adjusted to match. Removing one this way is not eating
     * it, so it scores nothing and clears no maze.
     */
    setPlankton(state, tx, ty, present) {
      const tile = requireCorridor("setPlankton", state.maze, tx, ty);
      const index = tileIndex(tile.tx, tile.ty);
      if (state.plankton[index] === present) return state;
      const plankton = [...state.plankton];
      plankton[index] = present;
      return {
        ...state,
        plankton,
        planktonRemaining: state.planktonRemaining + (present ? 1 : -1),
      };
    },

    /**
     * Every plankton off the maze at once. As with `setPlankton` nothing here is
     * eaten, so it scores nothing and clears no maze: an empty maze the forager
     * has not just eaten from stays in live play, and with no plankton left the
     * bonus-drifter cadence admits none.
     */
    clearPlankton(state) {
      return { ...state, plankton: emptyGrid(), planktonRemaining: 0 };
    },

    /**
     * Every tile back to unrevealed, so `visibility` reports `u` everywhere until
     * light, sonar or a flare reaches a tile again. It moves nothing and reveals
     * nothing, so the lit layer goes with the memory: what is lit this instant is
     * recomputed from the forager's light when the simulation next advances.
     */
    clearFog(state) {
      return { ...state, revealed: emptyGrid(), lit: emptyGrid() };
    },

    /**
     * The forager at rest on the center of an open corridor tile, as though no
     * movement key were held. Its facing is untouched, and injected input moves it
     * from there through the game's ordinary movement code.
     */
    setForagerTile(state, tx, ty) {
      const tile = requireCorridor("setForagerTile", state.maze, tx, ty);
      return {
        ...state,
        forager: {
          ...state.forager,
          x: centerX(tile.tx),
          y: centerY(tile.ty),
          heading: null,
          desired: null,
        },
      };
    },

    /** The forager's facing. It moves it nowhere and leaves it at rest. */
    setForagerDir(state, dir) {
      return {
        ...state,
        forager: {
          ...state.forager,
          facing: requireDir("setForagerDir", dir),
          heading: null,
        },
      };
    },

    /**
     * The brightness `G`, from which the light radius `V` and the Lanternjaw's and
     * Flarefish's detection ranges recompute.
     *
     * The hold is left as it stands, so `G` decays from the posed value on the
     * ordinary curve as soon as whatever hold was running expires. Posing a steady
     * brightness is this call followed by `setBrightHold(BRIGHT_HOLD)`, which is
     * the pair eating a plankton arms.
     */
    setBrightness(state, g) {
      if (!Number.isFinite(g) || g < 0 || g > 1) {
        throw new RangeError(
          `Fathom: setBrightness brightness ${g} — expected a number in [0, 1]`,
        );
      }
      return { ...state, brightness: g };
    },

    /**
     * The seconds left on the brightness hold. While it runs `G` is steady, and at
     * `0` it decays on the ordinary curve. It changes `G` itself not at all.
     */
    setBrightHold(state, seconds) {
      const held = requireSeconds("setBrightHold", seconds);
      if (held > BRIGHT_HOLD) {
        throw new RangeError(
          `Fathom: setBrightHold seconds ${seconds} — expected at most ${BRIGHT_HOLD}`,
        );
      }
      return { ...state, brightHold: held };
    },

    /**
     * Every predator off the board at once.
     *
     * The removal catches nobody and scores nothing, and no release schedule runs,
     * because there is no predator left to run one. The roster stays empty until a
     * call adds one, or until `reset`, `setDepth`, or a maze laid out by a descent
     * or a lost life gives the depth its own roster again.
     */
    clearPredators(state) {
      return { ...state, predators: [] };
    },

    /**
     * One predator of `kind` added at the end of the roster, at the center of an
     * open corridor tile.
     *
     * It arrives loose and patrolling, released, its mind and its travel running
     * and facing up, whatever roster the current depth gives, and it hunts,
     * senses, chases and makes contact from there exactly as one released from the
     * den does. It carries no release time, because the staggered schedule runs on
     * the roster a maze is laid out with.
     */
    addPredator(state, kind, tx, ty) {
      if (!PREDATOR_KINDS.includes(kind)) {
        throw new RangeError(
          `Fathom: addPredator kind ${JSON.stringify(kind)} — expected one of ${PREDATOR_KINDS.join(", ")}`,
        );
      }
      const tile = requireCorridor("addPredator", state.maze, tx, ty);
      return {
        ...state,
        predators: [...state.predators, addedPredator(kind, tile.tx, tile.ty)],
      };
    },

    /**
     * One predator moved to the center of a tile it may stand on: an open corridor
     * tile, a den tile, or the den gate. Its facing, its state, its `released`
     * flag, its mind and its travel are untouched.
     */
    setPredatorTile(state, index, tx, ty) {
      const predator = requirePredator(
        "setPredatorTile",
        state.predators,
        index,
      );
      if (!predatorCanEnter(state.maze, tx, ty)) {
        throw new RangeError(
          `Fathom: setPredatorTile tile (${tx}, ${ty}) — expected an open corridor tile, a den tile or the den gate`,
        );
      }
      return {
        ...state,
        predators: withPredator(state.predators, index, {
          ...predator,
          x: centerX(tx),
          y: centerY(ty),
          heading: null,
        }),
      };
    },

    /** One predator's facing. */
    setPredatorDir(state, index, dir) {
      const predator = requirePredator(
        "setPredatorDir",
        state.predators,
        index,
      );
      return {
        ...state,
        predators: withPredator(state.predators, index, {
          ...predator,
          facing: requireDir("setPredatorDir", dir),
        }),
      };
    },

    /**
     * One predator's state, posed where it already stands.
     *
     * It moves the predator nowhere and leaves its `released` flag, its mind and
     * its travel as they stand, so `"den"` is posed on a den tile or the den gate
     * and the two loose states on an open corridor tile. After the call the
     * predator's own mind runs whenever the simulation advances: it senses,
     * acquires, chases and searches through the real code.
     */
    setPredatorState(state, index, value) {
      const predator = requirePredator(
        "setPredatorState",
        state.predators,
        index,
      );
      if (value !== "den" && value !== "wander" && value !== "chase") {
        throw new RangeError(
          `Fathom: setPredatorState value ${JSON.stringify(value)} — expected "den", "wander" or "chase"`,
        );
      }
      requireStandingFor(value, state.maze, predator);
      return {
        ...state,
        predators: withPredator(
          state.predators,
          index,
          posePredator(state, predator, value),
        ),
      };
    },

    /**
     * One predator's `released` flag, which says whether its turn in the staggered
     * schedule has come. It moves the predator nowhere and changes its state not at
     * all.
     */
    setPredatorReleased(state, index, released) {
      const predator = requirePredator(
        "setPredatorReleased",
        state.predators,
        index,
      );
      return {
        ...state,
        predators: withPredator(state.predators, index, {
          ...predator,
          released,
        }),
      };
    },

    /**
     * One predator's own mind, which is its sensing and its deciding. With it off
     * that predator senses nothing and decides nothing, keeping the facing, the
     * state and the fix it was posed with, and nothing is decided, so nothing is
     * carried out and it holds exactly where it stands. It is still drawn under the
     * rule its kind and its lighting give, and contact with it still costs a life.
     * Every other predator, and everything else in the game, carries on untouched.
     */
    setPredatorMind(state, index, enabled) {
      const predator = requirePredator(
        "setPredatorMind",
        state.predators,
        index,
      );
      return {
        ...state,
        predators: withPredator(state.predators, index, {
          ...predator,
          mind: enabled,
        }),
      };
    },

    /**
     * One predator's travel, which is what carries its body where its mind
     * decides. With it off that predator's body holds the tile it stands on
     * whatever its mind decides, and its mind runs untouched: it senses, takes and
     * lapses a fix, fires its detection alert, changes its state under its own
     * rules, and reports the speed that state carries. Its `released` flag still
     * turns over when its slot arrives, and it holds in the den from there, because
     * crossing the chamber to the gate is travel. It is still drawn under the rule
     * its kind and its lighting give, and contact with it still costs a life. Every
     * other predator, and everything else in the game, carries on untouched.
     */
    setPredatorTravel(state, index, enabled) {
      const predator = requirePredator(
        "setPredatorTravel",
        state.predators,
        index,
      );
      return {
        ...state,
        predators: withPredator(state.predators, index, {
          ...predator,
          travel: enabled,
        }),
      };
    },

    /**
     * One bonus drifter added at the end of the list, at the center of an open
     * corridor tile. It then wanders through the ordinary drifter code and is worth
     * the ordinary bonus when eaten, whatever the cadence is doing and whatever the
     * ceiling would allow.
     */
    spawnDrifter(state, tx, ty) {
      const tile = requireCorridor("spawnDrifter", state.maze, tx, ty);
      return {
        ...state,
        drifters: [...state.drifters, createDrifter(tile.tx, tile.ty)],
      };
    },

    /**
     * Every bonus drifter off the maze at once. None of them is eaten, so nothing
     * is scored, and the cadence carries on from there and tops the maze back up on
     * its own schedule while plankton remain.
     */
    clearDrifters(state) {
      return { ...state, drifters: [] };
    },

    /**
     * One drifter's own mind, which is the wander it decides. With it off that
     * drifter decides nothing, so nothing is carried out and it holds exactly where
     * it stands. It is still drawn, still eaten by a forager whose tile it shares,
     * and still worth the ordinary bonus. Every other drifter, and everything else
     * in the game, carries on untouched.
     */
    setDrifterMind(state, index, enabled) {
      const drifter = requireDrifter("setDrifterMind", state.drifters, index);
      return {
        ...state,
        drifters: withDrifter(state.drifters, index, {
          ...drifter,
          mind: enabled,
        }),
      };
    },

    /**
     * One drifter's travel, which is what carries its body where its wander
     * decides. With it off that drifter's body holds the tile it stands on whatever
     * its wander decides. It is still drawn, still eaten by a forager whose tile it
     * shares, and still worth the ordinary bonus. Every other drifter, and
     * everything else in the game, carries on untouched.
     */
    setDrifterTravel(state, index, enabled) {
      const drifter = requireDrifter("setDrifterTravel", state.drifters, index);
      return {
        ...state,
        drifters: withDrifter(state.drifters, index, {
          ...drifter,
          travel: enabled,
        }),
      };
    },

    /** The seconds left on the sonar pulse's cooldown, which runs down from there. */
    setSonarCooldown(state, seconds) {
      return {
        ...state,
        sonarCooldown: requireSeconds("setSonarCooldown", seconds),
      };
    },

    /** The seconds left on ink's cooldown, which runs down from there. */
    setInkCooldown(state, seconds) {
      return {
        ...state,
        inkCooldown: requireSeconds("setInkCooldown", seconds),
      };
    },
  };
}

/** The tiles each posed state is valid on (`specs/instrumentation.md`). */
function requireStandingFor(
  value: PosedPredatorMode,
  maze: MazeState,
  predator: PredatorState,
): void {
  const at = bodyTile(predator);
  const inDen = isDen(maze, at.tx, at.ty) || isGate(maze, at.tx, at.ty);
  if (value === "den" && !inDen) {
    throw new RangeError(
      `Fathom: setPredatorState "den" — the predator stands on (${at.tx}, ${at.ty}), which is neither a den tile nor the den gate`,
    );
  }
  if (value !== "den" && !foragerCanEnter(maze, at.tx, at.ty)) {
    throw new RangeError(
      `Fathom: setPredatorState ${JSON.stringify(value)} — the predator stands on (${at.tx}, ${at.ty}), which is not an open corridor tile`,
    );
  }
}

/** One predator posed into `value`, with everything that state implies. */
function posePredator(
  state: DeepReadonly<FathomState>,
  predator: PredatorState,
  value: PosedPredatorMode,
): PredatorState {
  if (value === "den") return denPose(predator);

  const loose: PredatorState = {
    ...predator,
    mode: "wander",
    fix: null,
    linger: 0,
    // A pose is an arrangement rather than an acquisition, so it fires no alert
    // and leaves no sonar mark behind it.
    alertIn: 0,
    markIn: 0,
    searchIn: 0,
    searchPingIn: null,
    flarePhase: null,
    heading: null,
    speed: wanderSpeed(predator.kind),
  };
  if (value === "wander") return loose;

  // A posed chase is fixed on the forager's current tile and holds that fix for
  // the same linger a real acquisition gives it, so it lapses through the game's
  // own rule rather than running forever.
  const forager = bodyTile(state.forager);
  return {
    ...loose,
    mode: "chase",
    fix: { tx: forager.tx, ty: forager.ty },
    linger: LINGER_TIME,
    speed: chaseSpeedOf(predator.kind),
  };
}
