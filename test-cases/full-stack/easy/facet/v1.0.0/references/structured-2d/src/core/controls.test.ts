// Taking hold of a gem, offering it, and letting go, and working a screen's
// pointer targets (specs/controls.md).

import { describe, expect, it } from "vitest";
import { GEM_HIT_R, TITLE_ITEMS } from "../constants";
import { cellX, cellY, formatBoard } from "./board";
import {
  offerCell,
  pointerDown,
  pointerMove,
  pointerUp,
  pressCell,
  releaseBoard,
} from "./controls";
import { loadBoard, setScreen } from "./debug";
import { quietRowsWith } from "./fixtures";
import { goBack } from "./flow";
import { targetsFor } from "./targets";
import { createInitialState, type FacetState, type Screen } from "./state";

const title = () => createInitialState(1);

const play = (edits: Readonly<Record<string, string>> = {}): FacetState =>
  setScreen(loadBoard(createInitialState(1), quietRowsWith(edits)), "playing");

/** The swap that drops a third ruby into (3, 4), making a row run of three. */
const ROW_RUN = { "3,3": "R0", "4,4": "R0" };

const press = (state: FacetState, col: number, row: number) =>
  pointerDown(state, cellX(col), cellY(row));

const drag = (state: FacetState, col: number, row: number) =>
  pointerMove(state, cellX(col), cellY(row));

/** The center of one of a screen's targets, which is where a player aims. */
const centerOf = (screen: Screen, id: string) => {
  const target = targetsFor(screen).find((one) => one.id === id);
  if (!target) throw new Error(`no ${id} target on ${screen}`);
  return { x: target.x + target.w / 2, y: target.y + target.h / 2 };
};

describe("the five rows of the press table", () => {
  it("selects a cell while nothing is selected", () => {
    const acted = pressCell(play(), { col: 3, row: 3 });
    expect(acted.state.selection).toEqual({ col: 3, row: 3 });
    expect(acted.state.offer).toBeNull();
    expect(acted.events.select).toBe(true);
  });

  it("takes hold of the selected cell again, withdrawing any offer", () => {
    const held = { ...play(), selection: { col: 3, row: 3 } };
    const offered = pressCell(held, { col: 3, row: 4 }).state;
    expect(offered.offer).toEqual({ col: 3, row: 4 });
    const back = pressCell(offered, { col: 3, row: 3 });
    expect(back.state.selection).toEqual({ col: 3, row: 3 });
    expect(back.state.offer).toBeNull();
    expect(back.events.select).toBe(false);
  });

  it("offers the held gem into an orthogonally adjacent cell", () => {
    const held = pressCell(play(ROW_RUN), { col: 3, row: 3 }).state;
    const acted = pressCell(held, { col: 3, row: 4 });
    // Nothing reaches the move rules: the release is what plays a move.
    expect(acted.state.selection).toEqual({ col: 3, row: 3 });
    expect(acted.state.offer).toEqual({ col: 3, row: 4 });
    expect(acted.state.phase).toBe("idle");
    expect(acted.events.swap).toBe(false);
    expect(acted.events.select).toBe(false);
  });

  it("moves the selection to any other cell, with no offer standing", () => {
    const held = pressCell(play(), { col: 0, row: 0 }).state;
    const acted = pressCell(held, { col: 5, row: 5 });
    expect(acted.state.selection).toEqual({ col: 5, row: 5 });
    expect(acted.state.offer).toBeNull();
    expect(acted.events.select).toBe(true);
  });

  it("does not treat a diagonal neighbor as adjacent", () => {
    const held = pressCell(play(), { col: 3, row: 3 }).state;
    const acted = pressCell(held, { col: 4, row: 4 });
    expect(acted.state.selection).toEqual({ col: 4, row: 4 });
    expect(acted.state.offer).toBeNull();
  });

  it("clears the selection and the offer on a press targeting no cell", () => {
    const offered = {
      ...play(),
      selection: { col: 3, row: 3 },
      offer: { col: 3, row: 4 },
    };
    const acted = pressCell(offered, null);
    expect(acted.state.selection).toBeNull();
    expect(acted.state.offer).toBeNull();
    expect(formatBoard(acted.state.board)).toEqual(formatBoard(offered.board));
  });
});

describe("the move table, read against the cell being held", () => {
  const held = () => pressCell(play(ROW_RUN), { col: 3, row: 3 }).state;

  it("offers the held gem into a neighbor the pointer reaches", () => {
    expect(offerCell(held(), { col: 3, row: 4 }).offer).toEqual({
      col: 3,
      row: 4,
    });
  });

  it("withdraws the offer when the pointer comes back to the held cell", () => {
    const offered = offerCell(held(), { col: 3, row: 4 });
    expect(offerCell(offered, { col: 3, row: 3 }).offer).toBeNull();
  });

  it("replaces one offer with another rather than keeping both", () => {
    const offered = offerCell(held(), { col: 3, row: 4 });
    expect(offerCell(offered, { col: 2, row: 3 }).offer).toEqual({
      col: 2,
      row: 3,
    });
  });

  it("changes nothing over a farther cell, or over no cell at all", () => {
    const offered = offerCell(held(), { col: 3, row: 4 });
    expect(offerCell(offered, { col: 6, row: 6 })).toBe(offered);
    expect(offerCell(offered, null)).toBe(offered);
    // With nothing held there is nothing to offer.
    expect(offerCell(play(), { col: 3, row: 4 }).offer).toBeNull();
  });
});

describe("the release, which is what plays a move", () => {
  it("requests the swap of the held cell with the offered one", () => {
    const held = pressCell(play(ROW_RUN), { col: 3, row: 3 }).state;
    const offered = offerCell(held, { col: 3, row: 4 });
    const released = releaseBoard(offered);
    expect(released.state.phase).toBe("swapping");
    expect(released.state.selection).toBeNull();
    expect(released.state.offer).toBeNull();
    expect(released.events.swap).toBe(true);
  });

  it("plays nothing at all when no offer stands", () => {
    const held = pressCell(play(ROW_RUN), { col: 3, row: 3 }).state;
    const released = releaseBoard(held);
    expect(released.state).toBe(held);
    expect(released.state.selection).toEqual({ col: 3, row: 3 });
  });

  it("plays nothing for a gem carried onto a neighbor and back again", () => {
    const held = pressCell(play(ROW_RUN), { col: 3, row: 3 }).state;
    const carried = offerCell(offerCell(held, { col: 3, row: 4 }), {
      col: 3,
      row: 3,
    });
    const released = releaseBoard(carried);
    expect(released.state.phase).toBe("idle");
    expect(formatBoard(released.state.board)).toEqual(formatBoard(held.board));
    expect(released.events.swap).toBe(false);
  });

  it("marks a refusal when the swap the release requests is refused", () => {
    const held = pressCell(play(), { col: 3, row: 3 }).state;
    const released = releaseBoard(offerCell(held, { col: 3, row: 4 }));
    expect(released.state.refusal).toEqual({
      a: { col: 3, row: 3 },
      b: { col: 3, row: 4 },
    });
    expect(released.events.refuse).toBe(true);
  });
});

describe("the pointer over the board", () => {
  it("records the pointer, and the device that drove it, on every screen", () => {
    const touched = pointerDown(title(), 100, 200, "touch").state;
    expect(touched.pointer).toEqual({
      x: 100,
      y: 200,
      down: true,
      device: "touch",
    });
    expect(touched.selection).toBeNull();
    const moved = pointerMove(touched, 110, 210, "pen").state;
    expect(moved.pointer).toEqual({
      x: 110,
      y: 210,
      down: true,
      device: "pen",
    });
    const lifted = pointerUp(moved, "pen").state;
    expect(lifted.pointer.down).toBe(false);
    // A mouse is what the three assume when no device is named.
    expect(pointerDown(title(), 0, 0).state.pointer.device).toBe("mouse");
  });

  it("plays a whole move from a press, a drag, and a release", () => {
    const pressed = press(play(ROW_RUN), 3, 3).state;
    expect(pressed.selection).toEqual({ col: 3, row: 3 });
    const dragged = drag(pressed, 3, 4).state;
    expect(dragged.offer).toEqual({ col: 3, row: 4 });
    expect(dragged.phase).toBe("idle");
    const released = pointerUp(dragged);
    expect(released.state.phase).toBe("swapping");
    expect(released.state.selection).toBeNull();
    expect(released.events.swap).toBe(true);
  });

  it("plays a whole move from two presses and a release", () => {
    const first = press(play(ROW_RUN), 3, 3).state;
    const second = press(first, 3, 4).state;
    expect(second.offer).toEqual({ col: 3, row: 4 });
    expect(pointerUp(second).state.phase).toBe("swapping");
  });

  it("undoes a move by carrying the gem back before letting go", () => {
    const pressed = press(play(ROW_RUN), 3, 3).state;
    const out = drag(pressed, 3, 4).state;
    const back = drag(out, 3, 3).state;
    expect(back.offer).toBeNull();
    const released = pointerUp(back);
    expect(released.state.phase).toBe("idle");
    expect(formatBoard(released.state.board)).toEqual(
      formatBoard(pressed.board),
    );
  });

  it("changes nothing when the press is farther than GEM_HIT_R away", () => {
    const before = play();
    const pressed = pointerDown(before, 20, 20);
    expect(pressed.state.selection).toBeNull();
    expect(pressed.state.offer).toBeNull();
    expect(pressed.state.pointer.down).toBe(true);
    expect(formatBoard(pressed.state.board)).toEqual(formatBoard(before.board));
  });

  it("does not offer while the pointer is up", () => {
    const released = pointerUp(press(play(ROW_RUN), 3, 3).state).state;
    const moved = pointerMove(released, cellX(3), cellY(4));
    expect(moved.state.offer).toBeNull();
    expect(moved.state.phase).toBe("idle");
    expect(moved.state.pointer.x).toBe(cellX(3));
  });

  it("targets the nearest center, and nothing beyond GEM_HIT_R", () => {
    // Inside the grid every point is within GEM_HIT_R of some center, since
    // GEM_HIT_R is half of CELL_PITCH; the margin around the board is not.
    const inside = pointerDown(play(), cellX(4) + GEM_HIT_R - 1, cellY(4));
    expect(inside.state.selection).toEqual({ col: 4, row: 4 });
    const beyond = pointerDown(play(), cellX(7) + GEM_HIT_R + 1, cellY(4));
    expect(beyond.state.selection).toBeNull();
    const above = pointerDown(play(), cellX(4), cellY(0) - GEM_HIT_R - 1);
    expect(above.state.selection).toBeNull();
  });
});

describe("the pointer over a screen's targets", () => {
  it("highlights the menu item a hover crosses", () => {
    const second = centerOf("title", "menu-1");
    const hovered = pointerMove(title(), second.x, second.y).state;
    expect(hovered.menuIndex).toBe(1);
    expect(hovered.armedTarget).toBeNull();
  });

  it("highlights and arms on a press, so a finger sees what it will take", () => {
    const second = centerOf("title", "menu-1");
    const pressed = pointerDown(title(), second.x, second.y, "touch").state;
    expect(pressed.menuIndex).toBe(1);
    expect(pressed.armedTarget).toBe("menu-1");
    expect(pressed.screen).toBe("title");
  });

  it("takes the target a release lands back inside", () => {
    const second = centerOf("title", "menu-1");
    const pressed = pointerDown(title(), second.x, second.y).state;
    const taken = pointerUp(pressed).state;
    expect(TITLE_ITEMS[1]).toBe("HOW TO PLAY");
    expect(taken.screen).toBe("howto");
    expect(taken.armedTarget).toBeNull();
  });

  it("takes nothing from a release that wandered off the armed target", () => {
    const second = centerOf("title", "menu-1");
    const pressed = pointerDown(title(), second.x, second.y).state;
    const away = pointerMove(pressed, 40, 40).state;
    const released = pointerUp(away).state;
    expect(released.screen).toBe("title");
    expect(released.armedTarget).toBeNull();
  });

  it("leaves the highlight alone while a press is held elsewhere", () => {
    const first = centerOf("title", "menu-0");
    const second = centerOf("title", "menu-1");
    const pressed = pointerDown(title(), first.x, first.y).state;
    const dragged = pointerMove(pressed, second.x, second.y).state;
    // The press armed menu-0, so only the release decides, and the highlight
    // stays on the item that release would take.
    expect(dragged.menuIndex).toBe(0);
    expect(dragged.armedTarget).toBe("menu-0");
  });

  it("takes nothing from a press carried across a screen change", () => {
    const over = { ...play(), screen: "gameover" } as FacetState;
    const item = centerOf("gameover", "menu-0");
    const pressed = pointerDown(over, item.x, item.y).state;
    expect(pressed.armedTarget).toBe("menu-0");
    // Leaving the screen disarms, even though the title's own menu-0 covers
    // the position the release lands at.
    const left = goBack(pressed);
    expect(left.screen).toBe("title");
    expect(left.armedTarget).toBeNull();
    expect(pointerUp(left).state.screen).toBe("title");
  });

  it("works the board's pause control without touching a gem", () => {
    const pause = centerOf("playing", "pause");
    const pressed = pointerDown(play(), pause.x, pause.y, "touch").state;
    expect(pressed.armedTarget).toBe("pause");
    expect(pressed.selection).toBeNull();
    const paused = pointerUp(pressed, "touch").state;
    expect(paused.screen).toBe("paused");
    expect(paused.menuIndex).toBe(0);
  });

  it("works how to play's back control", () => {
    const howto = { ...title(), screen: "howto" } as FacetState;
    const back = centerOf("howto", "back");
    const pressed = pointerDown(howto, back.x, back.y).state;
    expect(pressed.armedTarget).toBe("back");
    const left = pointerUp(pressed).state;
    expect(left.screen).toBe("title");
    expect(left.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });

  it("takes the level-clear menu's CONTINUE by pointer alone", () => {
    const cleared = { ...play(), screen: "levelclear" } as FacetState;
    const item = centerOf("levelclear", "menu-0");
    const taken = pointerUp(
      pointerDown(cleared, item.x, item.y, "touch").state,
      "touch",
    ).state;
    expect(taken.screen).toBe("playing");
    expect(taken.level).toBe(2);
  });
});
