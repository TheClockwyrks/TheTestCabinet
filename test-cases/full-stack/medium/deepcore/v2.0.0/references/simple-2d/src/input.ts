// Deepcore — input, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It declares the
// NAMED ACTIONS `src/constants.ts` binds and the engine does the listening, the
// edge detection, and the mapping of the pointer into the stage's logical units.
//
// Movement, thrust, and the drill are HELD, so they are read with `value` every
// frame and mirrored onto the frame's draft for the simulation to use. Everything
// else is an EDGE, read with `pressed` exactly once per frame, here, because an
// edge is consumed by the first call that sees it: two readers of one action in
// one frame would split a single press between them.
//
// The pointer is read the same way. A click is a `down` sample, resolved against
// the control layout `src/controls.ts` computes from the state the frame opened
// on — the same rectangles the previous frame drew — and a hover over a menu
// item moves the highlight onto it, so the mouse and the keyboard stay agreed
// about which item is chosen.

import { ACTION_NAMES, ACTIONS } from "./constants";
import type { ActionName } from "./constants";
import { controlAt, inside } from "./controls";
import type { Control } from "./controls";
import {
  activate,
  activateNearbyBuilding,
  openPauseMenu,
  toggleInventory,
} from "./flow";
import { jettisonCoreSample, useItem } from "./items";
import { menuItems } from "./menus";
import type { Draft } from "./state";
import { itemForHotkey } from "./tuning";
import type { InitApi, UpdateApi } from "@clockwyrks/simple-2d";

/** The six supply hotkeys, in the order the number keys select them. */
const SUPPLY_ACTIONS = [
  "supply1",
  "supply2",
  "supply3",
  "supply4",
  "supply5",
  "supply6",
] as const;

/**
 * Register every action in `ACTIONS`, bound to the key codes that drive it.
 *
 * Deepcore is played with the keyboard and the mouse alone, so no touch layout
 * is selected and this table is the whole vocabulary; an engine stood up with a
 * layout would be tagging actions this game does not own, so that is refused
 * here rather than left to surprise a player.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout !== null) {
    throw new Error(
      `Deepcore: the engine must be built with no touch layout, not ${layout.name}`,
    );
  }
  for (const action of ACTION_NAMES) {
    api.input.register(action, { keys: [...ACTIONS[action]] });
  }
}

/** Whether an action is held right now. */
function held(api: UpdateApi, action: ActionName): boolean {
  return api.input.value(action) > 0;
}

/**
 * The control each contact currently down was pressed on, by contact id.
 *
 * specs/controls.md: "A choice requires both of its edges inside one region: the
 * press and its release for a pointer, the landing and the lift for a touch
 * contact. Two edges falling in different regions, and an edge falling outside
 * every region, choose nothing." So a press is remembered rather than acted on,
 * and the release is what runs it — and only where it lands on the same control.
 * A contact that goes down outside every region is remembered as `null`, so its
 * release chooses nothing either.
 */
const pressedOn = new Map<number, string | null>();

/**
 * Resolve this frame's pointer: the mirror the renderer hovers with, and every
 * completed contact, in arrival order, against the controls the state offers.
 */
export function readPointer(
  d: Draft,
  api: UpdateApi,
  controls: readonly Control[],
): void {
  const pointer = api.input.pointer();
  d.pointer = { x: pointer.x, y: pointer.y, down: pointer.down };
  for (const sample of api.input.pointerSamples()) {
    if (sample.type === "down") {
      const hit = controlAt(controls, sample.x, sample.y);
      pressedOn.set(sample.id, hit ? hit.action : null);
      continue;
    }
    if (sample.type !== "up") continue;
    const pressed = pressedOn.get(sample.id) ?? null;
    pressedOn.delete(sample.id);
    if (pressed === null) continue;
    const hit = controlAt(controls, sample.x, sample.y);
    if (hit && hit.action === pressed) run(d, api, hit.action);
  }
  syncMenuToPointer(d, controls, pointer.x, pointer.y);
}

/**
 * Move the highlight onto the menu item the pointer is over, so choosing with
 * the mouse and choosing with `activate` never disagree.
 */
function syncMenuToPointer(
  d: Draft,
  controls: readonly Control[],
  x: number,
  y: number,
): void {
  if (d.screen === "in-mine") return;
  const items = menuItems(d);
  for (let i = 0; i < items.length; i += 1) {
    const control = controls.find((c) => c.action === items[i].action);
    if (control && inside(control, x, y)) {
      d.menuIndex = i;
      return;
    }
  }
}

/**
 * Read this frame's actions: the held ones onto the draft, and every edge acted
 * on once, in the order this screen gives them.
 */
export function readActions(d: Draft, api: UpdateApi): void {
  d.input = {
    left: held(api, "left"),
    right: held(api, "right"),
    down: held(api, "down"),
    thrust: held(api, "up"),
  };

  // Every edge is read before any of them is acted on, so exactly one press is
  // spent per press whatever this screen does with it.
  const edges = {
    up: api.input.pressed("up"),
    down: api.input.pressed("down"),
    activate: api.input.pressed("activate"),
    inventory: api.input.pressed("inventory"),
    pause: api.input.pressed("pause"),
    mute: api.input.pressed("mute"),
    jettison: api.input.pressed("jettison"),
    supplies: SUPPLY_ACTIONS.map((action) => api.input.pressed(action)),
  };

  // Mute works on every screen, so it is acted on before the per-screen split.
  if (edges.mute) api.audio.setMuted(!api.audio.muted());

  if (d.screen === "in-mine") {
    // The notice card has no claim on `pause`. specs/hazards.md makes the card
    // non-blocking and gives it exactly two ends — a click on it, and its own
    // fade — and specs/controls.md keeps `pause` bound to the pause menu the
    // whole time the card is up.
    // specs/items.md: the six hotkeys and the jettison key "act throughout the
    // mine, with a building panel or the inventory overlay open exactly as with
    // the mine clear", and both paths run the same logic.
    for (let i = 0; i < edges.supplies.length; i += 1) {
      if (!edges.supplies[i]) continue;
      const id = itemForHotkey(i + 1);
      if (id) useItem(d, id);
      return;
    }
    if (edges.jettison) {
      jettisonCoreSample(d);
      return;
    }
    if (edges.pause) openPauseMenu(d);
    else if (edges.activate) {
      if (!d.panel) activateNearbyBuilding(d);
    } else if (edges.inventory) toggleInventory(d);
    return;
  }

  // A menu screen: move the highlight, choose, or go back.
  const items = menuItems(d);
  if (items.length === 0) return;
  if (edges.up) {
    d.menuIndex = (d.menuIndex - 1 + items.length) % items.length;
  } else if (edges.down) {
    d.menuIndex = (d.menuIndex + 1) % items.length;
  } else if (edges.activate) {
    activate(d, items[d.menuIndex]?.action ?? "");
  } else if (edges.pause) {
    goBack(d);
  }
  clampMenuIndex(d);
}

/** Where `pause` leads from each screen that has a back. */
function goBack(d: Draft): void {
  if (d.screen === "mode-select" || d.screen === "how-to-play") {
    activate(d, "nav:title");
  } else if (d.screen === "size-select") activate(d, "nav:mode-select");
  else if (d.screen === "paused") activate(d, "resume");
  else if (d.screen === "victory" || d.screen === "game-over") {
    activate(d, "nav:title");
  }
}

/** Keep the highlight inside the menu the current screen shows. */
export function clampMenuIndex(d: Draft): void {
  const items = menuItems(d);
  if (d.menuIndex >= items.length) d.menuIndex = Math.max(0, items.length - 1);
}

/**
 * Run one control. Everything but the mute toggle is the game's own; muting is
 * the engine's, so it is the one control that reaches past the state.
 */
function run(d: Draft, api: UpdateApi, action: string): void {
  if (action === "sys:mute") {
    api.audio.setMuted(!api.audio.muted());
    return;
  }
  activate(d, action);
}
