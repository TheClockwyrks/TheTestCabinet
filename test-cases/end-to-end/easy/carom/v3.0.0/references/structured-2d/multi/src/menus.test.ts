// The menus' layout and their pointer arithmetic (specs/ui.md), as pure
// functions over one frame's samples.
//
// `src/engine.test.ts` drives the same rules through the real engine, with real
// pointer events; what is checked here is the arithmetic underneath, where a
// case that is awkward to dispatch — a second finger, a sweep that crossed
// three items between two frames, a release with no press behind it — is one
// array.

import { describe, expect, it } from "vitest";
import type { PointerSample } from "@test-cabinet/structured-2d";
import {
  HOWTO_ITEMS,
  itemAtPoint,
  menuItemRect,
  menuOf,
  readPointerMenu,
  type PressOrigins,
} from "./menus";
import {
  FIELD_H,
  FIELD_W,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./state";

const MENU_SCREENS: Screen[] = ["title", "howto", "paused", "matchover"];

/** One sample, with everything the menus do not read filled in. */
function sample(
  type: PointerSample["type"],
  x: number,
  y: number,
  id = 0,
): PointerSample {
  return {
    type,
    x,
    y,
    id,
    primary: id === 0,
    device: "mouse",
    button: type === "move" ? null : "primary",
    buttons: type === "down" ? ["primary"] : [],
  };
}

/** The centre of item `index` on `screen`. */
function centre(screen: Screen, index: number): { x: number; y: number } {
  const rect = menuItemRect(screen, index);
  if (rect === null) throw new Error(`no region for ${screen} item ${index}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function origins(): PressOrigins {
  return new Map<number, number | null>();
}

describe("the menus each screen shows", () => {
  it("shows the items specs/ui.md fixes, in order", () => {
    expect(menuOf("title")?.items).toEqual([...TITLE_ITEMS]);
    expect(menuOf("howto")?.items).toEqual([...HOWTO_ITEMS]);
    expect(menuOf("paused")?.items).toEqual([...PAUSE_ITEMS]);
    expect(menuOf("matchover")?.items).toEqual([...MATCHOVER_ITEMS]);
  });

  it("shows none on the two screens that show none", () => {
    expect(menuOf("countdown")).toBeNull();
    expect(menuOf("playing")).toBeNull();
    expect(menuItemRect("countdown", 0)).toBeNull();
    expect(menuItemRect("playing", 0)).toBeNull();
  });

  it("reports one region per item, and none for an index it has not", () => {
    for (const screen of MENU_SCREENS) {
      const items = menuOf(screen)?.items ?? [];
      expect(items.length).toBeGreaterThan(0);
      for (let i = 0; i < items.length; i += 1) {
        expect(menuItemRect(screen, i)).not.toBeNull();
      }
      expect(menuItemRect(screen, items.length)).toBeNull();
      expect(menuItemRect(screen, -1)).toBeNull();
    }
  });

  it("keeps every region on the field and clear of its neighbours", () => {
    for (const screen of MENU_SCREENS) {
      const rects = menuOf(screen)?.rects ?? [];
      for (const rect of rects) {
        expect(rect.w).toBeGreaterThan(0);
        expect(rect.h).toBeGreaterThan(0);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(FIELD_W);
        expect(rect.y + rect.h).toBeLessThanOrEqual(FIELD_H);
      }
      for (let i = 1; i < rects.length; i += 1) {
        expect(rects[i].y).toBeGreaterThanOrEqual(
          rects[i - 1].y + rects[i - 1].h,
        );
      }
    }
  });

  it("resolves a point to the item whose region holds it", () => {
    const at = centre("title", 1);
    expect(itemAtPoint("title", at.x, at.y)).toBe(1);
    expect(itemAtPoint("title", 4, 4)).toBeNull();
    // No menu, so no item, wherever the point is.
    expect(itemAtPoint("playing", at.x, at.y)).toBeNull();
  });
});

describe("one frame of pointer input over a menu", () => {
  it("selects the item a move lands on, and confirms nothing", () => {
    const at = centre("title", 2);
    const read = readPointerMenu(
      [sample("move", at.x, at.y)],
      "title",
      origins(),
    );
    expect(read).toEqual({ selected: 2, confirmed: null });
  });

  it("selects the last item a sweep crossed, not the first", () => {
    const first = centre("title", 0);
    const last = centre("title", 2);
    const read = readPointerMenu(
      [
        sample("move", first.x, first.y),
        sample("move", last.x, last.y),
        sample("move", 8, 8),
        sample("move", last.x, last.y),
      ],
      "title",
      origins(),
    );
    expect(read.selected).toBe(2);
  });

  it("confirms a press and a release inside one region, on one frame", () => {
    const at = centre("paused", 1);
    const read = readPointerMenu(
      [
        sample("move", at.x, at.y),
        sample("down", at.x, at.y),
        sample("up", at.x, at.y),
      ],
      "paused",
      origins(),
    );
    expect(read).toEqual({ selected: 1, confirmed: 1 });
  });

  it("selects on a landing, as a finger that does not hover does", () => {
    const at = centre("matchover", 1);
    const read = readPointerMenu(
      [sample("down", at.x, at.y)],
      "matchover",
      origins(),
    );
    expect(read).toEqual({ selected: 1, confirmed: null });
  });

  it("confirms nothing when the two edges fall in different regions", () => {
    const store = origins();
    const from = centre("title", 0);
    const to = centre("title", 2);
    expect(
      readPointerMenu([sample("down", from.x, from.y)], "title", store),
    ).toEqual({ selected: 0, confirmed: null });
    expect(
      readPointerMenu([sample("move", to.x, to.y)], "title", store),
    ).toEqual({ selected: 2, confirmed: null });
    expect(readPointerMenu([sample("up", to.x, to.y)], "title", store)).toEqual(
      { selected: null, confirmed: null },
    );
    // The gesture is over, so nothing is remembered of it.
    expect(store.size).toBe(0);
  });

  it("confirms nothing when an edge falls outside every region", () => {
    const store = origins();
    const at = centre("title", 1);
    readPointerMenu([sample("down", 6, 6)], "title", store);
    const read = readPointerMenu([sample("up", at.x, at.y)], "title", store);
    expect(read.confirmed).toBeNull();
  });

  it("confirms nothing for a release with no press behind it", () => {
    const at = centre("title", 1);
    const read = readPointerMenu(
      [sample("up", at.x, at.y)],
      "title",
      origins(),
    );
    expect(read.confirmed).toBeNull();
  });

  it("keeps each pointer's press to itself", () => {
    const store = origins();
    const one = centre("paused", 0);
    const two = centre("paused", 2);
    // Two contacts land on different items; each lifts on its own.
    readPointerMenu(
      [sample("down", one.x, one.y, 1), sample("down", two.x, two.y, 2)],
      "paused",
      store,
    );
    const lifted = readPointerMenu(
      [sample("up", two.x, two.y, 2)],
      "paused",
      store,
    );
    expect(lifted).toEqual({ selected: 2, confirmed: 2 });
    // The other contact is still down, and still remembers its own item.
    expect(store.get(1)).toBe(0);
  });

  it("asks nothing of a screen that shows no menu", () => {
    const at = centre("title", 0);
    const read = readPointerMenu(
      [sample("down", at.x, at.y), sample("up", at.x, at.y)],
      "playing",
      origins(),
    );
    expect(read).toEqual({ selected: null, confirmed: null });
  });
});
