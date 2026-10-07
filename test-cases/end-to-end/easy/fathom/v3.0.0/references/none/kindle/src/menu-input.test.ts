// The menus under a pointer, a finger, and the pause control (`specs/ui.md`).
//
// Each gesture is delivered as the runtime's pointer layer delivers one: samples
// in logical units, read by the tick that follows them.

import { beforeEach, describe, expect, it } from "vitest";

import { TITLE_ITEMS } from "./constants";
import { itemRect } from "./menu";
import { harness, type Harness } from "./harness.test-support";
import type { Screen } from "./types";

const DIVE = 0;
const HOWTO = 1;

/** The middle of the region the build draws item `index` of `screen` in. */
function middle(screen: Screen, index: number): { x: number; y: number } {
  const rect = itemRect(screen, index);
  if (rect === null) throw new Error(`no region for ${screen} item ${index}`);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

describe("the menus under a pointer", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("selects the item the pointer moves onto, confirming nothing", () => {
    const at = middle("title", HOWTO);
    h.point("move", at.x, at.y);
    h.advance(1);
    expect(h.state.menu).toBe(HOWTO);
    expect(h.state.screen).toBe("title");
  });

  it("confirms the item a press and a release land inside", () => {
    const at = middle("title", HOWTO);
    h.point("down", at.x, at.y);
    h.advance(1);
    h.point("up", at.x, at.y);
    h.advance(1);
    expect(h.state.screen).toBe("howto");
  });

  it("confirms nothing when the two edges fall in different items", () => {
    const from = middle("title", HOWTO);
    const to = middle("title", DIVE);
    h.point("down", from.x, from.y);
    h.advance(1);
    h.point("move", to.x, to.y);
    h.point("up", to.x, to.y);
    h.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menu).toBe(DIVE);
  });

  it("confirms nothing when an edge falls outside every item", () => {
    const at = middle("title", HOWTO);
    h.point("down", at.x, at.y);
    h.advance(1);
    h.point("up", 4, 4);
    h.advance(1);
    expect(h.state.screen).toBe("title");
  });
});

describe("the menus under a finger", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("selects the item a contact lands on, without lifting", () => {
    const at = middle("title", HOWTO);
    h.point("down", at.x, at.y, "touch");
    h.advance(1);
    expect(h.state.menu).toBe(HOWTO);
    expect(h.state.screen).toBe("title");
  });

  it("confirms the item a contact lands and lifts inside", () => {
    const at = middle("title", HOWTO);
    h.point("down", at.x, at.y, "touch");
    h.point("up", at.x, at.y, "touch");
    h.advance(1);
    expect(h.state.screen).toBe("howto");
  });

  it("follows a contact that travels, and confirms nothing where it lifts", () => {
    const from = middle("title", DIVE);
    const to = middle("title", HOWTO);
    h.point("down", from.x, from.y, "touch");
    h.point("move", to.x, to.y, "touch");
    h.point("up", to.x, to.y, "touch");
    h.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menu).toBe(HOWTO);
  });
});

describe("the remembered title selection", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("opens on DIVE with nothing yet confirmed", () => {
    expect(h.state.titleIndex).toBe(0);
    expect(h.state.menu).toBe(DIVE);
  });

  it("records the entry a confirm took, however it was raised", () => {
    const at = middle("title", HOWTO);
    h.point("down", at.x, at.y, "touch");
    h.point("up", at.x, at.y, "touch");
    h.advance(1);
    expect(h.state.titleIndex).toBe(HOWTO);
    h.press("back");
    h.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menu).toBe(HOWTO);
  });

  it("keeps the record across the return a quit puts the dive back by", () => {
    h.press("down");
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    h.press("back");
    h.advance(1);
    expect(h.state.titleIndex).toBe(HOWTO);
    expect(TITLE_ITEMS[h.state.menu]).toBe("HOW TO PLAY");
  });
});

describe("the pause control on the pause menu", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    h.state.screen = "playing";
  });

  it("resumes on the pause control, and once only", () => {
    h.press("pause");
    h.advance(1);
    expect(h.state.screen).toBe("paused");
    h.advance(30);
    expect(h.state.screen).toBe("paused");
    // `Escape` raises both, as a real key does.
    h.press("pause");
    h.press("back");
    h.advance(1);
    expect(h.state.screen).toBe("playing");
    h.advance(30);
    expect(h.state.screen).toBe("playing");
  });

  it("resumes on the pause control alone", () => {
    h.press("pause");
    h.advance(1);
    h.press("pause");
    h.advance(1);
    expect(h.state.screen).toBe("playing");
  });

  it("changes nothing on the title", () => {
    h.state.screen = "title";
    h.state.menu = HOWTO;
    h.press("back");
    h.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menu).toBe(HOWTO);
  });
});
