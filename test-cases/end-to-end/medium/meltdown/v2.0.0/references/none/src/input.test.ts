// specs/controls.md, resolved. Every key and every press in this build lands in
// `src/input.ts`, so this is where the control vocabulary is measured: what each
// action does, the order `back` resolves in, the region a position falls in, and
// the rule that a press and a release inside ONE region are one interaction.
//
// The rules an interaction reaches — the placement check, the sell refund, the
// wave release — are measured where they live (`src/build.test.ts`,
// `src/sim.test.ts`). What is measured here is that the interaction reaches them
// and that nothing else fires.

import { beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, TOWER_TYPES } from "./constants";
import { applyPointerSample, performAction, regionAt } from "./input";
import type { InputHost } from "./input";
import { addTower, arm } from "./build";
import { centreOf } from "./towers";
import { panelControls } from "./panel";
import { createState, startRun, type MeltdownState } from "./state";
import type { ActionName } from "./constants";

/** A host that records the cues an interaction raised and owns a mute bit. */
function host(): InputHost & { cues: string[]; bit: { muted: boolean } } {
  const cues: string[] = [];
  const bit = { muted: false };
  return {
    cues,
    bit,
    cue: (cue: string) => cues.push(cue),
    setMuted: (muted: boolean) => {
      bit.muted = muted;
    },
    muted: () => bit.muted,
  };
}

let h: ReturnType<typeof host>;

beforeEach(() => {
  h = host();
});

/** A run in live play, in its opening phase. */
function playing(): MeltdownState {
  const state = createState();
  startRun(state);
  state.screen = "playing";
  return state;
}

/** The centre of a rectangle, which is where a press is aimed. */
function centre(rect: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
} {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Press and release at one position, which is one interaction. */
function tap(state: MeltdownState, x: number, y: number): void {
  applyPointerSample(state, { type: "down", x, y }, h);
  applyPointerSample(state, { type: "up", x, y }, h);
}

/** Perform one action on the state. */
function act(state: MeltdownState, action: ActionName): void {
  performAction(state, action, h);
}

// ---- The actions --------------------------------------------------------

describe("the menu actions", () => {
  it("moves the highlight back and on, on either axis", () => {
    const state = createState();
    act(state, "down");
    expect(state.menuIndex).toBe(1);
    act(state, "up");
    expect(state.menuIndex).toBe(0);
    act(state, "right");
    expect(state.menuIndex).toBe(1);
    act(state, "left");
    expect(state.menuIndex).toBe(0);
  });

  it("cues each move of the highlight", () => {
    const state = createState();
    act(state, "down");
    act(state, "up");
    expect(h.cues).toEqual(["menu", "menu"]);
  });

  it("takes the highlighted row on confirm", () => {
    const state = createState();
    state.menuIndex = 0;
    act(state, "confirm");
    expect(state.screen).toBe("modeselect");
  });
});

describe("pause", () => {
  it("opens the pause screen from live play and returns from it", () => {
    const state = playing();
    act(state, "pause");
    expect(state.screen).toBe("paused");
    expect(state.menuIndex).toBe(0);
    act(state, "pause");
    expect(state.screen).toBe("playing");
  });

  it("does nothing on a screen that is neither", () => {
    const state = createState();
    act(state, "pause");
    expect(state.screen).toBe("title");
  });
});

describe("mute", () => {
  it("toggles the runtime's bus from any screen, and mirrors it", () => {
    for (const screen of ["title", "playing", "gameover"] as const) {
      const state = createState();
      state.screen = screen;
      act(state, "mute");
      expect(h.bit.muted).toBe(true);
      expect(state.muted).toBe(true);
      act(state, "mute");
      expect(h.bit.muted).toBe(false);
      expect(state.muted).toBe(false);
    }
  });
});

describe("back", () => {
  it("cancels a held placement first, leaving the screen where it is", () => {
    const state = playing();
    arm(state, "arc");
    state.selected = 99;
    act(state, "back");
    expect(state.build).toBeNull();
    expect(state.selected).toBe(99);
    expect(state.screen).toBe("playing");
  });

  it("deselects next, leaving the screen where it is", () => {
    const state = playing();
    addTower(state, "arc", 24, 17, 0);
    state.selected = state.towers[0].id;
    act(state, "back");
    expect(state.selected).toBeNull();
    expect(state.screen).toBe("playing");
  });

  it("pauses from live play once nothing is held or selected", () => {
    const state = playing();
    act(state, "back");
    expect(state.screen).toBe("paused");
  });

  it("leaves the screen otherwise", () => {
    const state = createState();
    state.screen = "modeselect";
    act(state, "back");
    expect(state.screen).toBe("title");
  });
});

describe("the play actions", () => {
  it("arms each of the eight shop types from its own key", () => {
    for (let i = 0; i < TOWER_TYPES.length; i += 1) {
      const state = playing();
      act(state, `arm${i + 1}` as ActionName);
      expect(state.build?.type).toBe(TOWER_TYPES[i]);
    }
  });

  it("arms nothing off the playing screen", () => {
    const state = createState();
    act(state, "arm1");
    expect(state.build).toBeNull();
  });

  it("turns the held preview one step, and changes nothing with none held", () => {
    const state = playing();
    act(state, "rotate");
    expect(state.build).toBeNull();
    arm(state, "arc");
    act(state, "rotate");
    expect(state.build?.rotation).toBe(1);
  });

  it("toggles the speed between 1 and 2, in live play alone", () => {
    const state = playing();
    act(state, "speed");
    expect(state.speed).toBe(2);
    act(state, "speed");
    expect(state.speed).toBe(1);

    state.screen = "paused";
    act(state, "speed");
    expect(state.speed).toBe(1);
  });

  it("begins Wave 1 from the opening phase on send", () => {
    const state = playing();
    expect(state.phase).toBe("opening");
    act(state, "send");
    expect(state.phase).toBe("wave");
  });

  it("sends nothing off the playing screen", () => {
    const state = playing();
    state.screen = "paused";
    act(state, "send");
    expect(state.phase).toBe("opening");
  });

  it("upgrades and sells the selected tower, and nothing with none selected", () => {
    const state = playing();
    addTower(state, "arc", 24, 17, 0);
    const id = state.towers[0].id;
    act(state, "upgrade");
    expect(state.towers[0].level).toBe(1);

    state.selected = id;
    act(state, "upgrade");
    expect(state.towers[0].level).toBe(2);

    act(state, "sell");
    expect(state.towers).toEqual([]);
    expect(h.cues).toContain("sell");
  });

  it("leaves every action defined, so none falls through to a digit", () => {
    const state = playing();
    for (const action of ACTIONS) {
      expect(() => act(state, action)).not.toThrow();
    }
  });
});

// ---- Where a position lands --------------------------------------------

describe("regionAt", () => {
  it("finds a menu row by its rectangle", () => {
    const state = createState();
    expect(regionAt(state, 490, 460)).toEqual({ kind: "menu", index: 1 });
  });

  it("finds the floor in live play, and nothing there otherwise", () => {
    const state = playing();
    // Away from the pause menu's own rows, which are read first.
    expect(regionAt(state, 150, 600)).toEqual({ kind: "floor" });
    state.screen = "paused";
    expect(regionAt(state, 150, 600)).toBeNull();
  });

  it("finds nothing on the casing, which is not the floor", () => {
    const state = playing();
    expect(regionAt(state, 4, 300)).toBeNull();
    expect(regionAt(state, 400, 712)).toBeNull();
  });

  it("finds a shop entry and a named control in the panel", () => {
    const state = playing();
    const controls = panelControls(state);
    const shop = centre(controls.shop[3]);
    expect(regionAt(state, shop.x, shop.y)).toEqual({
      kind: "shop",
      type: "flak",
    });
    const send = centre(controls.send);
    expect(regionAt(state, send.x, send.y)).toEqual({
      kind: "control",
      name: "send",
    });
  });

  it("finds nothing in the panel's strip on a screen that draws no panel", () => {
    const state = createState();
    const send = centre(panelControls(state).send);
    expect(regionAt(state, send.x, send.y)).toBeNull();
  });

  it("finds the panel's controls while paused, because the panel is drawn", () => {
    const state = playing();
    state.screen = "paused";
    const pause = centre(panelControls(state).pause);
    expect(regionAt(state, pause.x, pause.y)).toEqual({
      kind: "control",
      name: "pause",
    });
  });

  it("finds nothing on a control the panel is not offering", () => {
    const state = playing();
    // Nothing armed and nothing selected: rotate, cancel, upgrade and sell are
    // all absent, so their strip of the panel answers to nothing.
    arm(state, "arc");
    const rotate = centre(panelControls(state).rotate!);
    state.build = null;
    expect(regionAt(state, rotate.x, rotate.y)).toBeNull();
  });

  it("finds nothing on bare panel background", () => {
    const state = playing();
    expect(regionAt(state, 1000, 60)).toBeNull();
  });
});

// ---- The pointer reaching a menu row -----------------------------------

describe("moving the pointer onto a menu row", () => {
  it("highlights it and raises the menu cue, without taking it", () => {
    const state = createState();
    applyPointerSample(state, { type: "move", x: 490, y: 460 }, h);
    expect(state.menuIndex).toBe(1);
    expect(state.screen).toBe("title");
    expect(h.cues).toEqual(["menu"]);
  });

  it("raises nothing when it reaches the row already highlighted", () => {
    const state = createState();
    state.menuIndex = 1;
    applyPointerSample(state, { type: "move", x: 490, y: 460 }, h);
    expect(state.menuIndex).toBe(1);
    expect(h.cues).toEqual([]);
  });

  it("leaves the highlight where it last landed when it moves off", () => {
    const state = createState();
    applyPointerSample(state, { type: "move", x: 490, y: 460 }, h);
    applyPointerSample(state, { type: "move", x: 40, y: 40 }, h);
    expect(state.menuIndex).toBe(1);
    expect(state.screen).toBe("title");
    expect(h.cues).toEqual(["menu"]);
  });
});

// ---- One press, one interaction ---------------------------------------

describe("a press and a release", () => {
  it("takes a menu row that both landed in", () => {
    const state = createState();
    tap(state, 490, 460);
    // Row 1 of the title menu is HOW TO PLAY: the highlight moved to it, which
    // cued, and confirm took it.
    expect(state.screen).toBe("howto");
    expect(h.cues).toContain("menu");
  });

  it("takes nothing when the release lands in another row", () => {
    const state = createState();
    applyPointerSample(state, { type: "down", x: 490, y: 460 }, h);
    applyPointerSample(state, { type: "up", x: 490, y: 410 }, h);
    expect(state.screen).toBe("title");
  });

  it("takes nothing when the release lands nowhere at all", () => {
    const state = createState();
    applyPointerSample(state, { type: "down", x: 490, y: 460 }, h);
    applyPointerSample(state, { type: "up", x: 40, y: 40 }, h);
    expect(state.screen).toBe("title");
  });

  it("arms a shop entry and marks it hovered", () => {
    const state = playing();
    const shop = centre(panelControls(state).shop[1]);
    tap(state, shop.x, shop.y);
    expect(state.build?.type).toBe("stutter");
    expect(state.hoverShop).toBe("stutter");
  });

  it("operates each panel control it lands in", () => {
    const state = playing();
    const speed = centre(panelControls(state).speed);
    tap(state, speed.x, speed.y);
    expect(state.speed).toBe(2);

    const pause = centre(panelControls(state).pause);
    tap(state, pause.x, pause.y);
    expect(state.screen).toBe("paused");

    const mute = centre(panelControls(state).mute);
    tap(state, mute.x, mute.y);
    expect(h.bit.muted).toBe(true);
  });

  it("cancels a held placement from the panel", () => {
    const state = playing();
    arm(state, "arc");
    const cancel = centre(panelControls(state).cancel!);
    tap(state, cancel.x, cancel.y);
    expect(state.build).toBeNull();
  });

  it("turns the held preview from the panel", () => {
    const state = playing();
    arm(state, "arc");
    const rotate = centre(panelControls(state).rotate!);
    tap(state, rotate.x, rotate.y);
    expect(state.build?.rotation).toBe(1);
  });

  it("upgrades and sells the selected tower from the panel", () => {
    const state = playing();
    addTower(state, "arc", 24, 17, 0);
    state.selected = state.towers[0].id;
    const upgrade = centre(panelControls(state).upgrade!);
    tap(state, upgrade.x, upgrade.y);
    expect(state.towers[0].level).toBe(2);

    const sell = centre(panelControls(state).sell!);
    tap(state, sell.x, sell.y);
    expect(state.towers).toEqual([]);
  });

  it("sends the next wave from the panel", () => {
    const state = playing();
    const send = centre(panelControls(state).send);
    tap(state, send.x, send.y);
    expect(state.phase).toBe("wave");
  });

  it("places the held tower on a valid footprint", () => {
    const state = playing();
    arm(state, "arc");
    const spent = state.money;
    tap(state, 400, 300);
    expect(state.towers).toHaveLength(1);
    expect(state.money).toBeLessThan(spent);
    expect(h.cues).toContain("place");
  });

  it("selects a placed tower with nothing armed, and deselects off it", () => {
    const state = playing();
    const tower = addTower(state, "arc", 20, 15, 0);
    const at = centreOf(tower);
    tap(state, at.x, at.y);
    expect(state.selected).toBe(tower.id);

    tap(state, 900, 660);
    expect(state.selected).toBeNull();
  });

  it("resolves nothing on the floor once the screen has left play", () => {
    const state = playing();
    applyPointerSample(state, { type: "down", x: 400, y: 300 }, h);
    state.screen = "paused";
    applyPointerSample(state, { type: "up", x: 400, y: 300 }, h);
    expect(state.selected).toBeNull();
    expect(state.towers).toEqual([]);
  });

  it("arms nothing from a shop entry once the screen has left play", () => {
    const state = playing();
    const shop = centre(panelControls(state).shop[0]);
    applyPointerSample(state, { type: "down", x: shop.x, y: shop.y }, h);
    state.screen = "paused";
    applyPointerSample(state, { type: "up", x: shop.x, y: shop.y }, h);
    expect(state.build).toBeNull();
  });
});

describe("a move", () => {
  it("carries the pointer's position onto the state", () => {
    const state = playing();
    applyPointerSample(state, { type: "move", x: 123, y: 456 }, h);
    expect(state.pointer).toMatchObject({ x: 123, y: 456 });
  });

  it("drags the held preview over the floor and not over the panel", () => {
    const state = playing();
    arm(state, "arc");
    applyPointerSample(state, { type: "move", x: 400, y: 300 }, h);
    const onFloor = { ...state.build! };
    applyPointerSample(state, { type: "move", x: 1100, y: 300 }, h);
    expect(state.build).toMatchObject({
      col: onFloor.col,
      row: onFloor.row,
    });
  });

  it("marks a shop entry hovered and clears the hover off every one", () => {
    const state = playing();
    const shop = centre(panelControls(state).shop[5]);
    applyPointerSample(state, { type: "move", x: shop.x, y: shop.y }, h);
    expect(state.hoverShop).toBe("lance");
    applyPointerSample(state, { type: "move", x: 1000, y: 60 }, h);
    expect(state.hoverShop).toBeNull();
  });

  it("arms nothing and selects nothing by hovering", () => {
    const state = playing();
    const shop = centre(panelControls(state).shop[0]);
    applyPointerSample(state, { type: "move", x: shop.x, y: shop.y }, h);
    expect(state.build).toBeNull();
    expect(state.selected).toBeNull();
  });

  it("leaves the hover alone on a screen that draws no panel", () => {
    const state = createState();
    state.hoverShop = "rime";
    applyPointerSample(state, { type: "move", x: 1100, y: 200 }, h);
    expect(state.hoverShop).toBe("rime");
  });

  it("reports the pointer as pressed between the down and the up", () => {
    const state = playing();
    applyPointerSample(state, { type: "down", x: 400, y: 300 }, h);
    expect(state.pointer.down).toBe(true);
    applyPointerSample(state, { type: "up", x: 400, y: 300 }, h);
    expect(state.pointer.down).toBe(false);
  });
});
