// Orrery — the session: the transitions the screens, the editor, and the run
// are moved by (specs/state.md, specs/ui.md, specs/controls.md,
// specs/simulation.md).
//
// Every menu is worked from the keyboard AND from the pointer, and a finger
// reaches the game as a pointer on the same three readings
// (specs/controls.md), so the menus need no touch path of their own. A pointer
// and a touch contact drive them DIRECTLY rather than through an action
// (specs/ui.md "Pointer and touch"): `driveMenu` moves the highlight and takes
// the item, and what taking it does is exactly what `confirm` does on that
// screen, because both call the same take.
//
// A `Session` is a DRAFT of the game's state with every transition Orrery has
// hung off it. The engine holds the state by value, so a frame and a pose both
// work the same way: clone the current state into a draft, stand a session on
// it, run one transition, and hand the draft back as the next state
// (`src/game.ts`). `update` is the only thing that advances a draft from time,
// `handleAction` and `handlePointer` are the only things that advance it from
// input, and the debug surface of specs/instrumentation.md poses it through
// exactly the transitions below — so a scenario driven from code and a session
// played by hand run down one path.
//
// Cues are asked for, not played. A transition that raises one leaves it in
// the outbox of `src/outbox.ts`, and the frame plays what it finds there, once
// per cue however often it was asked for (specs/ui.md "Audio"). That is what
// lets a pose sound nothing at the call and still let the edit it committed
// sound on the next frame advanced. The produced particle effects of
// specs/assets.md travel the same way.

import { challengeCount, challengesOf } from "./challenges";
import { CUES, HOWTO_PAGES, SPEEDS, TITLE_ITEMS } from "./constants";
import {
  applyEditorAction,
  applyPointerFocus,
  applyPointerSample,
} from "./editor";
import {
  DRAG_ACTIONS,
  type Action,
  type ActionContext,
  type Cue,
  type ParticleSystemName,
} from "./figures";
import { cloneChallenge } from "./formats";
import type { PointerSample } from "./input";
import type { StagePoint } from "./motion";
import { clearOutbox, raiseCue, raiseEffect } from "./outbox";
import {
  enterable,
  machineReady,
  menuItemAt,
  menuOf,
  solvedItems,
  type Menu,
} from "./progress";
import type { MenuKind } from "./regions";
import {
  advanceRun,
  machineSnapshot,
  startRun,
  stepOneCycle,
  stopRun,
  type RunHost,
} from "./sim";
import {
  createState,
  emptyEditor,
  lastOf,
  resetState,
  setLastOf,
  stashMachine,
  stashedMachine,
} from "./state";
import type {
  Challenge,
  Mode,
  OrreryState,
  PartState,
  Screen,
  W,
} from "./types";

/** The one call a transition makes back into the engine's audio bus. */
export interface SessionIo {
  /** Toggle the engine's mute bit, which the `mute` action does. */
  toggleMuted(): void;
}

/** An io that does nothing, for a session stood up outside a frame. */
export const SILENT_IO: SessionIo = { toggleMuted: () => {} };

export class Session implements RunHost {
  /** The draft this session is building: the next state, under construction. */
  readonly state: W<OrreryState>;

  private readonly io: SessionIo;

  constructor(
    state: W<OrreryState> = createState(),
    io: SessionIo = SILENT_IO,
  ) {
    this.state = state;
    this.io = io;
  }

  /** Ask for a cue. The next frame plays it, once however often it is asked. */
  cue(cue: Cue): void {
    raiseCue(cue);
  }

  /**
   * Ask for one produced particle effect at a stage position. The next frame
   * takes it; nothing is played at the call, so a run driven from code raises
   * them and simply leaves them to be drained.
   */
  effect(system: ParticleSystemName, at: StagePoint): void {
    raiseEffect(system, at);
  }

  /**
   * One frame of game time. `simTime` accumulates `dt` whatever the screen,
   * and the run advances while it is `running`. The mute bit is mirrored in by
   * `src/game.ts`, which is the only place that can read the engine's.
   */
  update(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const { state } = this;
    state.simTime += step;
    if (state.screen === "editor" && state.sim?.status === "running") {
      advanceRun(this, step);
    }
  }

  // -------------------------------------------------------------------------
  // Screens and transitions
  // -------------------------------------------------------------------------

  /** Which set of actions the game answers right now (specs/controls.md). */
  actionContext(): ActionContext {
    const { state } = this;
    if (state.screen !== "editor") return state.screen;
    const status = state.sim?.status;
    if (status === undefined) return "editor-editing";
    if (status === "running" || status === "paused") return "editor-running";
    return "editor-halted";
  }

  /**
   * Enter a screen exactly as the real transition into it enters it
   * (specs/instrumentation.md `setScreen`). Leaving the editor stops a live
   * run, stashes the open challenge's machine, and closes the challenge.
   */
  enterScreen(name: Screen): void {
    const { state } = this;
    // A press armed on the menu this screen replaces is aimed at a menu that
    // is no longer shown, so it takes nothing wherever its release lands.
    state.menuPress = null;
    if (name === "editor") {
      if (state.challenge === null) {
        throw new Error("setScreen: no challenge is open");
      }
      state.screen = "editor";
      state.howtoPage = 0;
      return;
    }
    if (state.screen === "editor") this.leaveEditor(true);
    state.screen = name;
    switch (name) {
      case "title":
        // The remembered title selection: a return lands on the entry that led
        // away, and `titleIndex` is `0` until a title item is first taken, so
        // the first frame of the session opens on the first item (specs/ui.md
        // "The remembered title selection").
        state.menuIndex = state.titleIndex;
        state.howtoPage = 0;
        break;
      case "howto":
        // The highlight is left where it stands. The how-to's one item is
        // drawn as the highlighted one outright, so the screen has no
        // highlight of its own to write, and specs/instrumentation.md's
        // `setScreen` table names `menuIndex` for `title` and for no other
        // screen — which leaves the `menuIndex` a return to the title lands
        // on the remembered selection's doing rather than a leftover of the
        // way out.
        state.howtoPage = 0;
        break;
      case "select":
        state.howtoPage = 0;
        state.selectIndex = lastOf(state, state.mode);
        break;
    }
  }

  /**
   * Stop the run and close the challenge. Leaving the editor in play stashes
   * the machine (specs/editor.md); the two challenge operations of
   * specs/instrumentation.md leave every per-challenge stash exactly as it
   * stood, so they close it without stashing.
   */
  private leaveEditor(stash: boolean): void {
    const { state } = this;
    stopRun(state);
    const ref = state.challengeRef;
    if (stash && ref !== null) {
      stashMachine(state, ref.mode, ref.index, state.editor.parts);
    }
    state.challenge = null;
    state.challengeRef = null;
    state.editor = emptyEditor();
  }

  /** Open one of a mode's shipped challenges in the editor, with an empty machine. */
  openChallenge(mode: Mode, index: number): void {
    const list = challengesOf(mode);
    const challenge = list[index];
    if (challenge === undefined) {
      throw new Error(
        `openChallenge: index ${index} is outside 0 to ${list.length - 1} for ${mode}`,
      );
    }
    this.openIn(cloneChallenge(challenge), { mode, index });
  }

  /** Open a challenge the challenge lists do not hold, from a document. */
  loadChallenge(challenge: W<Challenge>): void {
    this.openIn(challenge, null);
  }

  /**
   * Open the editor over a challenge with an empty machine, empty histories,
   * no run, and the tray derived from the challenge. Progress is untouched.
   */
  private openIn(
    challenge: W<Challenge>,
    ref: { mode: Mode; index: number } | null,
  ): void {
    const { state } = this;
    if (state.screen === "editor") this.leaveEditor(false);
    state.menuPress = null;
    state.challenge = challenge;
    state.challengeRef = ref;
    state.editor = emptyEditor();
    state.sim = null;
    state.screen = "editor";
    state.howtoPage = 0;
  }

  /**
   * Enter a challenge from its mode's select screen: the stashed machine of
   * this session, or an empty field on the first visit (specs/editor.md).
   */
  enterFromSelect(mode: Mode, index: number): void {
    const list = challengesOf(mode);
    const challenge = list[index];
    if (challenge === undefined) return;
    const { state } = this;
    if (state.screen === "editor") this.leaveEditor(true);
    state.menuPress = null;
    state.mode = mode;
    state.challenge = cloneChallenge(challenge);
    state.challengeRef = { mode, index };
    state.editor = emptyEditor();
    state.editor.parts = stashedMachine(state, mode, index);
    state.editor.nextId = state.editor.parts.reduce(
      (next, part) => Math.max(next, part.id + 1),
      1,
    );
    state.sim = null;
    state.screen = "editor";
    state.howtoPage = 0;
    setLastOf(state, mode, index);
  }

  /** Whether a mode's challenge at `index` may be entered from its select row. */
  enterable(mode: Mode, index: number): boolean {
    return enterable(this.state, mode, index);
  }

  /** Restore every declared field to its title-screen value. */
  reset(): void {
    resetState(this.state);
    clearOutbox();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /**
   * Resolve one pointer sample, in the order the samples arrived. The reading
   * is mirrored into `state.pointer` as the sample lands, so a posed press and
   * a player's press are the same event to the game
   * (specs/instrumentation.md).
   *
   * `menuTakes` belongs to the frame that is reading the sample. It is `false`
   * once one of that frame's keyboard edges has already taken a menu item, and
   * the sample then moves the highlight and takes nothing, because "a frame
   * carrying a keyboard `confirm` edge together with a pointer or touch taking
   * an item takes the keyboard's item alone" (specs/ui.md "Pointer and
   * touch"). A sample posed through the debug surface arrives outside any
   * frame, with no keyboard edge before it, so it always takes.
   */
  handlePointer(sample: PointerSample, menuTakes = true): void {
    const { state } = this;
    state.pointer = {
      x: sample.x,
      y: sample.y,
      down:
        sample.type === "move" ? state.pointer.down : sample.type === "down",
    };
    if (this.driveMenu(sample, menuTakes)) {
      // The menu answered the sample — and the focus rule answers it as well,
      // because it answers every press on the editor screen, the ones the
      // solved panel's items take included (specs/controls.md "Focus").
      applyPointerFocus(this, sample);
      return;
    }
    applyPointerSample(this, sample);
  }

  /**
   * Resolve one sample against the menu the current screen shows, and answer
   * whether the menu took it (specs/ui.md "Pointer and touch").
   *
   * A move or a press ONTO an item's region makes it the highlighted one, and
   * a press remembers the item it landed in. A release highlights the item it
   * lands in and takes that item only when the press landed in the same one:
   * "Two edges that fall in different regions, and an edge that falls outside
   * every region, take no item."
   *
   * A sample that lands outside every region is not the menu's: on a menu
   * screen nothing else reads it, and on the editor under the solved panel it
   * falls through to the editor, where the machine behind the panel takes
   * neither the highlight nor the take and only the focus rule answers.
   *
   * `takes` is `false` for the rest of a frame whose keyboard `confirm` has
   * already taken an item. The highlight still follows the sample; the take is
   * spent (specs/ui.md "Pointer and touch").
   */
  private driveMenu(sample: PointerSample, takes: boolean): boolean {
    const { state } = this;
    const menu = menuOf(state);
    if (menu === null) return false;
    const at = menuItemAt(menu, sample.x, sample.y);
    if (sample.type === "down") {
      // A frame whose take is spent arms nothing, so the release that follows
      // this press within it has nothing to pair with either.
      state.menuPress = takes ? at : null;
      if (at === null) return false;
      this.highlight(menu.kind, at);
      return true;
    }
    if (sample.type === "move") {
      if (at === null) return false;
      this.highlight(menu.kind, at);
      return true;
    }
    // A release, which is where a take is decided. The armed press is spent
    // whatever it decides, so a gesture never arms the next one.
    const pressed = state.menuPress;
    state.menuPress = null;
    if (at === null) return false;
    this.highlight(menu.kind, at);
    if (takes && pressed === at) this.takeMenuItem(menu, at);
    return true;
  }

  /**
   * Move the highlight the screen carries: `state.menuIndex`, except on
   * `select`, where it is `state.selectIndex` (specs/ui.md).
   */
  private highlight(kind: MenuKind, index: number): void {
    if (kind === "select") this.state.selectIndex = index;
    else this.state.menuIndex = index;
  }

  /**
   * Take one item of a menu, which does exactly what `confirm` does on that
   * screen — the same take, so a pointer, a touch contact, and the keyboard
   * cannot drift apart. The item taken is the one the highlight names,
   * whichever input raised it.
   */
  private takeMenuItem(menu: Menu, index: number): void {
    switch (menu.kind) {
      case "title":
        this.takeTitleItem();
        return;
      case "howto":
        this.enterScreen("title");
        return;
      case "select":
        this.takeSelectRow();
        return;
      case "solved":
        this.takeSolvedItem(this.solvedItems()[index]);
        return;
    }
  }

  /**
   * Resolve one action's press edge against the screen showing it. An action
   * the screen's row omits does nothing (specs/controls.md "What each screen
   * reads").
   *
   * Answers whether the edge TOOK a menu item. That is what closes the rest of
   * the frame to the menus: "a frame carrying a keyboard `confirm` edge
   * together with a pointer or touch taking an item takes the keyboard's item
   * alone" (specs/ui.md "Pointer and touch"). Reading the keyboard first is
   * not enough on its own, because a take changes the screen and the samples
   * read after it would land on the menu the NEW screen shows.
   */
  handleAction(action: Action): boolean {
    if (action === "mute") {
      this.io.toggleMuted();
      return false;
    }
    switch (this.actionContext()) {
      case "title":
        return this.titleAction(action);
      case "howto":
        return this.howtoAction(action);
      case "select":
        return this.selectAction(action);
      case "editor-editing":
        this.editingAction(action);
        return false;
      case "editor-running":
        this.runningAction(action);
        return false;
      case "editor-halted":
        return this.haltedAction(action);
    }
  }

  /** Answers whether the edge took the highlighted item. */
  private titleAction(action: Action): boolean {
    const { state } = this;
    const count = TITLE_ITEMS.length;
    if (action === "up")
      state.menuIndex = (state.menuIndex + count - 1) % count;
    else if (action === "down") state.menuIndex = (state.menuIndex + 1) % count;
    else if (action === "confirm") {
      this.takeTitleItem();
      return true;
    }
    return false;
  }

  /**
   * Take the highlighted title item, from the keyboard, a pointer, or a touch
   * contact alike. Taking one is what records the remembered title selection,
   * so a later return to the title lands on the entry that led away — and
   * nothing else writes it (specs/ui.md "The remembered title selection").
   */
  private takeTitleItem(): void {
    const { state } = this;
    state.titleIndex = state.menuIndex;
    const item = TITLE_ITEMS[state.menuIndex];
    if (item === "CAMPAIGN") {
      state.mode = "campaign";
      this.enterScreen("select");
    } else if (item === "EXTRAS") {
      state.mode = "extras";
      this.enterScreen("select");
    } else {
      this.enterScreen("howto");
    }
  }

  /**
   * Answers whether the edge took the screen's one item. `back` leaves for the
   * same title and takes nothing: the edge specs/ui.md closes a frame's menus on
   * is the `confirm` edge, and only that one.
   */
  private howtoAction(action: Action): boolean {
    const { state } = this;
    if (action === "left") state.howtoPage = Math.max(0, state.howtoPage - 1);
    else if (action === "right") {
      state.howtoPage = Math.min(HOWTO_PAGES - 1, state.howtoPage + 1);
    } else if (action === "confirm" || action === "back") {
      this.enterScreen("title");
      return action === "confirm";
    }
    return false;
  }

  /**
   * Answers whether the edge took the highlighted row. A locked row opens
   * nothing, and taking it is still what the frame's one take was spent on.
   */
  private selectAction(action: Action): boolean {
    const { state } = this;
    const count = challengeCount(state.mode);
    if (count > 0 && action === "up") {
      state.selectIndex = (state.selectIndex + count - 1) % count;
    } else if (count > 0 && action === "down") {
      state.selectIndex = (state.selectIndex + 1) % count;
    } else if (action === "confirm") {
      this.takeSelectRow();
      return true;
    } else if (action === "back") {
      this.enterScreen("title");
    }
    return false;
  }

  /** Take the highlighted select row: a locked one opens nothing. */
  private takeSelectRow(): void {
    const { state } = this;
    if (this.enterable(state.mode, state.selectIndex)) {
      this.enterFromSelect(state.mode, state.selectIndex);
    }
  }

  private editingAction(action: Action): void {
    const { state } = this;
    // While a drag or a lay is live the editor reads the ghost's four verbs
    // and nothing else (specs/editor.md "Dragging").
    if (state.editor.drag !== null && !DRAG_ACTIONS.includes(action)) return;
    if (action === "play") {
      if (this.machineReady()) {
        startRun(this);
        this.cue(CUES.start);
      }
      return;
    }
    if (action === "step") {
      if (this.machineReady()) {
        startRun(this);
        this.cue(CUES.start);
        if (state.sim !== null) state.sim.status = "paused";
      }
      return;
    }
    if (action === "back") {
      this.enterScreen("select");
      return;
    }
    applyEditorAction(this, action);
  }

  private runningAction(action: Action): void {
    const { state } = this;
    const sim = state.sim;
    if (sim === null) return;
    switch (action) {
      case "play":
        sim.status = sim.status === "running" ? "paused" : "running";
        return;
      case "step":
        stepOneCycle(this);
        return;
      case "speed-up":
        sim.speed = Math.min(SPEEDS.length - 1, sim.speed + 1);
        return;
      case "speed-down":
        sim.speed = Math.max(0, sim.speed - 1);
        return;
      case "back":
        stopRun(state);
        return;
      default:
        return;
    }
  }

  /**
   * Answers whether the edge took an item of the solved panel. Nothing is taken
   * while the run is faulted rather than complete: that panel shows no menu.
   */
  private haltedAction(action: Action): boolean {
    const { state } = this;
    const sim = state.sim;
    if (sim === null) return false;
    if (action === "back") {
      stopRun(state);
      state.menuIndex = 0;
      return false;
    }
    if (sim.status !== "complete") return false;
    const items = this.solvedItems();
    if (action === "up") {
      state.menuIndex = (state.menuIndex + items.length - 1) % items.length;
    } else if (action === "down") {
      state.menuIndex = (state.menuIndex + 1) % items.length;
    } else if (action === "confirm") {
      this.takeSolvedItem(items[state.menuIndex]);
      return true;
    }
    return false;
  }

  /** The solved panel's menu: `NEXT CHALLENGE` only when a next one exists. */
  solvedItems(): string[] {
    return solvedItems(this.state);
  }

  private takeSolvedItem(item: string | undefined): void {
    const { state } = this;
    const ref = state.challengeRef;
    if (item === "NEXT CHALLENGE" && ref !== null) {
      this.enterFromSelect(ref.mode, ref.index + 1);
      return;
    }
    if (item === "BACK TO SELECT") {
      this.enterScreen("select");
      return;
    }
    stopRun(state);
    state.menuIndex = 0;
  }

  /** Whether the `play` action starts a run (specs/editor.md). */
  machineReady(): boolean {
    return machineReady(this.state);
  }

  /** The machine the editor is holding, copied. */
  machine(): W<PartState>[] {
    return machineSnapshot(this.state);
  }

  /** The machine a challenge is stashing, copied. */
  stash(mode: Mode, index: number): W<PartState>[] {
    return stashedMachine(this.state, mode, index);
  }
}
