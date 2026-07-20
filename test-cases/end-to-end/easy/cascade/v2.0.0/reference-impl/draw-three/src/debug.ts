// Cascade — the debugging and automation API installed on window.__cascade.
//
// A thin surface over the exact game the mouse drives: it seeds and steps the
// real deterministic core and reads the real state, and its control and input
// operations route through the same code normal play uses, so a scenario driven
// from code behaves identically to one played by hand. It only sets up
// situations and steps the real systems forward; it never fabricates an outcome.
// See specs/instrumentation.md.

import type {
  AutoMoveSource,
  BoardState,
  CascadeSnapshot,
  Game,
  MoveSource,
  MoveTarget,
} from "./game";

export interface CascadeDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  newGame(): void;
  step(seconds: number): void;
  snapshot(): CascadeSnapshot;
  setAutoStep(enabled: boolean): void;
  setBoard(state: BoardState): void;
  turnStock(): void;
  move(source: MoveSource, target: MoveTarget): boolean;
  autoMove(source: AutoMoveSource): boolean;
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(x: number, y: number): void;
  click(x: number, y: number): void;
  doubleClick(x: number, y: number): void;
}

export function installDebugApi(game: Game): void {
  const api: CascadeDebugApi = {
    version: 1,

    // ---- Core operations --------------------------------------------------

    reset(options) {
      game.debugReset(options?.seed);
    },

    newGame() {
      game.newGame();
    },

    // Advance the victory cascade by `seconds` of game time, in whole fixed
    // steps, without waiting on real frames. A no-op off the won screen.
    step(seconds) {
      game.autoStep = false;
      game.stepCascadeExact(seconds);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    // The manual clock: true lets the game advance the cascade in real time,
    // false returns to manual stepping.
    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
    },

    // ---- Control operations (route through the real systems) --------------

    setBoard(state) {
      game.debugSetBoard(state);
    },

    turnStock() {
      game.debugTurnStock();
    },

    move(source, target) {
      return game.debugMove(source, target);
    },

    autoMove(source) {
      return game.debugAutoMove(source);
    },

    // ---- Input operations (through the real pointer handlers) -------------

    pointerDown(x, y) {
      game.pressAt(x, y);
    },

    pointerMove(x, y) {
      game.moveTo(x, y);
    },

    pointerUp(x, y) {
      game.releaseAt(x, y);
    },

    // A convenience tap: press and release at the same point.
    click(x, y) {
      game.pressAt(x, y);
      game.releaseAt(x, y);
    },

    doubleClick(x, y) {
      game.doubleClickAt(x, y);
    },
  };

  (window as unknown as { __cascade?: CascadeDebugApi }).__cascade = api;
}
