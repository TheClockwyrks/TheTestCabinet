// Coil — the screens wrapped around the round simulation (specs/ui.md).
//
// Six screens, the session's best score, the highlighted menu item, and the routing
// of one action to what that action does on the screen the game is on. It owns the
// tick accumulator as well: `update(dt)` consumes elapsed game time into whole ticks
// and carries the remainder, so a second of game time is eight ticks whether it
// arrived in one update or in sixty, and drawing advances nothing.
//
// Nothing here reads the wall clock. Who feeds `update` — the frame loop or the
// debug surface's `advance` — is the runtime's business, and the game behaves the
// same either way.

import {
  BITE_SECONDS,
  CUES,
  TICK_SECONDS,
  type Cue,
  type Dir,
} from "./constants";
import { menuItemAt, menuItems } from "./menus";
import { Sim } from "./sim";

/** The screen the game is on. */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "gameover"
  | "cleared";

/** Every screen, in the order `specs/ui.md` lists them. */
export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "gameover",
  "cleared",
];

/** The one action a press raises, as `specs/controls.md` names them. */
export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "pause"
  | "mute";

/**
 * What the game asks of the audio layer.
 *
 * Structural on purpose: the game names a cue and asks for the mute bit, and how a
 * sound is made, unlocked or silenced is the runtime's. A test hands it a recorder.
 */
export interface AudioBus {
  /** Whether sound is currently muted. */
  readonly muted: boolean;
  /** Play a one-shot cue now, once. */
  play(cue: Cue): void;
  /** Start the looping cue, if it is not already looping. */
  startLoop(cue: Cue): void;
  /** Stop the looping cue. */
  stopLoop(cue: Cue): void;
  /** Flip the mute bit. */
  toggleMute(): void;
}

/**
 * The slack the accumulator allows a tick boundary.
 *
 * A second delivered as sixty updates of a sixtieth each sums to a hair under a
 * second in binary floating point, and the specification requires it to resolve the
 * same eight ticks a second delivered in one update does. Comparing against the
 * boundary less this tolerance is what makes the two agree. It is far smaller than
 * any interval a caller can mean, so it never lets an early tick through.
 */
const TICK_EPSILON = 1e-9;

const STEER: Partial<Record<Action, Dir>> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};

export class Game {
  /** The screen the game is on; a build opens on the title. */
  screen: Screen = "title";
  /** The highlighted item of the current screen's menu, counted from 0. */
  menuIndex = 0;
  /** The title menu's remembered selection, which the title opens on. */
  titleIndex = 0;
  /** The highest score reached in this session. */
  best = 0;
  /** Ticks resolved since the last reset. */
  ticks = 0;
  /** Simulation time accumulated on the playing screen since the last reset. */
  simTime = 0;
  /** The runtime's mute bit, mirrored into the state every update. */
  muted = false;
  /** The round. */
  readonly sim: Sim;

  private readonly audio: AudioBus;
  private accumulator = 0;
  private biteRemaining = 0;
  /**
   * The item a live pointer press landed on, or `null` while none is down.
   *
   * `specs/ui.md` takes both edges of a confirm inside one region, so the press
   * has to be remembered until the release that answers it.
   */
  private pressedItem: number | null = null;

  constructor(audio: AudioBus) {
    this.audio = audio;
    this.sim = new Sim();
    this.muted = audio.muted;
  }

  /**
   * Consume `dt` seconds of game time.
   *
   * Ticks resolve on the playing screen alone, one for each whole `TICK_SECONDS`
   * the accumulator holds, and the remainder carries into the next update.
   *
   * A tick that ENDS the round is the last tick of that round, and the time the
   * update was still carrying past it is spent rather than banked
   * (`specs/movement.md`). Held back, it would be waiting the moment a game was
   * put back on `playing` and would march the chain several cells on the first
   * update after that.
   */
  update(dt: number): void {
    if (this.screen === "playing") {
      this.simTime += dt;
      this.accumulator += dt;
      while (this.accumulator >= TICK_SECONDS - TICK_EPSILON) {
        this.accumulator -= TICK_SECONDS;
        if (this.resolveTick()) {
          this.accumulator = 0;
          break;
        }
      }
    }
    // The bite runs on the ROUND'S own time (`specs/assets.md`), so it holds the
    // frame it is on behind a pause and on every menu screen, and carries on from
    // there when the round resumes.
    if (this.screen === "playing" && this.biteRemaining > 0) {
      this.biteRemaining = Math.max(0, this.biteRemaining - dt);
    }
    // The best rises the instant the live score passes it, during play rather than
    // at the end of a round, and a best posed below the live score is raised back.
    if (this.sim.score > this.best) this.best = this.sim.score;
    this.muted = this.audio.muted;
  }

  /**
   * The head's sprite frame: 0 at rest, and 1 to 3 through the bite the eat began.
   *
   * The remainder is compared against a tolerance rather than zero, because a caller
   * that delivers `BITE_SECONDS` in sixty updates leaves a float dust behind that a
   * caller delivering it in one does not, and the two must agree.
   */
  biteFrame(): number {
    if (this.biteRemaining <= 1e-6) return 0;
    const spent = BITE_SECONDS - this.biteRemaining;
    return 1 + Math.min(2, Math.floor((spent / BITE_SECONDS) * 3));
  }

  /** Return the whole session to its opening values. */
  reset(): void {
    this.audio.stopLoop(CUES.music);
    this.sim.restore();
    this.screen = "title";
    this.menuIndex = 0;
    this.titleIndex = 0;
    this.pressedItem = null;
    this.best = 0;
    this.ticks = 0;
    this.simTime = 0;
    this.accumulator = 0;
    this.biteRemaining = 0;
    this.muted = this.audio.muted;
  }

  /**
   * Begin a round: the board as `specs/board.md` lays it, and the music under it.
   *
   * The bed is STOPPED before it is started, so a fresh round always begins with
   * a fresh bed. `RESTART` from the pause menu reaches here with the previous
   * round's bed still looping — the pause never ended that round — and
   * `specs/ui.md` sounds `music` when "a round begins", which this is.
   */
  startRound(): void {
    this.sim.layRound();
    this.screen = "playing";
    this.menuIndex = 0;
    this.accumulator = 0;
    this.biteRemaining = 0;
    this.audio.stopLoop(CUES.music);
    this.audio.startLoop(CUES.music);
  }

  /**
   * Move to `screen` and highlight the item it opens on.
   *
   * The title opens on its remembered selection, so leaving how-to-play lands
   * back on the entry that opened it and a round left for the title lands back
   * on the entry that started it (`specs/ui.md`). Every other screen opens on
   * its first item.
   */
  goTo(screen: Screen): void {
    if (screen !== "playing" && screen !== "paused") {
      this.audio.stopLoop(CUES.music);
    }
    this.screen = screen;
    this.menuIndex = screen === "title" ? this.titleIndex : 0;
  }

  /** Set the screen alone, leaving the highlight and the board as they stand. */
  setScreen(screen: Screen): void {
    this.screen = screen;
  }

  /**
   * Route one pointer or touch edge over the current screen's menu
   * (`specs/ui.md`).
   *
   * `x` and `y` are the logical stage units the menus are laid out in. A move,
   * and a contact landing, select the item they are over; a press and the
   * release that answers it confirm the item when both fell inside the one
   * region, so a press slid off its entry confirms nothing. The `playing` screen
   * shows no menu, so nothing there is read.
   */
  handlePointer(kind: "move" | "down" | "up", x: number, y: number): void {
    if (this.screen === "playing") {
      this.pressedItem = null;
      return;
    }
    const item = menuItemAt(this.screen, x, y);
    if (item !== null) this.menuIndex = item;
    if (kind === "down") {
      this.pressedItem = item;
      return;
    }
    if (kind !== "up") return;
    const pressed = this.pressedItem;
    this.pressedItem = null;
    if (item !== null && item === pressed) this.accept();
  }

  /** Route one press edge to what it does on the screen the game is on. */
  handleAction(action: Action): void {
    if (action === "mute") {
      this.audio.toggleMute();
      this.muted = this.audio.muted;
      return;
    }
    if (this.screen === "playing") {
      const dir = STEER[action];
      if (dir) {
        this.sim.requestTurn(dir);
        return;
      }
      if (action === "back" || action === "pause") this.goTo("paused");
      return;
    }
    this.routeMenu(action);
  }

  private routeMenu(action: Action): void {
    const items = menuItems(this.screen);
    switch (action) {
      case "up":
        if (items.length > 0) {
          this.menuIndex = (this.menuIndex - 1 + items.length) % items.length;
        }
        return;
      case "down":
        if (items.length > 0) {
          this.menuIndex = (this.menuIndex + 1) % items.length;
        }
        return;
      case "confirm":
        this.accept();
        return;
      case "back":
        this.leave();
        return;
      case "pause":
        if (this.screen === "paused") this.goTo("playing");
        return;
      default:
        return;
    }
  }

  /**
   * Accept the highlighted item of the current screen's menu.
   *
   * Keyed by the item's index rather than by its label, so the title's first item
   * starts a round whatever the mode names it.
   */
  private accept(): void {
    const index = this.menuIndex;
    // The title remembers what was confirmed on it, whichever input confirmed it.
    if (this.screen === "title") this.titleIndex = index;
    switch (this.screen) {
      case "title":
        if (index === 0) this.startRound();
        else this.goTo("howto");
        return;
      case "howto":
        this.goTo("title");
        return;
      case "paused":
        if (index === 0) this.goTo("playing");
        else if (index === 1) this.startRound();
        else this.goTo("title");
        return;
      case "gameover":
      case "cleared":
        if (index === 0) this.startRound();
        else this.goTo("title");
        return;
      default:
        return;
    }
  }

  /** Leave the current screen for the one it was reached from. */
  private leave(): void {
    switch (this.screen) {
      case "howto":
      case "gameover":
      case "cleared":
        this.goTo("title");
        return;
      case "paused":
        this.goTo("playing");
        return;
      default:
        return;
    }
  }

  /** Resolve one tick, play its cues, and report whether it ended the round. */
  private resolveTick(): boolean {
    const { events, ended } = this.sim.tick();
    this.ticks += 1;
    if (this.sim.score > this.best) this.best = this.sim.score;
    if (events.ate) {
      this.audio.play(CUES.eat);
      this.biteRemaining = BITE_SECONDS;
    }
    if (events.comboRose) this.audio.play(CUES.comboUp);
    if (events.died) this.audio.play(CUES.death);
    if (ended !== null) {
      this.goTo(ended === "cleared" ? "cleared" : "gameover");
      return true;
    }
    return false;
  }
}
