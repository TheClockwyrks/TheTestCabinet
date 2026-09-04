// Wick — the game over its state: the screens, the menus, the frame's update,
// and the cues a frame plays (specs/ui.md, specs/controls.md
// "The pointer", specs/instrumentation.md "A deterministic core").
//
// The simulation itself is `src/sim/`; this is the layer that decides which
// screen ticks, which actions each screen answers, what the pointer does with
// the rectangles `src/layout.ts` fixes, how a frame's delta time becomes
// ticks, and which cues sound. It reads nothing from the renderer.

import {
  almanacEntries,
  clampScroll,
  followHighlight,
  wrapTab,
} from "./almanac";
import {
  CUES,
  DEFAULT_SEED,
  END_ITEMS,
  PAUSE_ITEMS,
  TICK_DT,
  TICK_EPSILON,
  TITLE_ITEMS,
  WHEEL_ROW,
  type Action,
  type Cue,
  type Screen,
} from "./constants";
import type { PointerFrame } from "./input";
import { itemAt, tabAt } from "./layout";
import { Rng, seedState } from "./rng";
import { freshRun, idleRun, initialState, type WickState } from "./state";
import {
  NOTHING_HELD,
  makeTickContext,
  type Held,
  type TickContext,
} from "./sim/context";
import { acceptOffer, openLevelUp } from "./sim/progression";
import { tick } from "./sim/tick";

/** The actions each screen answers as press edges. */
export const SCREEN_ACTIONS: Readonly<Record<Screen, readonly Action[]>> = {
  title: ["up", "down", "confirm", "mute"],
  howto: ["back", "mute"],
  almanac: ["up", "down", "left", "right", "back", "mute"],
  playing: ["pause", "back", "mute"],
  levelup: ["up", "down", "confirm", "mute"],
  chest: ["confirm", "mute"],
  paused: ["up", "down", "confirm", "pause", "back", "mute"],
  fallen: ["up", "down", "confirm", "back", "mute"],
  dawn: ["up", "down", "confirm", "back", "mute"],
};

/** The screens the music loops on. */
const MUSIC_SCREENS: readonly Screen[] = [
  "playing",
  "levelup",
  "chest",
  "paused",
];

export interface GameHooks {
  /** Toggle the runtime's mute bit. */
  toggleMute(): void;
  /** Read the runtime's mute bit. */
  isMuted(): boolean;
}

export class Game {
  state: WickState;
  /** Whether the frame loop feeds the wall clock into the accumulator. */
  autoStep = true;
  /** The movement actions as the current frame read them. */
  held: Held = { ...NOTHING_HELD };
  readonly rng: Rng;
  private readonly cues = new Set<Cue>();
  private readonly hooks: GameHooks;

  constructor(hooks: GameHooks, seed: number = DEFAULT_SEED) {
    this.hooks = hooks;
    this.state = initialState(seedState(seed));
    // The generator reads and writes whichever state the game holds.
    this.rng = new Rng(() => this.state);
  }

  get screen(): Screen {
    return this.state.screen;
  }

  /** The cues raised since the last drain, in the order they arose. */
  drainCues(): Cue[] {
    const out = [...this.cues];
    this.cues.clear();
    return out;
  }

  /** Forget the cues raised since the last drain; a pose sounds nothing. */
  discardCues(): void {
    this.cues.clear();
  }

  /** The looping cues the state calls for on this frame. */
  wantedLoops(): Set<Cue> {
    const wanted = new Set<Cue>();
    const { screen, run } = this.state;
    if (MUSIC_SCREENS.includes(screen)) wanted.add(CUES.music);
    if (
      screen === "playing" &&
      run.weapons.some(
        (weapon) => weapon.id === "halo" || weapon.id === "corona",
      )
    ) {
      wanted.add(CUES.hum);
    }
    return wanted;
  }

  /** Mirror the runtime's mute bit into the state. */
  mirrorMuted(): void {
    this.state.muted = this.hooks.isMuted();
  }

  /**
   * Restore every declared field to its title-screen value, seeding the
   * generator with `seed`. `muted` and `autoStep` stay as they are.
   */
  reset(seed: number = DEFAULT_SEED): void {
    const muted = this.state.muted;
    this.state = initialState(seedState(seed));
    this.state.muted = muted;
    this.cues.clear();
  }

  // ---- Transitions ---------------------------------------------------------

  /**
   * Enter `screen` with every menu index at `0`: the highlight, the almanac's
   * tab, and its first visible row, which stand at `0` on every other screen.
   */
  private enter(screen: Screen): void {
    this.state.screen = screen;
    this.state.menuIndex = 0;
    this.state.almanacTab = 0;
    this.state.almanacScroll = 0;
  }

  /** Begin a fresh run and enter `playing`. */
  startRun(): void {
    this.state.run = freshRun();
    this.enter("playing");
    this.state.accumulator = 0;
  }

  /** Discard the run and return to `title`. */
  toTitle(): void {
    this.state.run = idleRun();
    this.enter("title");
    this.state.accumulator = 0;
  }

  /** Discard the run and enter `howto`. */
  toHowto(): void {
    this.state.run = idleRun();
    this.enter("howto");
    this.state.accumulator = 0;
  }

  /** Discard the run and open the almanac at its first tab and entry. */
  toAlmanac(): void {
    this.state.run = idleRun();
    this.enter("almanac");
    this.state.accumulator = 0;
  }

  /** From `playing`, hold the world under `paused`. */
  pause(): void {
    if (this.state.screen !== "playing") return;
    this.enter("paused");
    this.state.accumulator = 0;
  }

  /** From `paused`, return to `playing`; the run is untouched. */
  resume(): void {
    if (this.state.screen !== "paused") return;
    this.enter("playing");
  }

  /** From `chest`, close the overlay. */
  closeChest(): void {
    if (this.state.screen !== "chest") return;
    this.state.run.chestResult = null;
    this.enter("playing");
  }

  /** From a run screen, end the run as `ending` does, the run kept. */
  endRun(ending: "fallen" | "dawn"): void {
    this.enter(ending);
    this.state.accumulator = 0;
    this.cues.add(ending === "fallen" ? CUES.fallen : CUES.dawn);
  }

  /** From `playing` with a level-up queued, open the overlay. */
  openLevelUp(): boolean {
    if (this.state.screen !== "playing") return false;
    if (this.state.run.pendingLevelUps < 1) return false;
    openLevelUp(this.state, this.rng, this.cues);
    this.state.accumulator = 0;
    return true;
  }

  /** On `levelup`, accept the offer at `index`. */
  choose(index: number): boolean {
    if (this.state.screen !== "levelup") return false;
    if (!Number.isInteger(index)) return false;
    if (index < 0 || index >= this.state.run.offers.length) return false;
    acceptOffer(this.context(), index);
    return true;
  }

  private context(): TickContext {
    return makeTickContext(this.state, this.rng, this.held, this.cues);
  }

  // ---- Menus ---------------------------------------------------------------

  /** How many items the current screen's menu holds. */
  menuLength(): number {
    switch (this.state.screen) {
      case "title":
        return TITLE_ITEMS.length;
      case "almanac":
        return almanacEntries(this.state.almanacTab).length;
      case "levelup":
        return this.state.run.offers.length;
      case "paused":
        return PAUSE_ITEMS.length;
      case "fallen":
      case "dawn":
        return END_ITEMS.length;
      default:
        return 0;
    }
  }

  /**
   * Put the highlight on `index` and sound `menu-move`. On `almanac` the
   * list's window follows the highlight, as `specs/ui.md` states.
   */
  private setHighlight(index: number): void {
    const { state } = this;
    state.menuIndex = index;
    if (state.screen === "almanac") {
      state.almanacScroll = followHighlight(
        state.almanacScroll,
        index,
        almanacEntries(state.almanacTab).length,
      );
    }
    this.cues.add(CUES.menuMove);
  }

  private moveHighlight(delta: number): void {
    const length = this.menuLength();
    if (length === 0) return;
    this.setHighlight((this.state.menuIndex + delta + length) % length);
  }

  /** Show the tab at `index`, from its first entry, as `right` reaching it does. */
  private selectTab(index: number): void {
    const { state } = this;
    if (state.almanacTab === index) return;
    state.almanacTab = index;
    state.menuIndex = 0;
    state.almanacScroll = 0;
    this.cues.add(CUES.menuMove);
  }

  private moveTab(delta: number): void {
    this.selectTab(wrapTab(this.state.almanacTab, delta));
  }

  /** Answer one press edge on the current screen. */
  handleAction(action: Action): void {
    const { state } = this;
    if (!SCREEN_ACTIONS[state.screen].includes(action)) return;
    if (action === "mute") {
      this.hooks.toggleMute();
      return;
    }
    switch (state.screen) {
      case "title":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") {
          this.cues.add(CUES.menuConfirm);
          if (state.menuIndex === 0) this.startRun();
          else if (state.menuIndex === 1) this.toAlmanac();
          else this.toHowto();
        }
        break;
      case "howto":
        if (action === "back") this.toTitle();
        break;
      case "almanac":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "left") this.moveTab(-1);
        else if (action === "right") this.moveTab(1);
        else if (action === "back") this.toTitle();
        break;
      case "playing":
        if (action === "pause" || action === "back") this.pause();
        break;
      case "levelup":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") this.choose(state.menuIndex);
        break;
      case "chest":
        if (action === "confirm") this.closeChest();
        break;
      case "paused":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") {
          this.cues.add(CUES.menuConfirm);
          if (state.menuIndex === 0) this.resume();
          else this.toTitle();
        } else if (action === "pause" || action === "back") this.resume();
        break;
      case "fallen":
      case "dawn":
        if (action === "up") this.moveHighlight(-1);
        else if (action === "down") this.moveHighlight(1);
        else if (action === "confirm") {
          this.cues.add(CUES.menuConfirm);
          if (state.menuIndex === 0) this.startRun();
          else this.toTitle();
        } else if (action === "back") this.toTitle();
        break;
    }
  }

  // ---- The pointer ---------------------------------------------------------

  /**
   * Answer the pointer as this frame read it, after the frame's press edges:
   * the hover moves the highlight, a primary press takes what it lands in,
   * and the wheel scrolls the almanac's list.
   */
  handlePointer(pointer: PointerFrame): void {
    if (pointer.at !== null) this.hover(pointer.at.x, pointer.at.y);
    for (const press of pointer.presses) this.click(press.x, press.y);
    this.scroll(pointer.wheel);
  }

  /** The pointer inside an item's box highlights it; inside none, nothing. */
  private hover(x: number, y: number): void {
    const index = itemAt(this.state, x, y);
    if (index === null || index === this.state.menuIndex) return;
    this.setHighlight(index);
  }

  /** A primary press highlights what it lands in and then takes it. */
  private click(x: number, y: number): void {
    const { state } = this;
    const tab = tabAt(state, x, y);
    if (tab !== null) {
      this.selectTab(tab);
      return;
    }
    const index = itemAt(state, x, y);
    if (index === null) return;
    if (index !== state.menuIndex) this.setHighlight(index);
    // Taking the item is exactly what `confirm` on it does, which on an
    // almanac entry, the one menu that answers no `confirm`, is nothing.
    this.handleAction("confirm");
  }

  /** A frame's wheel travel, in stage units, moves the almanac's window. */
  private scroll(travel: number): void {
    const { state } = this;
    if (state.screen !== "almanac") return;
    const rows = Math.trunc(travel / WHEEL_ROW);
    if (rows === 0) return;
    state.almanacScroll = clampScroll(
      state.almanacScroll + rows,
      almanacEntries(state.almanacTab).length,
    );
  }

  // ---- The clock -----------------------------------------------------------

  /**
   * One whole tick, on `playing` alone, with the frame's held movement. A
   * tick that leaves `playing` discards the accumulator.
   */
  tickOnce(): void {
    if (this.state.screen !== "playing") return;
    tick(this.state, this.rng, this.held, this.cues);
    if (this.state.screen !== "playing") this.state.accumulator = 0;
  }

  /**
   * Feed `dt` seconds of frame time to the accumulator and consume every
   * whole tick in it. The remainder waits, and is discarded by a tick that
   * leaves `playing`. Off `playing` nothing accumulates.
   */
  update(dt: number): void {
    const { state } = this;
    if (state.screen !== "playing") {
      state.accumulator = 0;
      return;
    }
    state.accumulator += dt;
    while (state.accumulator >= TICK_DT - TICK_EPSILON) {
      state.accumulator -= TICK_DT;
      this.tickOnce();
      if (state.screen !== "playing") {
        state.accumulator = 0;
        return;
      }
    }
    if (state.accumulator < 0) state.accumulator = 0;
  }
}
