// Kessler — the screens wrapped around the simulation (specs/screens.md).
//
// The six screens, the menus, the tick accumulator, and the routing of one
// action to what that action does on the screen the game is on. Only
// `playing` advances the simulation; `waveclear` advances its 180-tick
// interstitial and nothing else; the other four freeze everything. The game
// also owns the session lifecycle — a fresh session on START, the discard on
// QUIT — the pod draw's random source and posed outcome, the two driver
// switches, and the snapshot every build reports (`specs/instrumentation.md`).
//
// Nothing here reads the wall clock. Who feeds `update` — the frame loop or
// the debug surface's `step` — is the runtime's business, and the game
// behaves the same either way.

import {
  INTERSTITIAL_TICKS,
  PAUSE_MENU,
  TICK_DT,
  TITLE_MENU,
  type Action,
  type Cue,
  type ParticleSystem,
  type PodKind,
  type ScreenName,
} from "./constants";
import type { PointerMove } from "./input";
import {
  menuEntries,
  menuEntryAt,
  menuItemRect,
  menuItemRects,
  TITLE_HOWTO_ENTRY,
  type MenuItemRect,
} from "./menus";
import {
  launchParkedBall,
  rollPod,
  tickPlaying,
  type PodPose,
  type Rng,
  type TickIo,
} from "./sim";
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
  interstitialTicks: number;
  autoStep: boolean;
  waveAdvance: boolean;
  podSpawn: boolean;
  nextPod: PodPose;
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

  /** The outcome `setNextPod` posed for the next pod draw, or `null`. */
  nextPod: PodPose = null;
  /** Ticks left on the wave-clear interstitial while on `waveclear`. */
  interstitialTicks = 0;
  /** The random source the pod draws read. */
  private readonly rng: Rng = Math.random;
  /**
   * The menu entry a pointer press is down inside, and the screen it went
   * down on. A release inside the same entry of the same screen accepts it
   * (`specs/controls.md`); anything else clears the latch and accepts
   * nothing. It is derived from the contact alone, so any pose leaves it
   * consistent: a pose that changes the screen leaves a press that can no
   * longer match.
   */
  private pointerPress: { screen: ScreenName; entry: number } | null = null;
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
        this.interstitialTicks = INTERSTITIAL_TICKS;
        this.enter("waveclear");
      } else if (outcome.gameOver) {
        this.enter("gameover");
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
      takePosedPod: () => {
        const posed = this.nextPod;
        this.nextPod = null;
        return posed;
      },
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
        this.menuAction(action, TITLE_MENU.length);
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
        this.menuAction(action, PAUSE_MENU.length);
        break;
      case "gameover":
        if (action === "confirm") this.discardSession();
        break;
    }
  }

  /** The shared menu behavior: wrap-around movement and confirm. */
  private menuAction(action: Action, entries: number): void {
    if (action === "up" || action === "down") {
      const delta = action === "down" ? 1 : -1;
      this.menuIndex = (this.menuIndex + delta + entries) % entries;
      this.hooks.cue("menu-move");
    } else if (action === "confirm") {
      this.acceptHighlighted();
    }
  }

  /**
   * Accepts the highlighted entry of the menu the game is standing on, which
   * is what `confirm` does and what a pointer press and release inside an
   * entry's region does (`specs/screens.md`, `specs/controls.md`).
   */
  private acceptHighlighted(): void {
    const index = this.menuIndex;
    if (this.screen === "title") {
      this.hooks.cue("menu-select");
      if (index === 0) this.startFreshSession();
      else this.enter("howto");
      return;
    }
    if (this.screen === "paused") {
      this.hooks.cue("menu-select");
      if (index === 0) this.enter("playing");
      else this.discardSession();
    }
  }

  /**
   * One pointer sample, routed to the menu the game is standing on. A pointer
   * over an entry's region highlights it; a press latches the entry it went
   * down inside; and a release inside that same entry accepts it. A release
   * anywhere else, and every sample on a screen with no menu, accepts
   * nothing (`specs/controls.md`).
   */
  handlePointer(sample: PointerMove): void {
    if (menuItemRects(this.screen) === null) {
      this.pointerPress = null;
      return;
    }
    const over = menuEntryAt(this.screen, sample.x, sample.y);
    if (over !== null && over !== this.menuIndex) {
      this.menuIndex = over;
      this.hooks.cue("menu-move");
    }
    if (sample.type === "down") {
      this.pointerPress =
        over === null ? null : { screen: this.screen, entry: over };
      return;
    }
    if (sample.type === "up") {
      const press = this.pointerPress;
      this.pointerPress = null;
      if (
        press !== null &&
        press.screen === this.screen &&
        press.entry === over
      ) {
        this.menuIndex = press.entry;
        this.acceptHighlighted();
      }
    }
  }

  /**
   * Where the build drew menu entry `index` on the current screen, or `null`
   * on a screen with no menu and past the menu's entries. A pure read.
   */
  menuItemRect(index: number): MenuItemRect | null {
    return menuItemRect(this.screen, index);
  }

  /**
   * Poses the highlight on entry `n` of the current screen's menu, exactly
   * where `up` and `down` would leave it, silently. A screen carrying no menu
   * has no entry to highlight, so the call fails loudly there rather than
   * passing quietly (`specs/instrumentation.md`).
   */
  poseMenuIndex(n: number): void {
    const entries = menuEntries(this.screen);
    if (entries === null) {
      throw new Error(
        `setMenuIndex: ${this.screen} carries no menu, so it has no entry to highlight`,
      );
    }
    if (!Number.isInteger(n) || n < 0 || n >= entries.length) {
      throw new Error(
        `setMenuIndex n must be 0 to ${entries.length - 1}; got ${String(n)}`,
      );
    }
    this.menuIndex = n;
  }

  /**
   * Enters `screen` from the one the game is on, highlighting the entry
   * `specs/screens.md` fixes for that arrival: the entry that led away from
   * the screen being entered to the screen just left, and entry `0`
   * otherwise. Only `title` entered from `howto` is anything but `0`.
   */
  private enter(screen: ScreenName): void {
    const from = this.screen;
    this.screen = screen;
    this.menuIndex =
      screen === "title" && from === "howto" ? TITLE_HOWTO_ENTRY : 0;
  }

  // --- The session lifecycle ---

  /**
   * Starts a fresh session exactly as confirming START does: the boot layout
   * with a ball parked on the deflector, and the game on `playing`.
   */
  startFreshSession(): void {
    this.session = bootSession();
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
   * over the boot layout, zero ticks, both driver switches on, and no posed
   * pod outcome. Whether the simulation advances on its own each frame is
   * untouched.
   */
  reset(): void {
    this.nextPod = null;
    this.session = bootSession();
    this.screen = "title";
    this.menuIndex = 0;
    this.ticks = 0;
    this.simTicks = 0;
    this.waveAdvance = true;
    this.podSpawn = true;
    this.interstitialTicks = 0;
    this.accumulated = 0;
    this.pointerPress = null;
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
   * Sets the screen and changes nothing else (`specs/instrumentation.md`'s
   * `setScreen`): the score, the lives, the wave, the deflector, the balls,
   * the rings, the pods, the timed effects, the shield, the interstitial
   * timer, the menu highlight, and both driver switches all stand exactly as
   * they stood, and no cue sounds. A caller that wants a screen arranged the
   * way the real transition into it arranges it makes the calls that arrange
   * it.
   */
  poseScreen(name: ScreenName): void {
    this.screen = name;
  }

  /**
   * One pod draw alone (`specs/instrumentation.md`'s `drawPod`): the random
   * outcome a destruction would draw, with nothing spawned and the posed
   * outcome left where it stands.
   */
  drawPod(): PodKind | null {
    return rollPod(this.rng);
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
      interstitialTicks: this.interstitialTicks,
      autoStep: this.autoStep,
      waveAdvance: this.waveAdvance,
      podSpawn: this.podSpawn,
      nextPod: this.nextPod,
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
