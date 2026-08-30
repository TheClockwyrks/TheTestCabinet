// Shatter — the scaffolding the build's own tests are written against.
//
// Not part of the game: nothing under `src/` imports this except a `*.test.ts`.
// It exists so a test can drive the real game over its own clock, in process,
// with no browser and no canvas — which is exactly what `specs/simulation.md`'s
// render-free core makes possible, and what `specs/instrumentation.md` requires
// of a build.
//
// The two stand-ins mirror what the runtime hands the game: a keyboard that
// answers held and edge reads and discards an unconsumed edge at the end of each
// tick, and an audio bus that records what it was asked to play instead of making
// a sound.

import { game } from "./game";
import type { UpdateApi } from "./runtime";
import type { ShatterState } from "./types";

/** A keyboard, as a test holds and taps it. */
export class TestInput {
  private readonly downNow = new Set<string>();
  private readonly edges = new Set<string>();

  /** Hold an action down until it is released. Arms an edge on the way down. */
  hold(action: string): void {
    if (!this.downNow.has(action)) this.edges.add(action);
    this.downNow.add(action);
  }

  /** Let an action up. */
  release(action: string): void {
    this.downNow.delete(action);
  }

  /** Tap an action: one edge, with nothing held afterwards. */
  tap(action: string): void {
    this.edges.add(action);
  }

  /** Whether the action is held, as the runtime reports it. */
  value(action: string): number {
    return this.downNow.has(action) ? 1 : 0;
  }

  /** Whether the action went down since the last tick. Consumes the edge. */
  pressed(action: string): boolean {
    if (!this.edges.has(action)) return false;
    this.edges.delete(action);
    return true;
  }

  /** Discard every edge nothing consumed, as the runtime does each frame. */
  endFrame(): void {
    this.edges.clear();
  }
}

/** An audio bus that writes down what it was asked for. */
export class TestAudio {
  /** Every one-shot cue played, in order, across every tick. */
  readonly played: string[] = [];
  /** Which held cues are sounding. */
  readonly holding = new Map<string, boolean>();
  private mutedFlag = false;

  play(cue: string): void {
    this.played.push(cue);
  }

  setHeld(cue: string, sounding: boolean): void {
    this.holding.set(cue, sounding);
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
  }

  muted(): boolean {
    return this.mutedFlag;
  }
}

/** The game, its state, and the two stand-ins driving it. */
export interface Driven {
  state: ShatterState;
  input: TestInput;
  audio: TestAudio;
  api: UpdateApi;
  /** Run `ticks` whole ticks, discarding unconsumed edges after each one. */
  advance(ticks: number): void;
}

/**
 * A game at its title values, ready to be driven a tick at a time.
 *
 * The state comes from the game's own `initialize`, so a test exercises the same
 * registration, the same cues and the same starting state a browser would.
 */
export function drive(): Driven {
  const input = new TestInput();
  const audio = new TestAudio();
  const api: UpdateApi = {
    input: {
      value: (name) => input.value(name),
      pressed: (name) => input.pressed(name),
    },
    audio: {
      play: (cue) => audio.play(cue),
      setHeld: (cue, sounding) => audio.setHeld(cue, sounding),
      setMuted: (muted) => audio.setMuted(muted),
      muted: () => audio.muted(),
    },
  };
  const state = game.initialize({
    input: { register: () => undefined },
    audio: { define: () => undefined },
    diagnostics: { register: () => undefined },
  });
  return {
    state,
    input,
    audio,
    api,
    advance(ticks: number): void {
      for (let i = 0; i < ticks; i += 1) {
        game.tick(state, api);
        input.endFrame();
      }
    },
  };
}

/**
 * A quiet field being played: no rocks, no shots, no saucer, neither of the
 * game's own spawners running, and the ship's lethal contact test off.
 *
 * The same arrangement a validator poses before it arranges its own scenario, so
 * nothing the test did not ask for arrives, spawns or costs a life.
 */
export function quietField(driven: Driven): void {
  const state = driven.state;
  state.screen = "playing";
  state.menuIndex = 0;
  state.score = 0;
  state.wave = 1;
  state.waveBanner = 0;
  state.waitingToSpawn = false;
  state.rocks = [];
  state.bullets = [];
  state.enemyBullets = [];
  state.torpedoes = [];
  state.saucer = null;
  state.waveSpawning = false;
  state.saucerSpawning = false;
  state.ship.collision = false;
  state.ship.invuln = 0;
  state.ship.fireCooldown = 0;
  state.torpedoCharge = 1;
}

/** A clock stand-in for the debug surface, with no runtime behind it. */
export class TestClock {
  stepping = true;
  /** Every tick count `advance` was asked for. */
  readonly advances: number[] = [];

  autoStep(): boolean {
    return this.stepping;
  }

  setAutoStep(enabled: boolean): void {
    this.stepping = enabled;
  }

  advance(ticks: number): void {
    this.advances.push(ticks);
  }
}
