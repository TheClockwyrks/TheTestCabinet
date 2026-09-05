// Fathom — the debugging and automation surface, `window.__fathom`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is
// inert during normal play: nothing below runs until something calls it.
//
// EVERY POSE SETS ONE THING. There is no operation here that arranges the maze,
// the roster, the plankton and the fog together, because a caller that wants
// several of those arranged says so in several calls and gets nothing it did not
// ask for. What each call does set, it sets by writing the same fields play
// writes, so the game's own tick — the real sensing, the real pathfinding, the
// real release schedule and the real contact rules — is what runs from there.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Everything else about driving a browser game stays
// absent: there is no `keyDown`, `keyUp` or `press`, because the runtime's
// registered actions are driven by dispatching real key events at the page, and
// no overlay operation, because the runtime draws the panel and owns the
// backtick key.

import {
  BRIGHT_HOLD,
  DEFAULT_SEED,
  DRIFTER_INTERVAL,
  DRIFTER_SPEED,
  FATHOM_DEBUG_VERSION,
  GLOAMFIN_CHASE_SPEED,
  GRID_COLS,
  GRID_ROWS,
  LINGER_TIME,
} from "./constants";
import { Drifter, Predator } from "./entities";
import {
  buildRoster,
  denPredators,
  poseMaze,
  poseScreen,
  restPredator,
  toTitle,
  type FathomState,
} from "./game";
import { itemRect, type Rect } from "./menu";
import { menuItems } from "./readings";
import { tileKey } from "./sensing";
import { snapshot, type FathomSnapshot } from "./snapshot";
import {
  DIRS,
  PREDATOR_KINDS,
  SCREENS,
  type Dir,
  type PredatorKind,
  type PredatorState,
  type Screen,
} from "./types";

/** The `window` property the surface is installed on. */
export const FATHOM_HANDLE = "__fathom";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this
 * file exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Whether the loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `ticks` whole simulation ticks, then redraw. */
  advance(ticks: number): void;
}

/** The three states a predator may be posed into. `"search"` is not posed. */
const POSABLE_STATES: readonly PredatorState[] = ["den", "wander", "chase"];

export interface FathomDebugApi {
  version: number;
  setAutoStep(enabled: boolean): void;
  advance(ticks: number): void;
  reset(seed?: number): void;
  snapshot(): FathomSnapshot;
  menuItemRect(index: number): Rect | null;
  setScreen(s: Screen): void;
  setMenuIndex(index: number): void;
  setTitleIndex(index: number): void;
  setScore(points: number): void;
  setLives(n: number): void;
  setDepth(d: number): void;
  setMaze(rows: readonly string[]): void;
  setPlankton(tx: number, ty: number, present: boolean): void;
  clearPlankton(): void;
  clearFog(): void;
  setForagerTile(tx: number, ty: number): void;
  setForagerDir(dir: Dir): void;
  setBrightness(g: number): void;
  setBrightHold(seconds: number): void;
  clearPredators(): void;
  addPredator(kind: PredatorKind, tx: number, ty: number): void;
  setPredatorTile(index: number, tx: number, ty: number): void;
  setPredatorDir(index: number, dir: Dir): void;
  setPredatorState(index: number, value: PredatorState): void;
  setPredatorReleased(index: number, released: boolean): void;
  setPredatorMind(index: number, enabled: boolean): void;
  setPredatorTravel(index: number, enabled: boolean): void;
  spawnDrifter(tx: number, ty: number): void;
  clearDrifters(): void;
  setDrifterMind(index: number, enabled: boolean): void;
  setDrifterTravel(index: number, enabled: boolean): void;
  setDrifterIn(seconds: number): void;
  setSonarCooldown(seconds: number): void;
  setInkCooldown(seconds: number): void;
}

/** Fail loudly rather than guessing what an out-of-domain argument meant. */
function invalid(message: string): never {
  throw new RangeError(`Fathom: ${message}`);
}

function requireWhole(name: string, value: number, least: number): number {
  if (!Number.isInteger(value) || value < least) {
    invalid(
      `${name} must be a whole number of at least ${least}, got ${value}`,
    );
  }
  return value;
}

function requireSeconds(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    invalid(`${name} must be a finite number of seconds, got ${value}`);
  }
  return value;
}

function requireDir(value: Dir): Dir {
  if (!DIRS.includes(value)) {
    invalid(`a direction must be one of ${DIRS.join(", ")}, got ${value}`);
  }
  return value;
}

function requireOnGrid(tx: number, ty: number): void {
  if (
    !Number.isInteger(tx) ||
    !Number.isInteger(ty) ||
    tx < 0 ||
    tx >= GRID_COLS ||
    ty < 0 ||
    ty >= GRID_ROWS
  ) {
    invalid(`the tile (${tx}, ${ty}) is off the grid`);
  }
}

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: FathomState,
  clock: DebugClock,
): FathomDebugApi {
  /** A tile the forager, a drifter, a plankton or a loose predator stands on. */
  function requireCorridor(tx: number, ty: number): void {
    requireOnGrid(tx, ty);
    if (!state.maze.isCorridor(tx, ty)) {
      invalid(`the tile (${tx}, ${ty}) is not an open corridor tile`);
    }
  }

  /** A tile a predator may stand on: corridor, the den chamber, or the gate. */
  function requirePredatorTile(tx: number, ty: number): void {
    requireOnGrid(tx, ty);
    if (!state.maze.isDenOpen(tx, ty)) {
      invalid(`the tile (${tx}, ${ty}) is not open to a predator`);
    }
  }

  /** One predator, selected by its position in the snapshot's list. */
  function predatorAt(index: number): Predator {
    const p = state.predators[index];
    if (p === undefined) {
      invalid(
        `predator index ${index} is outside the roster of ${state.predators.length}`,
      );
    }
    return p;
  }

  /** One drifter, selected by its position in the snapshot's list. */
  function drifterAt(index: number): Drifter {
    const d = state.drifters[index];
    if (d === undefined) {
      invalid(
        `drifter index ${index} is outside the ${state.drifters.length} in the maze`,
      );
    }
    return d;
  }

  return {
    version: FATHOM_DEBUG_VERSION,

    /**
     * Take the game off real time, and give it back.
     *
     * Drawing is unaffected either way: the loop keeps rendering, so the canvas
     * shows the state the most recent tick left.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `ticks` whole simulation ticks immediately and in order, each worth
     * exactly one `TICK_DT`.
     *
     * Every one is a real tick, the same one the frame loop runs, so the game's
     * own sensing, pathfinding and contact rules produce the result. Advancing
     * while the game is still stepping automatically ADDS to what the wall clock
     * is already doing, so a reproducible scenario calls `setAutoStep(false)`
     * first.
     */
    advance(ticks) {
      clock.advance(requireWhole("a tick count", ticks, 0));
    },

    /**
     * Return the game to its title-screen values and reseed its randomness.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again.
     * Manual stepping is re-armed, so the game comes back off the wall clock.
     */
    reset(seed = DEFAULT_SEED) {
      if (!Number.isFinite(seed)) invalid(`a seed must be finite, got ${seed}`);
      state.rng.reseed(seed);
      // The remembered title selection is a field of the declared state like any
      // other, so a reset puts it back to `0` and the title comes up on `DIVE`.
      state.titleIndex = 0;
      toTitle(state);
      state.simTime = 0;
      clock.setAutoStep(false);
    },

    /** A pure read. It changes nothing. */
    snapshot() {
      return snapshot(state, clock.autoStep());
    },

    /**
     * Where this build drew item `index` of the menu the current screen shows,
     * in logical units. A pure read: it changes nothing.
     *
     * `null` on the four screens that show no menu, and for an index the current
     * menu does not hold, which is what `specs/instrumentation.md` fixes.
     */
    menuItemRect(index) {
      return itemRect(state.screen, index);
    },

    /**
     * Set the screen, and no other field. The game carries on under its own
     * rules from there, so the countdown counts down, the maze is frozen while
     * paused, and the den's staggered schedule takes its origin from the moment
     * live play begins.
     */
    setScreen(s) {
      if (!SCREENS.includes(s)) {
        invalid(`a screen is one of ${SCREENS.join(", ")}, got ${s}`);
      }
      poseScreen(state, s);
    },

    /**
     * Highlight one item of whichever menu the current screen shows, and change
     * nothing else: the screen, the maze and every body stay exactly as they
     * stand, and a `confirm` from there takes the item this named.
     */
    setMenuIndex(index) {
      const items = menuItems(state.screen);
      if (items.length === 0) {
        invalid(`the ${state.screen} screen shows no menu to highlight`);
      }
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        invalid(
          `menu index ${index} is outside the ${items.length} items the ` +
            `${state.screen} menu holds`,
        );
      }
      state.menu = index;
    },

    /**
     * Set the title menu's remembered selection, and nothing else: the screen
     * and the highlighted item stay as they stand, so the value set here is the
     * one the next arrival at the title selects.
     */
    setTitleIndex(index) {
      const items = menuItems("title");
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        invalid(
          `title index ${index} is outside the ${items.length} items the ` +
            "title menu holds",
        );
      }
      state.titleIndex = index;
    },

    /** Set the running score. Play carries on from that figure. */
    setScore(points) {
      state.score = requireWhole("a score", points, 0);
    },

    /**
     * Set the lives held in reserve. The life being played is not among them, so
     * `setLives(0)` leaves one attempt running.
     */
    setLives(n) {
      state.lives = requireWhole("a life count", n, 0);
    },

    /**
     * Set the current depth. What the specification derives from depth follows:
     * the sonar range is that depth's, and the roster becomes the one that depth
     * gives, laid out in the den unreleased exactly as a maze at that depth lays
     * it out. The maze, the plankton, the fog and the screen are untouched.
     */
    setDepth(d) {
      state.depth = requireWhole("a depth", d, 1);
      buildRoster(state);
      denPredators(state);
    },

    /** Replace the maze layout with a posed fixture, and nothing else. */
    setMaze(rows) {
      if (!Array.isArray(rows)) {
        invalid("setMaze takes an array of row strings");
      }
      for (const row of rows) {
        if (typeof row !== "string") invalid("every posed row is a string");
      }
      poseMaze(state, rows);
    },

    /**
     * Put a plankton on a tile or take one off, adjusting the count to match.
     * Removing one this way is not eating it, so it scores nothing and clears no
     * maze.
     */
    setPlankton(tx, ty, present) {
      requireCorridor(tx, ty);
      const key = tileKey(tx, ty);
      const wanted = Boolean(present);
      if (state.plankton[key] === wanted) return;
      state.plankton[key] = wanted;
      state.planktonRemaining += wanted ? 1 : -1;
    },

    /**
     * Take every plankton off the maze at once. As with `setPlankton`, nothing
     * here is eaten, so an empty maze the forager has not just eaten from stays
     * in live play.
     */
    clearPlankton() {
      state.plankton.fill(false);
      state.planktonRemaining = 0;
    },

    /**
     * Put every tile back to unrevealed. It moves nothing and reveals nothing;
     * light, sonar and a flare reveal them again from there.
     */
    clearFog() {
      state.fog.reset();
    },

    /**
     * Move the forager to a tile's center and leave it at rest there, as though
     * no movement key were held. Its facing is untouched, and injected input
     * moves it from there through the game's ordinary movement code.
     */
    setForagerTile(tx, ty) {
      requireCorridor(tx, ty);
      state.forager.placeOn(tx, ty);
      state.desired = null;
    },

    /** Set the forager's facing. It moves nowhere and stays at rest. */
    setForagerDir(dir) {
      state.forager.facing = requireDir(dir);
      state.forager.dir = null;
      state.desired = null;
    },

    /**
     * Set the brightness `G`. Everything derived from it — the light radius `V`
     * and the two light hunters' detection ranges — recomputes from it.
     *
     * The hold is left exactly as it stands, so `G` decays from the posed value
     * as soon as whatever hold was running expires. A steady brightness is this
     * followed by `setBrightHold`.
     */
    setBrightness(g) {
      if (!Number.isFinite(g) || g < 0 || g > 1) {
        invalid(`a brightness must lie in [0, 1], got ${g}`);
      }
      state.forager.brightness = g;
    },

    /**
     * Set the seconds left on the brightness hold. `G` is steady while it runs
     * and decays on the ordinary curve once it reaches `0`. It changes `G`
     * itself not at all.
     */
    setBrightHold(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > BRIGHT_HOLD) {
        invalid(
          `a brightness hold must lie in [0, ${BRIGHT_HOLD}], got ${seconds}`,
        );
      }
      state.forager.hold = seconds;
    },

    /**
     * Take every predator off the board at once. The removal catches nobody and
     * scores nothing, and no release schedule runs, because there is no predator
     * left to run one.
     */
    clearPredators() {
      state.predators = [];
    },

    /**
     * Add one predator, loose and patrolling on a corridor tile, at the end of
     * the roster, with its mind and its travel running. It hunts, senses, chases
     * and makes contact from there exactly as one released from the den does,
     * and it carries no release time, because the staggered schedule runs on the
     * roster a maze is laid out with.
     */
    addPredator(kind, tx, ty) {
      if (!PREDATOR_KINDS.includes(kind)) {
        invalid(
          `a predator kind is one of ${PREDATOR_KINDS.join(", ")}, got ${kind}`,
        );
      }
      requireCorridor(tx, ty);
      const p = new Predator(kind, tx, ty, 0);
      restPredator(p);
      p.state = "wander";
      p.released = true;
      p.facing = "up";
      state.predators.push(p);
    },

    /**
     * Move one predator to a tile's center and leave it there. Its facing, its
     * `state`, its `released` flag, its mind and its travel are untouched.
     */
    setPredatorTile(index, tx, ty) {
      const p = predatorAt(index);
      requirePredatorTile(tx, ty);
      p.placeOn(tx, ty);
    },

    /** Set one predator's facing. */
    setPredatorDir(index, dir) {
      const p = predatorAt(index);
      p.facing = requireDir(dir);
      p.dir = null;
    },

    /**
     * Pose one predator's `state`, where it already stands. It moves the
     * predator nowhere and leaves its `released` flag as it stands. After the
     * call its own mind runs whenever the simulation advances: it senses,
     * acquires, chases and searches through the real code.
     */
    setPredatorState(index, value) {
      const p = predatorAt(index);
      if (!POSABLE_STATES.includes(value)) {
        invalid(
          `a posed predator state is one of ${POSABLE_STATES.join(", ")}, got ${value}`,
        );
      }
      const inDen =
        state.maze.isDen(p.col, p.row) || state.maze.isGate(p.col, p.row);
      if (value === "den" && !inDen) {
        invalid(
          `predator ${index} stands on (${p.col}, ${p.row}), which is not a den tile or the den gate`,
        );
      }
      if (value !== "den" && !state.maze.isCorridor(p.col, p.row)) {
        invalid(
          `predator ${index} stands on (${p.col}, ${p.row}), which is not an open corridor tile`,
        );
      }
      restPredator(p);
      p.state = value;
      // A chase opens on a fix on the forager's tile, at the speed a fresh
      // acquisition opens at and with the ordinary linger ahead of it.
      if (value === "chase") {
        p.fix = state.forager.tile;
        p.linger = LINGER_TIME;
        p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
      }
    },

    /**
     * Set one predator's `released` flag, which says whether its turn in the
     * staggered schedule has come. It moves the predator nowhere and changes its
     * `state` not at all.
     */
    setPredatorReleased(index, released) {
      predatorAt(index).released = Boolean(released);
    },

    /**
     * Turn one predator's own mind on or off. With it off that predator senses
     * nothing and decides nothing, keeping the facing, the `state` and the fix
     * it was posed with; nothing is decided, so nothing is carried out and it
     * holds exactly where it stands. Every other predator, and everything else
     * in the game, carries on untouched.
     */
    setPredatorMind(index, enabled) {
      const p = predatorAt(index);
      p.mind = Boolean(enabled);
      if (!p.mind) p.dir = null;
    },

    /**
     * Turn one predator's travel on or off. With it off its body holds the tile
     * it stands on whatever its mind decides, while that mind runs untouched: it
     * senses, takes and lapses a fix, fires its alert, changes its `state` and
     * reports the speed that `state` carries. Every other predator, and
     * everything else in the game, carries on untouched.
     */
    setPredatorTravel(index, enabled) {
      const p = predatorAt(index);
      p.travel = Boolean(enabled);
      if (!p.travel) p.dir = null;
    },

    /**
     * Add one bonus drifter at the end of the list, which then wanders through
     * the ordinary drifter code and is worth the ordinary bonus when eaten. It
     * is added whatever the cadence is doing and whatever the ceiling would
     * otherwise allow.
     */
    spawnDrifter(tx, ty) {
      requireCorridor(tx, ty);
      state.drifters.push(new Drifter(tx, ty, DRIFTER_SPEED));
    },

    /**
     * Take every bonus drifter off the maze at once. None of them is eaten, so
     * nothing is scored, and the cadence tops the maze back up on its own
     * schedule from there.
     */
    clearDrifters() {
      state.drifters = [];
    },

    /**
     * Turn one drifter's own mind on or off. With it off that drifter decides
     * nothing, so nothing is carried out and it holds exactly where it stands.
     * It is still drawn, still eaten and still worth the ordinary bonus.
     */
    setDrifterMind(index, enabled) {
      const d = drifterAt(index);
      d.mind = Boolean(enabled);
      if (!d.mind) d.dir = null;
    },

    /**
     * Turn one drifter's travel on or off. With it off its body holds the tile
     * it stands on whatever its wander decides. It is still drawn, still eaten
     * and still worth the ordinary bonus.
     */
    setDrifterTravel(index, enabled) {
      const d = drifterAt(index);
      d.travel = Boolean(enabled);
      if (!d.travel) d.dir = null;
    },

    /**
     * Set the seconds left on the bonus-drifter cadence. It runs down from
     * there and admits at `0` exactly as one the game armed itself does; the
     * call admits nothing (`specs/instrumentation.md`).
     */
    setDrifterIn(seconds) {
      const left = requireSeconds("a drifter cadence", seconds);
      if (left > DRIFTER_INTERVAL) {
        invalid(
          `a drifter cadence must lie in [0, ${DRIFTER_INTERVAL}], got ${seconds}`,
        );
      }
      state.drifterTimer = left;
    },

    /** Set the seconds left on the sonar pulse's cooldown. */
    setSonarCooldown(seconds) {
      state.sonarCooldown = requireSeconds("a sonar cooldown", seconds);
    },

    /** Set the seconds left on ink's cooldown. */
    setInkCooldown(seconds) {
      state.inkCooldown = requireSeconds("an ink cooldown", seconds);
    },
  };
}

/**
 * Install the surface on `window.__fathom` and return the function that removes
 * it again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: FathomState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[FATHOM_HANDLE] = api;
  return () => {
    if (target[FATHOM_HANDLE] === api) delete target[FATHOM_HANDLE];
  };
}
