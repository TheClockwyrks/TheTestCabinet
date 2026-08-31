// Kessler — the screens wrapped around the simulation (specs/screens.md).
//
// The six screens, the menus, the tick accumulator, and the routing of one
// action to what that action does on the screen the game is on. Only
// `playing` advances the simulation; `waveclear` advances its 180-tick
// interstitial and nothing else; the other four freeze everything. The game
// also owns the session lifecycle — a fresh session on START, the discard on
// QUIT — the seeded pod stream, the two driver switches, and the snapshot
// every build reports (`specs/instrumentation.md`).
//
// Nothing here reads the wall clock. Who feeds `update` — the frame loop or
// the debug surface's `step` — is the runtime's business, and the game
// behaves the same either way.

import {
  DEFAULT_SEED,
  INTERSTITIAL_TICKS,
  PAUSE_MENU,
  TICK_DT,
  TITLE_MENU,
  type Action,
  type Cue,
  type ParticleSystem,
  type ScreenName,
} from "./constants";
import { mulberry32, type Rng } from "./rng";
import { launchParkedBall, tickPlaying, type TickIo } from "./sim";
import { pointAt } from "./polar";
import {
  bootSession,
  clearVolatiles,
  layOutWave,
  parkFreshBall,
  piercingNow,
  spanOf,
  type Session,
} from "./state";

/**
 * What the game asks of the layers around it: a cue played on its event and
 * a particle system spawned at a stage point. Structural on purpose — the
 * runtime hands in Web Audio and the particle player, and a test hands in a
 * recorder.
 */
export interface GameHooks {
  /** Play a one-shot cue now. */
  cue(cue: Cue): void;
  /** Spawn a particle system instance at a stage point now. */
  particle(system: ParticleSystem, x: number, y: number): void;
}

const SILENT: GameHooks = {
  cue: () => undefined,
  particle: () => undefined,
};

/** The snapshot `specs/instrumentation.md` fixes, as a plain object. */
export interface Snapshot {
  screen: ScreenName;
  ticks: number;
  wave: number;
  score: number;
  lives: number;
  autoStep: boolean;
  waveAdvance: boolean;
  podSpawn: boolean;
  paddle: { angleDeg: number; spanDeg: number };
  balls: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    parked: boolean;
    piercing: boolean;
  }[];
  rings: {
    angleDeg: number;
    speedDegPerSec: number;
    targets: { slot: number; hp: number }[];
  }[];
  pods: { kind: string; x: number; y: number }[];
  effects: {
    widenTicks: number;
    narrowTicks: number;
    pierceTicks: number;
    shieldActive: boolean;
  };
  menu: { index: number };
}

/**
 * The slack the accumulator allows a tick boundary. A second delivered as
 * sixty updates of a sixtieth each sums to a hair under a second in binary
 * floating point, and it must resolve the same sixty ticks a second
 * delivered whole does. Far smaller than any interval a caller can mean.
 */
const TICK_EPSILON = 1e-9;

export class Game {
  /** The screen the game is on; a build opens on the title. */
  screen: ScreenName = "title";
  /** The highlighted menu entry; `0` on a screen with no menu. */
  menuIndex = 0;
  /** Ticks resolved since the last reset. */
  ticks = 0;
  /**
   * Ticks of *simulation* time resolved since the last reset — the ticks the
   * `playing` screen advanced on. The ball sprite's spin runs on this clock
   * (`specs/assets.md`), so it holds exactly where a pause left it while
   * `ticks` keeps counting the frozen screens' resolved ticks.
   */
  simTicks = 0;
  /** The session in play, or the boot layout behind the title screen. */
  session: Session = bootSession();
  /** The `waveAdvance` driver switch; on when the game is played. */
  waveAdvance = true;
  /** The `podSpawn` driver switch; on when the game is played. */
  podSpawn = true;
  /**
   * Whether the frame loop advances the simulation from the wall clock. The
   * game reports it; honoring it is the runtime's frame loop.
   */
  autoStep = true;
  /** The rotation actions' held values, sampled by each tick. */
  readonly held = { left: false, right: false };

  /** The seed the pod stream reseeds from at each session start. */
  private seed = DEFAULT_SEED;
  /** The session's pod stream; pod draws alone consume it. */
  private rng: Rng = mulberry32(DEFAULT_SEED);
  /** Ticks left on the wave-clear interstitial while on `waveclear`. */
  private interstitialTicks = 0;
  /** Unconsumed game time carried between updates, in seconds. */
  private accumulated = 0;
  private readonly hooks: GameHooks;

  constructor(hooks: GameHooks = SILENT) {
    this.hooks = hooks;
  }

  // --- Time ---

  /**
   * Consumes `dtSeconds` of game time into whole ticks, carrying the
   * remainder, so a second of game time is sixty ticks however it was
   * divided into frames.
   */
  update(dtSeconds: number): void {
    this.accumulated += dtSeconds;
    while (this.accumulated >= TICK_DT - TICK_EPSILON) {
      this.accumulated -= TICK_DT;
      this.tick();
    }
  }

  /** Resolves one whole tick of the screen the game is on. */
  tick(): void {
    this.ticks += 1;
    if (this.screen === "playing") {
      this.simTicks += 1;
      const outcome = tickPlaying(this.session, this.tickIo());
      if (outcome.clearedWave !== null) {
        this.screen = "waveclear";
        this.menuIndex = 0;
        this.interstitialTicks = INTERSTITIAL_TICKS;
      } else if (outcome.gameOver) {
        this.screen = "gameover";
        this.menuIndex = 0;
        this.hooks.cue("game-over");
      }
    } else if (this.screen === "waveclear") {
      this.interstitialTicks -= 1;
      if (this.interstitialTicks <= 0) {
        this.beginNextWave();
      }
    }
  }

  private tickIo(): TickIo {
    return {
      held: this.held,
      rng: this.rng,
      podSpawn: this.podSpawn,
      waveAdvance: this.waveAdvance,
      tickIndex: this.simTicks,
      cue: (cue) => this.hooks.cue(cue),
      particle: (system, x, y) => this.hooks.particle(system, x, y),
    };
  }

  /**
   * The interstitial's lapse: every slot refills, ring angles reset, the
   * wave number rises by one with the new wave's figures in force, a ball
   * parks, and play resumes (`specs/rings.md`).
   */
  private beginNextWave(): void {
    layOutWave(this.session, this.session.wave + 1);
    parkFreshBall(this.session, this.simTicks);
    this.enter("playing");
  }

  // --- Actions (specs/controls.md routes them; specs/screens.md answers) ---

  /** One press edge of `action`, routed to the screen the game is on. */
  handleAction(action: Action): void {
    switch (this.screen) {
      case "title":
        this.menuAction(action, TITLE_MENU.length, (index) => {
          if (index === 0) this.startFreshSession();
          else this.enter("howto");
        });
        break;
      case "howto":
        if (action === "confirm" || action === "back") this.enter("title");
        break;
      case "playing":
        if (action === "launch") launchParkedBall(this.session);
        else if (action === "back" || action === "pause") this.enter("paused");
        break;
      case "waveclear":
        break;
      case "paused":
        if (action === "back" || action === "pause") {
          this.enter("playing");
          break;
        }
        this.menuAction(action, PAUSE_MENU.length, (index) => {
          if (index === 0) this.enter("playing");
          else this.discardSession();
        });
        break;
      case "gameover":
        if (action === "confirm") this.discardSession();
        break;
    }
  }

  /** The shared menu behavior: wrap-around movement and confirm. */
  private menuAction(
    action: Action,
    entries: number,
    accept: (index: number) => void,
  ): void {
    if (action === "up" || action === "down") {
      const delta = action === "down" ? 1 : -1;
      this.menuIndex = (this.menuIndex + delta + entries) % entries;
      this.hooks.cue("menu-move");
    } else if (action === "confirm") {
      this.hooks.cue("menu-select");
      accept(this.menuIndex);
    }
  }

  /** Enters `screen` with its top menu entry highlighted. */
  private enter(screen: ScreenName): void {
    this.screen = screen;
    this.menuIndex = 0;
  }

  // --- The session lifecycle ---

  /**
   * Starts a fresh session exactly as confirming START does: the boot layout
   * with a ball parked on the deflector, the pod stream reseeded from the
   * session's seed, and the game on `playing`.
   */
  startFreshSession(): void {
    this.session = bootSession();
    this.rng = mulberry32(this.seed);
    parkFreshBall(this.session, this.simTicks);
    this.enter("playing");
  }

  /** Discards the session exactly as QUIT does and returns to the title. */
  discardSession(): void {
    this.session = bootSession();
    this.enter("title");
  }

  /**
   * Restores the boot state (`specs/instrumentation.md`): the title screen
   * over the boot layout, zero ticks, both driver switches on, and the pod
   * stream seeded with `seed`. Whether the simulation advances on its own
   * each frame is untouched.
   */
  reset(seed: number = DEFAULT_SEED): void {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.session = bootSession();
    this.screen = "title";
    this.menuIndex = 0;
    this.ticks = 0;
    this.simTicks = 0;
    this.waveAdvance = true;
    this.podSpawn = true;
    this.interstitialTicks = 0;
    this.accumulated = 0;
    this.held.left = false;
    this.held.right = false;
  }

  /**
   * Enters the wave-clear interstitial as the clearing event enters it:
   * balls, pods, timed effects, and the shield are removed and a fresh
   * interstitial begins for the wave the counter holds.
   */
  enterWaveclear(): void {
    this.session.balls = [];
    clearVolatiles(this.session);
    this.interstitialTicks = INTERSTITIAL_TICKS;
    this.enter("waveclear");
  }

  /**
   * Enters a screen exactly as the real transition into it does, with the
   * entering menu highlighting its top entry and no cue sounding
   * (`specs/instrumentation.md`'s `setScreen` table).
   */
  poseScreen(name: ScreenName): void {
    switch (name) {
      case "playing":
        this.startFreshSession();
        break;
      case "waveclear":
        this.enterWaveclear();
        break;
      case "title":
        this.discardSession();
        break;
      default:
        this.enter(name);
        break;
    }
  }

  // --- The snapshot (specs/instrumentation.md) ---

  /** A pure read of the state, in the fixed shape. */
  snapshot(): Snapshot {
    const session = this.session;
    const piercing = piercingNow(session);
    return {
      screen: this.screen,
      ticks: this.ticks,
      wave: session.wave,
      score: session.score,
      lives: session.lives,
      autoStep: this.autoStep,
      waveAdvance: this.waveAdvance,
      podSpawn: this.podSpawn,
      paddle: { angleDeg: session.paddleAngleDeg, spanDeg: spanOf(session) },
      balls: session.balls.map((ball) => ({
        x: ball.x,
        y: ball.y,
        vx: ball.vx,
        vy: ball.vy,
        parked: ball.parked,
        piercing,
      })),
      rings: session.rings.map((ring) => ({
        angleDeg: ring.angleDeg,
        speedDegPerSec: ring.speedDegPerSec,
        targets: ring.targets.flatMap((hp, slot) =>
          hp === null ? [] : [{ slot, hp }],
        ),
      })),
      pods: session.pods.map((pod) => {
        const at = pointAt(pod.r, pod.angleDeg);
        return { kind: pod.kind, x: at.x, y: at.y };
      }),
      effects: {
        widenTicks: session.effects.widenTicks,
        narrowTicks: session.effects.narrowTicks,
        pierceTicks: session.effects.pierceTicks,
        shieldActive: session.effects.shieldActive,
      },
      menu: { index: this.menuIndex },
    };
  }
}
