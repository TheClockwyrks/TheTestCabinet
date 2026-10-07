// Floe — what a frame's input does to the screen in front of the player
// (`specs/ui.md`, `specs/controls.md`).
//
// Input is resolved ONCE PER FRAME, here, and never inside a tick. Two reasons, and
// both are rules rather than conveniences:
//
//   * An edge fires once per press. A frame worth several ticks that handed the
//     same edge to each of them would move a menu's highlight several items for one
//     press, and `specs/ui.md` fixes one press as one move.
//   * A held direction is a REQUEST rather than a hop. The hop itself belongs to a
//     tick, because `HOP_COOLDOWN` is integrated in ticks like every other duration,
//     so what a frame leaves behind is the direction being asked for and the ticks
//     decide whether the cadence allows one.
//
// THE ORDER WITHIN A FRAME is `specs/ui.md`'s: up before down, and movement before
// confirm, so a frame carrying both an up edge and a down edge moves up only, and
// one carrying a movement edge and a confirm edge moves only.

import { CUES } from "./constants";
import {
  CROSS_ENTRY,
  HOWTO_ENTRY,
  goTo,
  menuItems,
  resume,
  startRun,
} from "./flow";
import { menuItemAt } from "./menus";
import { DIRECTIONS } from "./strait";
import type { Direction } from "./strait";
import type { FrameInput } from "./input";
import type { Sim, TickEvents } from "./sim";

/** What the frame's input asked of the runtime, which the game cannot do itself. */
export interface FrameOutcome {
  /** The mute action fired, so the runtime's mute bit is toggled. */
  readonly toggleMute: boolean;
}

/** The direction a frame is asking the critter to hop, at the stated priority. */
function requestedDirection(input: FrameInput): Direction | null {
  const held: Record<Direction, boolean> = {
    up: input.up,
    down: input.down,
    left: input.left,
    right: input.right,
  };
  return DIRECTIONS.find((name) => held[name]) ?? null;
}

/** Take the highlighted item of whatever menu the current screen shows. */
function confirmItem(sim: Sim): void {
  switch (sim.screen) {
    case "title":
      if (sim.menuIndex === 0) startRun(sim);
      else goTo(sim, "howto");
      return;
    case "paused":
      if (sim.menuIndex === 0) resume(sim);
      else if (sim.menuIndex === 1) startRun(sim);
      else goTo(sim, "title", CROSS_ENTRY);
      return;
    case "victory":
    case "gameover":
      if (sim.menuIndex === 0) startRun(sim);
      else goTo(sim, "title", CROSS_ENTRY);
      return;
    default:
      return;
  }
}

/**
 * What the back action does on each screen that answers to it.
 *
 * The title screen is the outermost screen, so back does nothing there
 * (`specs/ui.md`).
 */
function leaveScreen(sim: Sim): void {
  switch (sim.screen) {
    case "howto":
      goTo(sim, "title", HOWTO_ENTRY);
      return;
    case "victory":
    case "gameover":
      goTo(sim, "title", CROSS_ENTRY);
      return;
    case "paused":
      resume(sim);
      return;
    default:
      return;
  }
}

/**
 * The frame's pointer and touch edges, applied to the menu in front of the
 * player (`specs/ui.md`).
 *
 * An aim selects whatever item it is over. A release confirms only when both of
 * its ends — the press and the lift, or the landing and the lift — fall in one
 * item's region; a gesture that began outside every region, ended outside one, or
 * crossed from one to another selects what it aimed at and confirms nothing.
 *
 * Read in the order the edges arrived, so a press and the release that follows it
 * inside one frame confirm on that frame.
 */
function stepPointer(sim: Sim, input: FrameInput, events: TickEvents): void {
  for (const edge of input.pointer) {
    if (edge.kind === "down") sim.pointerDown = { x: edge.x, y: edge.y };
    const items = menuItems(sim.screen);
    if (items === null || items.length === 0) {
      if (edge.kind === "up") sim.pointerDown = null;
      continue;
    }
    // A finger indicates nothing while it is off the glass; a mouse indicates
    // wherever it hovers (specs/ui.md).
    const indicates =
      edge.kind !== "move" || !edge.touch || sim.pointerDown !== null;
    const at = indicates ? menuItemAt(sim.screen, edge.x, edge.y) : null;
    if (at !== null && at !== sim.menuIndex) {
      sim.menuIndex = at;
      events.cues.add(CUES.menu);
    }
    if (edge.kind !== "up") continue;
    const pressed = sim.pointerDown;
    sim.pointerDown = null;
    if (pressed === null || at === null) continue;
    if (menuItemAt(sim.screen, pressed.x, pressed.y) !== at) continue;
    confirmItem(sim);
  }
}

/** One frame of a screen that carries a menu, or the how-to page. */
function stepMenuScreen(sim: Sim, input: FrameInput, events: TickEvents): void {
  const items = menuItems(sim.screen);
  let moved = false;
  if (items !== null && items.length > 0) {
    if (input.tapUp) {
      sim.menuIndex = (sim.menuIndex - 1 + items.length) % items.length;
      events.cues.add(CUES.menu);
      moved = true;
    } else if (input.tapDown) {
      sim.menuIndex = (sim.menuIndex + 1) % items.length;
      events.cues.add(CUES.menu);
      moved = true;
    }
  }
  // The how-to screen has two ways out and they do the same thing (specs/ui.md).
  if (sim.screen === "howto") {
    if (input.confirm || input.back) leaveScreen(sim);
    return;
  }
  // Pause closes the pause menu exactly as back does, so `KeyP` resumes as well
  // as `Escape` (specs/ui.md).
  if (sim.screen === "paused" && input.pause) {
    resume(sim);
    return;
  }
  if (!moved && input.confirm) {
    // A frame carrying a keyboard confirm confirms the keyboard's item alone,
    // so this frame's pointer edges are not read (specs/ui.md).
    confirmItem(sim);
    return;
  }
  if (!moved && input.back && sim.screen !== "title") {
    leaveScreen(sim);
    return;
  }
  // Nothing the keyboard did left this screen, so the frame's pointer and touch
  // edges are still about the menu in front of the player. They are applied
  // after the keyboard's edges, so a pointer selection wins a frame that also
  // carried a keyboard movement edge.
  stepPointer(sim, input, events);
}

/**
 * Resolve one frame's input (`specs/controls.md`).
 *
 * Every screen answers to mute. The `playing` screen answers to pause and stores
 * the direction being requested; every other screen runs its menu.
 */
export function handleInput(
  sim: Sim,
  input: FrameInput,
  events: TickEvents,
): FrameOutcome {
  if (sim.screen === "playing") {
    sim.request = requestedDirection(input);
    // The request is what a HELD direction leaves for the ticks of this frame; the
    // latch is what a press edge leaves for the first tick that runs, whether that
    // is one of this frame's or one of a later frame's.
    if (sim.request !== null) sim.pendingTap = sim.request;
    if (input.pause) {
      goTo(sim, "paused");
      sim.request = null;
      sim.pendingTap = null;
    }
    return { toggleMute: input.mute };
  }

  sim.request = null;
  sim.pendingTap = null;
  stepMenuScreen(sim, input, events);
  return { toggleMute: input.mute };
}
