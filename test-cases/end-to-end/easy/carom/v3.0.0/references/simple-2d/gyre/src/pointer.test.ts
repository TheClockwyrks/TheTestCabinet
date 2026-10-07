// The pointer rule specs/ui.md fixes, checked against `resolvePointer` directly:
// a pure function of a state and one frame's samples, so every case below is one
// call with no engine, no canvas, and no browser behind it.

import { describe, expect, it } from "vitest";
import { createInitialState, type CaromState, type Screen } from "./game";
import { itemCenter, menuFor, PAUSE_MENU, TITLE_MENU } from "./menus";
import { resolvePointer } from "./pointer";
import type { PointerSample } from "@clockwyrks/simple-2d";

/** The center of item `index` on `screen`, where a pointer selects it. */
function center(screen: Screen, index: number): { x: number; y: number } {
  const layout = menuFor(screen);
  if (!layout) throw new Error(`${screen} shows no menu`);
  return itemCenter(layout, index);
}

/** One sample, with the fields the rule reads and sensible defaults. */
function sample(
  type: PointerSample["type"],
  x: number,
  y: number,
  patch: Partial<PointerSample> = {},
): PointerSample {
  return {
    type,
    x,
    y,
    id: 1,
    primary: true,
    device: "mouse",
    button: type === "move" ? null : "primary",
    buttons: type === "down" ? ["primary"] : [],
    ...patch,
  };
}

/** The title screen, as `initialize` and `reset` leave it. */
function title(): CaromState {
  return createInitialState();
}

/** The state after one frame carrying `samples`. */
function frame(state: CaromState, samples: PointerSample[]): CaromState {
  return resolvePointer(state, samples);
}

describe("selection", () => {
  it("selects the item a pointer moves onto", () => {
    const p = center("title", 2);
    expect(frame(title(), [sample("move", p.x, p.y)]).menuIndex).toBe(2);
  });

  it("ends on the last item a sweep across the menu came to rest on", () => {
    const next = frame(title(), [
      sample("move", center("title", 0).x, center("title", 0).y),
      sample("move", center("title", 2).x, center("title", 2).y),
      sample("move", center("title", 1).x, center("title", 1).y),
    ]);
    expect(next.menuIndex).toBe(1);
  });

  it("deselects nothing when the pointer leaves the menu", () => {
    const on = frame(title(), [
      sample("move", center("title", 1).x, center("title", 1).y),
    ]);
    expect(frame(on, [sample("move", 5, 5)]).menuIndex).toBe(1);
  });

  it("selects on a touch landing, because a finger does not hover", () => {
    const p = center("title", 1);
    const next = frame(title(), [
      sample("down", p.x, p.y, { device: "touch", id: 9 }),
    ]);
    expect(next.menuIndex).toBe(1);
    expect(next.screen).toBe("title");
  });

  it("does nothing at all on a screen with no menu", () => {
    const playing: CaromState = { ...title(), screen: "playing" };
    const next = frame(playing, [
      sample("down", 640, 430),
      sample("up", 640, 430),
    ]);
    expect(next.screen).toBe("playing");
    expect(next.menuIndex).toBe(0);
  });
});

describe("confirming", () => {
  it("confirms an item pressed and released inside its own region", () => {
    const p = center("title", 1); // VERSUS
    const next = frame(title(), [
      sample("down", p.x, p.y),
      sample("up", p.x, p.y),
    ]);
    expect(next.screen).toBe("countdown");
    expect(next.mode).toBe("versus");
    expect(next.titleIndex).toBe(1);
  });

  it("confirms across frames, remembering the item the press began on", () => {
    const p = center("title", 2); // HOW TO PLAY
    const pressed = frame(title(), [sample("down", p.x, p.y)]);
    expect(pressed.screen).toBe("title");
    const released = frame(pressed, [sample("up", p.x, p.y)]);
    expect(released.screen).toBe("howto");
    expect(released.titleIndex).toBe(2);
  });

  it("confirms nothing when the two edges fall on different items", () => {
    const from = center("title", 0);
    const to = center("title", 1);
    const pressed = frame(title(), [sample("down", from.x, from.y)]);
    const dragged = frame(pressed, [sample("move", to.x, to.y)]);
    const released = frame(dragged, [sample("up", to.x, to.y)]);
    expect(released.screen).toBe("title");
    expect(released.menuIndex).toBe(1);
  });

  it("confirms nothing when an edge falls outside every region", () => {
    const p = center("title", 0);
    const outside = frame(title(), [
      sample("down", 10, 10),
      sample("up", p.x, p.y),
    ]);
    expect(outside.screen).toBe("title");

    const pressed = frame(title(), [sample("down", p.x, p.y)]);
    expect(frame(pressed, [sample("up", 10, 10)]).screen).toBe("title");
  });

  it("forgets a press when the screen changes under it", () => {
    const p = center("title", 0);
    const pressed = frame(title(), [sample("down", p.x, p.y)]);
    const moved: CaromState = { ...pressed, screen: "paused", menuIndex: 0 };
    const released = frame(moved, [
      sample("up", PAUSE_MENU.centerX, PAUSE_MENU.startY),
    ]);
    // The item under the release is pause item 0, but the press belonged to the
    // title, so nothing is confirmed and RESUME is not taken.
    expect(released.screen).toBe("paused");
  });

  it("keeps one press per pointer, and one per contact", () => {
    const first = center("title", 0);
    const second = center("title", 1);
    const both = frame(title(), [
      sample("down", first.x, first.y, { id: 11, device: "touch" }),
      sample("down", second.x, second.y, {
        id: 12,
        device: "touch",
        primary: false,
      }),
    ]);
    expect(both.pointerPresses).toHaveLength(2);
    // The first contact lifts where it landed, so ITS item is confirmed.
    const lifted = frame(both, [
      sample("up", first.x, first.y, { id: 11, device: "touch" }),
    ]);
    expect(lifted.screen).toBe("countdown");
    expect(lifted.mode).toBe("solo");
  });

  it("drops a press record on release whether or not it confirmed", () => {
    const p = center("title", 0);
    const pressed = frame(title(), [sample("down", p.x, p.y)]);
    expect(pressed.pointerPresses).toHaveLength(1);
    const released = frame(pressed, [sample("up", 10, 10)]);
    expect(released.pointerPresses).toEqual([]);
  });

  it("ignores the samples that follow a confirm on the same frame", () => {
    const solo = center("title", 0);
    const versus = center("title", 1);
    const next = frame(title(), [
      sample("down", solo.x, solo.y),
      sample("up", solo.x, solo.y),
      // The menu is gone; these belong to nothing.
      sample("down", versus.x, versus.y),
      sample("up", versus.x, versus.y),
    ]);
    expect(next.mode).toBe("solo");
    expect(next.screen).toBe("countdown");
    expect(next.pointerPresses).toEqual([]);
  });

  it("confirms the how-to screen's single item back to the title", () => {
    const howto: CaromState = {
      ...title(),
      screen: "howto",
      titleIndex: 2,
      menuIndex: 0,
    };
    const p = center("howto", 0);
    const next = frame(howto, [
      sample("down", p.x, p.y),
      sample("up", p.x, p.y),
    ]);
    expect(next.screen).toBe("title");
    expect(next.menuIndex).toBe(2);
  });

  it("leaves the state it was handed exactly as it was", () => {
    const start = title();
    const before = JSON.stringify(start);
    const p = itemCenter(TITLE_MENU, 1);
    frame(start, [sample("down", p.x, p.y), sample("up", p.x, p.y)]);
    expect(JSON.stringify(start)).toBe(before);
  });
});
