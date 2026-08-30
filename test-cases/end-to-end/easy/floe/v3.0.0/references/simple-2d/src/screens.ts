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
import { goTo, menuItems, resume, startRun } from "./flow";
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
      else goTo(sim, "title");
      return;
    case "victory":
    case "gameover":
      if (sim.menuIndex === 0) startRun(sim);
      else goTo(sim, "title");
      return;
    default:
      return;
  }
}

/** What the back action does on each screen that answers to it. */
function leaveScreen(sim: Sim): void {
  switch (sim.screen) {
    case "howto":
    case "victory":
    case "gameover":
      goTo(sim, "title");
      return;
    case "paused":
      resume(sim);
      return;
    default:
      return;
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
  if (!moved && input.confirm) {
    confirmItem(sim);
    return;
  }
  if (!moved && input.back) leaveScreen(sim);
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
    if (input.pause) {
      goTo(sim, "paused");
      sim.request = null;
    }
    return { toggleMute: input.mute };
  }

  sim.request = null;
  stepMenuScreen(sim, input, events);
  return { toggleMute: input.mute };
}
