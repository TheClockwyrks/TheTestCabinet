// Coil — the state machine wrapped around the round simulation (specs/flow.md "Game states").
//
// Six states — title, howto, playing, paused, gameover, cleared — each with its own screen
// and menu. The Game owns the current `Sim`, the persistent BEST (localStorage `coil.best`,
// the only thing saved between sessions), the highlighted menu index, and the keyboard
// routing (edge input drained once per frame). It advances the simulation only while
// `playing`, keeps BEST live the instant the score passes it, and transitions to gameover /
// cleared when a round ends.
//
// The manual clock (specs/instrumentation.md): `autoStep` is true in normal play, so the
// loop advances the sim from the wall clock. `reset()` and `step()` switch it off, so the
// loop only renders and `step()` is the sole thing that advances the sim — a scripted
// scenario then runs exactly the ticks it asks for, reproducible regardless of machine load.

import { BEST_KEY, TICK_DT } from "./constants";
import type { Audio } from "./audio";
import {
  codeToDir,
  isBack,
  isConfirm,
  isMenuDown,
  isMenuUp,
  type Input,
} from "./input";
import { menuItems } from "./menus";
import { Sim, seededRng } from "./sim";
import type { Cell, Dir, EndReason, Rng } from "./sim";
import type { Mode } from "./mode";

export type State = "title" | "howto" | "playing" | "paused" | "gameover" | "cleared";

// A per-tick event, surfaced to the loop so it can play audio and trigger the head-bite.
export interface TickEvents {
  ate: boolean;
  comboRose: boolean;
  died: boolean;
}

// The JSON-serializable read of the full observable state, shared by the debug API's
// snapshot() and the debug overlay (specs/instrumentation.md).
export interface CoilSnapshot {
  version: number;
  screen: State;
  mode: "classic" | "maze";
  score: number;
  best: number;
  combo: number;
  comboWindow: number;
  comboFraction: number;
  muted: boolean;
  ticks: number;
  simTime: number;
  dir: Dir;
  snake: Cell[];
  length: number;
  pellet: Cell | null;
  obstacles: Cell[];
  menuIndex: number;
  ended: boolean;
  endReason: EndReason | null;
}

export class Game {
  readonly mode: Mode;
  readonly audio: Audio;
  readonly input: Input;
  state: State = "title";
  menuIndex = 0;
  sim: Sim;
  best: number;

  // The manual clock: true in normal play (the loop advances the sim from the wall clock),
  // false once reset()/step() take over so only step() advances it. Never touched by the
  // control or input operations.
  autoStep = true;
  // When on, render.ts draws the read-only debug overlay. Toggled with backtick; off by
  // default; never affects gameplay.
  debugOverlay = false;
  // The seed for pellet placement, set by reset({seed}); undefined ⇒ Math.random.
  private seed: number | undefined;

  constructor(mode: Mode, audio: Audio, input: Input) {
    this.mode = mode;
    this.audio = audio;
    this.input = input;
    this.best = this.loadBest();
    this.sim = new Sim(mode, this.makeRng());
    // Resume the AudioContext on the first key (browsers block autoplay before a gesture).
    this.input.onFirstPress(() => void this.audio.resume());
  }

  private makeRng(): Rng {
    return this.seed === undefined ? Math.random : seededRng(this.seed);
  }

  private loadBest(): number {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      const n = raw === null ? 0 : parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private saveBest(): void {
    try {
      localStorage.setItem(BEST_KEY, String(this.best));
    } catch {
      /* storage unavailable — BEST just won't persist this session. */
    }
  }

  // Begin a round in THIS build's mode from the title / menu (the CLASSIC or MAZE entry).
  start(): void {
    this.sim = new Sim(this.mode, this.makeRng());
    this.state = "playing";
    this.menuIndex = 0;
  }

  toHowto(): void {
    this.state = "howto";
    this.menuIndex = 0;
  }

  toMenu(): void {
    this.state = "title";
    this.menuIndex = 0;
  }

  pause(): void {
    if (this.state === "playing") {
      this.state = "paused";
      this.menuIndex = 0;
    }
  }

  resume(): void {
    if (this.state === "paused") this.state = "playing";
  }

  restart(): void {
    this.start();
  }

  requestTurn(dir: Dir): void {
    if (this.state === "playing") this.sim.requestTurn(dir);
  }

  // ---- Edge input (drained once per frame; the same path injected keys take) --------
  //
  // Both the real keyboard (via Input) and the debug API's keyDown/press feed codes into the
  // same queue, so injected input exercises the actual bindings (specs/interface.md).

  handleInput(): void {
    for (const code of this.input.drain()) {
      if (code === "Backquote") {
        this.debugOverlay = !this.debugOverlay;
        continue;
      }
      if (code === "KeyM") {
        this.audio.toggleMute();
        continue;
      }
      if (this.state === "playing") {
        const dir = codeToDir(code);
        if (dir) {
          this.sim.requestTurn(dir);
          continue;
        }
        if (isBack(code) || code === "KeyP") this.pause();
        continue;
      }
      this.routeMenu(code);
    }
  }

  private routeMenu(code: string): void {
    const items = menuItems(this.state, this);
    if (items.length === 0) return;
    if (isMenuUp(code)) {
      this.menuIndex = (this.menuIndex - 1 + items.length) % items.length;
    } else if (isMenuDown(code)) {
      this.menuIndex = (this.menuIndex + 1) % items.length;
    } else if (isConfirm(code)) {
      const item = items[this.menuIndex];
      if (item) this.activate(item.action);
    } else if (isBack(code)) {
      if (this.state === "howto") this.toMenu();
      else if (this.state === "paused") this.resume();
      else if (this.state === "gameover" || this.state === "cleared") this.toMenu();
    }
  }

  private activate(action: string): void {
    switch (action) {
      case "start":
        this.start();
        break;
      case "howto":
        this.toHowto();
        break;
      case "menu":
        this.toMenu();
        break;
      case "resume":
        this.resume();
        break;
      case "restart":
        this.restart();
        break;
    }
  }

  // Advance one fixed tick and fold the result back into the state machine. Returns the
  // tick's events (or null if no tick ran) so the loop can drive audio and the bite anim.
  private advance(): TickEvents | null {
    if (this.state !== "playing") return null;
    this.sim.tick(TICK_DT);
    if (this.sim.score > this.best) {
      this.best = this.sim.score;
      this.saveBest();
    }
    const events: TickEvents = {
      ate: this.sim.ateThisTick,
      comboRose: this.sim.comboRoseThisTick,
      died: this.sim.diedThisTick,
    };
    if (this.sim.ended) {
      this.state = this.sim.endReason === "cleared" ? "cleared" : "gameover";
      this.menuIndex = 0;
    }
    return events;
  }

  // The loop's automatic tick (respects `autoStep`, so a driver that took over via step() is
  // not double-advanced by the wall-clock loop).
  autoTick(): TickEvents | null {
    if (!this.autoStep) return null;
    return this.advance();
  }

  // ---- Debug / automation surface (see debug.ts; inert in normal play) --------------

  // Return to the title and switch to manual stepping; `options.seed` seeds pellet placement
  // so a run replays identically. The keyboard resumes control until a control op takes over.
  reset(options?: { seed?: number }): void {
    this.seed = options?.seed;
    this.sim = new Sim(this.mode, this.makeRng());
    this.state = "title";
    this.menuIndex = 0;
    this.autoStep = false;
  }

  // Take over the clock and advance exactly n whole ticks synchronously (only a live round
  // advances). Events are dropped; a headless capture drives audio / animation itself.
  step(ticks: number): void {
    this.autoStep = false;
    for (let i = 0; i < ticks; i++) this.advance();
  }

  setAutoStep(enabled: boolean): void {
    this.autoStep = enabled;
  }

  // Control operations — preconditions routed through the real Sim (specs/instrumentation.md).
  debugSetSnake(cells: Cell[], dir: Dir): void {
    this.sim.setSnake(cells, dir);
  }

  debugSetPellet(cell: Cell): void {
    this.sim.setPellet(cell);
  }

  debugSetCombo(multiplier: number, windowSeconds: number): void {
    this.sim.setCombo(multiplier, windowSeconds);
  }

  // Set the current score directly as a precondition. BEST is left to resolve through real
  // play — a following eat pushes the score up and advance() carries it into BEST live.
  debugSetScore(points: number): void {
    this.sim.setScore(points);
  }

  // A pure read of the full observable state (shape per specs/instrumentation.md).
  debugSnapshot(): CoilSnapshot {
    const s = this.sim;
    return {
      version: 1,
      screen: this.state,
      mode: this.mode === "maze" ? "maze" : "classic",
      score: s.score,
      best: this.best,
      combo: s.combo,
      comboWindow: s.comboWindow,
      comboFraction: s.comboFraction(),
      muted: this.audio.muted,
      ticks: s.ticks,
      simTime: s.simTime,
      dir: s.dir,
      snake: s.snake.map((c) => ({ col: c.col, row: c.row })),
      length: s.snake.length,
      pellet: s.pellet ? { col: s.pellet.col, row: s.pellet.row } : null,
      obstacles: s.obstacles.map((o) => ({ col: o.col, row: o.row })),
      menuIndex: this.menuIndex,
      ended: s.ended,
      endReason: s.endReason,
    };
  }
}
