// Coil — the state machine wrapped around the round simulation (specs/flow.md "Game states").
//
// Six states — title, howto, playing, paused, gameover, cleared — each with its own screen
// and menu. The Game owns the current `Sim`, the persistent BEST (localStorage `coil.best`,
// the only thing saved between sessions), and the highlighted menu index. It advances the
// simulation only while `playing`, keeps BEST live the instant the score passes it, and
// transitions to gameover / cleared when a round ends.
//
// Ticking is normally driven by the loop's 125 ms timer (`auto` true). The headless test
// harness drives ticks itself through `window.__coil.step(n)`, which flips `auto` off so the
// harness fully owns the clock and one call advances exactly the ticks it asks for.

import { BEST_KEY, TICK_DT } from "./constants";
import type { Mode } from "./mode";
import { Sim } from "./sim";
import type { Dir } from "./sim";

export type State = "title" | "howto" | "playing" | "paused" | "gameover" | "cleared";

// A per-tick event, surfaced to the loop so it can play audio and trigger the head-bite.
export interface TickEvents {
  ate: boolean;
  comboRose: boolean;
  died: boolean;
}

export class Game {
  readonly mode: Mode;
  state: State = "title";
  menuIndex = 0;
  sim: Sim;
  best: number;
  auto = true; // false once the test harness takes over via step()

  constructor(mode: Mode) {
    this.mode = mode;
    this.best = this.loadBest();
    this.sim = new Sim(mode);
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
    this.sim = new Sim(this.mode);
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

  // The loop's automatic tick (respects `auto`, so a test that took over via step() is not
  // double-advanced by the RAF timer).
  autoTick(): TickEvents | null {
    if (!this.auto) return null;
    return this.advance();
  }

  // The headless test hook (window.__coil.step): take over the clock and advance exactly n
  // ticks synchronously. Events are dropped (headless capture drives audio/anim itself).
  step(n = 1): void {
    this.auto = false;
    for (let i = 0; i < n; i++) this.advance();
  }
}
