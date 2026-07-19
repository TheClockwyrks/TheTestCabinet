// Carom — the debugging and automation API installed on window.__carom.
//
// A thin surface over the exact game the UI drives: it advances the real
// fixed-timestep simulation (game.fixedStep) and reads the real state
// (game.debugSnapshot), so a scenario driven from code behaves identically to one
// played by hand. It only sets up situations and steps the real systems forward;
// it never fabricates an outcome. See specs/instrumentation.md.

import { FIXED_STEP } from "./constants";
import type { CaromSnapshot, Game } from "./game";
import type { Mode, Side } from "./types";

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
  step(seconds: number): void;
  setAutoStep(enabled: boolean): void;
  snapshot(): CaromSnapshot;
  startMatch(mode: Mode): void;
  serve(): void;
  setScore(p1: number, p2: number): void;
  setPaddle(side: Side, state: { cy?: number; vy?: number }): void;
  setBall(index: number, state: BallState): void;
  setAiControl(enabled: boolean): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

export function installDebugApi(game: Game): void {
  const api: CaromDebugApi = {
    version: 1,

    // Return to the title. This also switches the game to manual stepping (the
    // animation loop stops advancing the sim from the wall clock), so from here
    // step() is the only thing that moves the simulation and a scripted scenario
    // is exact.
    reset(options) {
      // The base variant has no randomness, so the seed is accepted and has no
      // effect; a variant with a seeded generator reseeds it here.
      void options?.seed;
      game.debugReset();
      game.autoStep = false;
    },

    // Advance the real simulation by `seconds`, in whole fixed steps, without
    // waiting on real time. Stepping also switches the game to manual clocking, so
    // the animation loop no longer advances the sim on its own and this step is
    // the exact amount of time that passes — no stray wall-clock frames.
    step(seconds) {
      game.autoStep = false;
      const steps = Math.max(0, Math.round(seconds / FIXED_STEP));
      for (let i = 0; i < steps; i++) game.fixedStep(FIXED_STEP);
    },

    // Hand the clock back to (or take it from) the animation loop.
    // setAutoStep(true) lets the game advance itself in real time again — useful
    // for watching a scenario play out or recording a live motion clip;
    // setAutoStep(false) returns to manual stepping via step(). reset() and step()
    // also switch to manual. It never changes any game state, only which clock
    // drives it.
    setAutoStep(enabled) {
      game.autoStep = Boolean(enabled);
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
    // scenario, so stepping runs the real AI against a posed ball. See
    // specs/instrumentation.md.
    setAiControl(enabled) {
      game.debugSetAiControl(Boolean(enabled));
    },

    // Inject keyboard input through the very same path the real keyboard feeds
    // (a dispatched KeyboardEvent the Input listener catches), so held movement
    // and edge actions behave exactly as a player's keypress would. Unlike the
    // control operations above, this does NOT take paddle control away from
    // normal play — a held movement key moves its paddle through the game's own
    // update — so a caller can confirm the controls themselves work.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      // Apply any one-shot action (menu move, confirm, pause, mute) at once, so a
      // caller need not wait for a render frame to see it take effect.
      game.handleInput();
    },

    keyUp(code) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __carom?: CaromDebugApi }).__carom = api;
}
