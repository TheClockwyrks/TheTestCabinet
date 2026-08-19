// Carom — the debugging and automation surface.
//
// Two halves, and the split is the point of building on an engine.
//
// `window.__carom` carries only what is about THIS GAME: returning to the title,
// reading the state, and the control operations that pose a scenario in Carom's own
// world — a match, a serve, a score, a paddle, a ball, the AI. Every one of them
// routes through the same systems normal play uses, so a scenario driven from code
// behaves exactly like one played by hand; they set up situations and never
// fabricate an outcome. See specs/instrumentation.md.
//
// Everything that is about DRIVING A BROWSER GAME rather than about Carom belongs
// to the engine and is deliberately absent here: there is no `step` or
// `setAutoStep` (the engine's host interface owns the clock and can run exact
// frames off a schedule), no `keyDown`, `keyUp` or `press` (the engine's host drives
// the registered actions directly, so nothing has to synthesize a keystroke), and no
// overlay drawing or toggle (the engine draws the panel and owns the backtick key).
// The game's part in the overlay is `registerDiagnostics` below: naming the values
// worth watching.

import type { CaromSnapshot, Game } from "./game";
import type { Mode, Side } from "./types";
import type { Engine } from "@test-cabinet/simple-2d";

interface BallState {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  spin?: number;
}

export interface CaromDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): CaromSnapshot;
  startMatch(mode: Mode): void;
  serve(): void;
  setScore(p1: number, p2: number): void;
  setPaddle(side: Side, state: { cy?: number; vy?: number }): void;
  setBall(index: number, state: BallState): void;
  setAiControl(enabled: boolean): void;
}

export function installDebugApi(game: Game): void {
  const api: CaromDebugApi = {
    version: 1,

    // Return to the title, handing the paddles back to the player and (in Solo) the
    // AI. It does not touch the clock: who advances time is the engine's business,
    // and a driver that wants the game off real time says so through the engine's
    // host interface rather than through the game.
    reset(options) {
      // The base variant has no randomness, so the seed is accepted and has no
      // effect; a variant with a seeded generator reseeds it here.
      void options?.seed;
      game.debugReset();
    },

    snapshot() {
      return game.debugSnapshot();
    },

    startMatch(mode) {
      game.debugStartMatch(mode);
    },

    serve() {
      game.debugServe();
    },

    setScore(p1, p2) {
      game.debugSetScore(p1, p2);
    },

    setPaddle(side, state) {
      game.debugSetPaddle(side, state?.cy, state?.vy);
    },

    setBall(index, state) {
      game.debugSetBall(index, state ?? {});
    },

    // Hand the right paddle back to the computer opponent within a driven Solo
    // scenario, so the frames that follow run the real AI against a posed ball. See
    // specs/instrumentation.md.
    setAiControl(enabled) {
      game.debugSetAiControl(Boolean(enabled));
    },
  };

  (window as unknown as { __carom?: CaromDebugApi }).__carom = api;
}

/**
 * Name the values the engine's debug overlay shows.
 *
 * A source is evaluated on every read, so each one below is a pure read of live
 * state — watching the overlay can never change what the simulation does. They are
 * formatted to a line each because that is how the panel draws them, and they
 * report the same facts `snapshot()` does (specs/instrumentation.md), so what is on
 * screen and what a driver reads can never disagree.
 */
export function registerDiagnostics(engine: Engine, game: Game): void {
  const d = engine.diagnostics;
  const round = (v: number): string => v.toFixed(0);

  d.register("screen", () => game.state);
  d.register("mode", () => game.mode);
  d.register("score", () =>
    game.winner
      ? `${game.scoreP1} - ${game.scoreP2}  winner ${game.winner}`
      : `${game.scoreP1} - ${game.scoreP2}`,
  );
  d.register("simTime", () => `${game.simTime.toFixed(2)}s`);
  d.register(
    "padL",
    () => `cy ${round(game.left.cy)}  vy ${round(game.left.vy)}`,
  );
  d.register(
    "padR",
    () => `cy ${round(game.right.cy)}  vy ${round(game.right.vy)}`,
  );
  d.register(
    "ballPos",
    () =>
      `x ${round(game.ball.x)}  y ${round(game.ball.y)}` +
      (game.state === "countdown" ? "  held" : ""),
  );
  d.register(
    "ballVel",
    () =>
      `vx ${round(game.ball.vx)}  vy ${round(game.ball.vy)}  ` +
      `spd ${round(game.ball.speed)}`,
  );
  d.register("ballSpin", () => round(game.ball.spin));
  d.register("muted", () => game.muted);
}
