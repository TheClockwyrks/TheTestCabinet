// Orrery — the session: the transitions the screens, the editor, and the run
// are moved by (specs/state.md, specs/ui.md, specs/controls.md,
// specs/simulation.md).
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
import { applyEditorAction, applyPointerSample } from "./editor";
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
import { enterable, machineReady, solvedItems } from "./progress";
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
        state.menuIndex = 0;
        state.howtoPage = 0;
        break;
      case "howto":
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
   */
  handlePointer(sample: PointerSample): void {
    const { state } = this;
    state.pointer = {
      x: sample.x,
      y: sample.y,
      down:
        sample.type === "move" ? state.pointer.down : sample.type === "down",
    };
    applyPointerSample(this, sample);
  }

  /**
   * Resolve one action's press edge against the screen showing it. An action
   * the screen's row omits does nothing (specs/controls.md "What each screen
   * reads").
   */
  handleAction(action: Action): void {
    if (action === "mute") {
      this.io.toggleMuted();
      return;
    }
    switch (this.actionContext()) {
      case "title":
        this.titleAction(action);
        return;
      case "howto":
        this.howtoAction(action);
        return;
      case "select":
        this.selectAction(action);
        return;
      case "editor-editing":
        this.editingAction(action);
        return;
      case "editor-running":
        this.runningAction(action);
        return;
      case "editor-halted":
        this.haltedAction(action);
        return;
    }
  }

  private titleAction(action: Action): void {
    const { state } = this;
    const count = TITLE_ITEMS.length;
    if (action === "up")
      state.menuIndex = (state.menuIndex + count - 1) % count;
    else if (action === "down") state.menuIndex = (state.menuIndex + 1) % count;
    else if (action === "confirm") {
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
  }

  private howtoAction(action: Action): void {
    const { state } = this;
    if (action === "left") state.howtoPage = Math.max(0, state.howtoPage - 1);
    else if (action === "right") {
      state.howtoPage = Math.min(HOWTO_PAGES - 1, state.howtoPage + 1);
    } else if (action === "confirm" || action === "back") {
      this.enterScreen("title");
    }
  }

  private selectAction(action: Action): void {
    const { state } = this;
    const count = challengeCount(state.mode);
    if (count > 0 && action === "up") {
      state.selectIndex = (state.selectIndex + count - 1) % count;
    } else if (count > 0 && action === "down") {
      state.selectIndex = (state.selectIndex + 1) % count;
    } else if (action === "confirm") {
      if (this.enterable(state.mode, state.selectIndex)) {
        this.enterFromSelect(state.mode, state.selectIndex);
      }
    } else if (action === "back") {
      this.enterScreen("title");
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

  private haltedAction(action: Action): void {
    const { state } = this;
    const sim = state.sim;
    if (sim === null) return;
    if (action === "back") {
      stopRun(state);
      state.menuIndex = 0;
      return;
    }
    if (sim.status !== "complete") return;
    const items = this.solvedItems();
    if (action === "up") {
      state.menuIndex = (state.menuIndex + items.length - 1) % items.length;
    } else if (action === "down") {
      state.menuIndex = (state.menuIndex + 1) % items.length;
    } else if (action === "confirm") {
      this.takeSolvedItem(items[state.menuIndex]);
    }
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
