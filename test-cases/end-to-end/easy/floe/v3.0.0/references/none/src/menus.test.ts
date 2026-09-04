// Floe — the menus a pointer and a finger drive (specs/ui.md).
//
// Two things are checked here and nowhere else: that the regions this build
// reports are the ones it draws its entries in, and that a gesture over one of
// them does what `specs/ui.md` says it does. The rules themselves are the game's
// (`src/game.ts`), so these drive the same `stepGame` a key does, through the
// pointer edges the runtime layer delivers.

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "./constants";
import { menuItemAt, menuItemRect } from "./menus";
import { harness } from "./harness.test-support";
import type { MenuRect } from "./menus";

/** The centre of a reported region, which is where a gesture is aimed. */
function centre(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The region of item `index` on the screen showing, failing if there is none. */
function rectOf(
  screen: "title" | "paused" | "victory",
  index: number,
): MenuRect {
  const rect = menuItemRect(screen, index);
  expect(rect, `${screen} item ${index} to have a region`).not.toBeNull();
  return rect as MenuRect;
}

describe("the menu regions", () => {
  it("reports one region per entry, inside the stage and apart from each other", () => {
    for (const screen of ["title", "paused", "victory", "gameover"] as const) {
      const rects: MenuRect[] = [];
      for (let index = 0; ; index += 1) {
        const rect = menuItemRect(screen, index);
        if (rect === null) break;
        expect(rect.x, screen).toBeGreaterThanOrEqual(0);
        expect(rect.y, screen).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, screen).toBeLessThanOrEqual(STAGE_W);
        expect(rect.y + rect.h, screen).toBeLessThanOrEqual(STAGE_H);
        rects.push(rect);
      }
      expect(rects.length, screen).toBeGreaterThan(1);
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          const gap =
            rects[a].y + rects[a].h <= rects[b].y ||
            rects[b].y + rects[b].h <= rects[a].y;
          expect(gap, `${screen} ${a} and ${b} apart`).toBe(true);
        }
      }
    }
  });

  it("has no region on a screen with no menu, or for an index outside one", () => {
    expect(menuItemRect("howto", 0)).toBeNull();
    expect(menuItemRect("playing", 0)).toBeNull();
    expect(menuItemRect("title", TITLE_ITEMS.length)).toBeNull();
    expect(menuItemRect("title", -1)).toBeNull();
  });

  it("resolves a point in a region to that entry, and a point outside to none", () => {
    const first = rectOf("title", 0);
    const at = centre(first);
    expect(menuItemAt("title", at.x, at.y)).toBe(0);
    expect(menuItemAt("title", first.x - 10, at.y)).toBeNull();
    expect(menuItemAt("howto", at.x, at.y)).toBeNull();
  });
});

describe("driving a menu with a pointer", () => {
  it("selects the entry a hovering pointer moves onto", () => {
    const h = harness();
    const at = centre(rectOf("title", 1));
    h.point({ kind: "aim", x: at.x, y: at.y });
    h.advance(1);
    expect(h.api.snapshot().menuIndex).toBe(1);
    expect(h.api.snapshot().screen).toBe("title");
  });

  it("confirms the entry a press and its release both fall in", () => {
    const h = harness();
    const at = centre(rectOf("title", 1));
    h.point(
      { kind: "aim", x: at.x, y: at.y },
      { kind: "release", x: at.x, y: at.y, fromX: at.x, fromY: at.y },
    );
    h.advance(1);
    expect(h.api.snapshot().screen).toBe("howto");
  });

  it("confirms nothing when the release lands outside the pressed entry", () => {
    const h = harness();
    const first = rectOf("title", 0);
    const at = centre(first);
    h.point(
      { kind: "aim", x: at.x, y: at.y },
      { kind: "aim", x: first.x - 40, y: at.y },
      { kind: "release", x: first.x - 40, y: at.y, fromX: at.x, fromY: at.y },
    );
    h.advance(1);
    expect(h.api.snapshot().screen).toBe("title");
    expect(h.api.snapshot().menuIndex).toBe(0);
  });

  it("leaves the keyboard's item confirmed when both arrive on one tick", () => {
    const h = harness();
    const at = centre(rectOf("title", 1));
    h.press("confirm");
    h.point(
      { kind: "aim", x: at.x, y: at.y },
      { kind: "release", x: at.x, y: at.y, fromX: at.x, fromY: at.y },
    );
    h.advance(1);
    // `CROSS`, the entry the keyboard had highlighted, not `HOW TO PLAY`.
    expect(h.api.snapshot().screen).toBe("playing");
  });
});
