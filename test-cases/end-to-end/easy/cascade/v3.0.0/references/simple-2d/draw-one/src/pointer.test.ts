import { describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  CUES,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
} from "./constants";
import {
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./layout";
import { makeCard } from "./deck";
import { openingState } from "./flow";
import { columnCardTops } from "./layout";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import { withPile } from "./piles";
import type { CardState, CascadeState, Suit } from "./game";

let ids = 500;
const card = (suit: Suit, rank: number, faceUp = true): CardState =>
  makeCard(ids++, suit, rank, faceUp);

function table(): CascadeState {
  return { ...openingState(), screen: "playing" };
}

/** The centre of a column's lowest card. */
function lowest(state: CascadeState, index: number): { x: number; y: number } {
  const cards = state.tableau[index];
  const tops = columnCardTops(cards);
  return {
    x: COLUMN_X[index] + CARD_W / 2,
    y: tops[cards.length - 1] + CARD_H / 2,
  };
}

describe("a press", () => {
  it("lifts a column's card and every card below it, on the press itself", () => {
    const state = withPile(table(), "tableau", 0, [
      card("clubs", 9, false),
      card("spades", 8),
      card("hearts", 7),
    ]);
    const point = {
      x: COLUMN_X[0] + 50,
      y: columnCardTops(state.tableau[0])[1] + 5,
    };
    const outcome = pointerDown(state, point.x, point.y);
    expect(outcome.state.drag?.cards.map((c) => c.rank)).toEqual([8, 7]);
    expect(outcome.state.drag?.fromPile).toBe("tableau");
    expect(outcome.state.tableau[0].map((c) => c.rank)).toEqual([9]);
    expect(outcome.cues).toEqual([CUES.lift]);
  });

  it("lifts the waste's top card alone", () => {
    const state = {
      ...withPile(table(), "waste", 0, [card("spades", 3), card("hearts", 4)]),
      wasteSets: [1, 1],
    };
    const outcome = pointerDown(state, WASTE_X + 50, TOP_ROW_Y + 70);
    expect(outcome.state.drag?.cards).toHaveLength(1);
    expect(outcome.state.drag?.cards[0].rank).toBe(4);
    expect(outcome.state.wasteSets).toEqual([1, 1]);
  });

  it("lifts a foundation's top card", () => {
    const state = withPile(table(), "foundation", 2, [
      card("spades", 1),
      card("spades", 2),
    ]);
    const outcome = pointerDown(state, FOUNDATION_X[2] + 50, TOP_ROW_Y + 70);
    expect(outcome.state.drag?.cards.map((c) => c.rank)).toEqual([2]);
  });

  it("lifts nothing from a face-down card, the stock, or bare table", () => {
    const state = withPile(
      withPile(table(), "tableau", 0, [card("clubs", 9, false)]),
      "stock",
      0,
      [card("hearts", 5, false)],
    );
    expect(
      pointerDown(state, COLUMN_X[0] + 50, TABLEAU_Y + 70).state.drag,
    ).toBeNull();
    expect(
      pointerDown(state, STOCK_X + 50, TOP_ROW_Y + 70).state.drag,
    ).toBeNull();
    expect(pointerDown(state, 20, 400).state.drag).toBeNull();
  });

  it("records its point and the time it arrived at", () => {
    const state = { ...table(), simTime: 4.5 };
    const outcome = pointerDown(state, 200, 300);
    expect(outcome.state.lastPress).toEqual({ x: 200, y: 300, at: 4.5 });
    expect(outcome.state.pointer).toEqual({ x: 200, y: 300, down: true });
  });
});

describe("a held run", () => {
  it("travels exactly as far as the pointer", () => {
    const state = withPile(table(), "tableau", 0, [card("spades", 13)]);
    const held = pointerDown(state, COLUMN_X[0] + 50, TABLEAU_Y + 70).state;
    const start = held.drag;
    const moved = pointerMove(held, COLUMN_X[0] + 90, TABLEAU_Y + 130).state;
    expect(moved.drag?.x).toBe((start?.x ?? 0) + 40);
    expect(moved.drag?.y).toBe((start?.y ?? 0) + 60);
  });

  it("reports the legal pile under its leading card and nothing else", () => {
    const state = withPile(
      withPile(table(), "tableau", 0, [card("spades", 13)]),
      "tableau",
      1,
      [card("hearts", 12)],
    );
    const held = pointerDown(state, COLUMN_X[1] + 50, TABLEAU_Y + 70).state;
    expect(held.dropTarget).toBeNull();
    const over = pointerMove(
      held,
      COLUMN_X[1] + 50 - 122,
      TABLEAU_Y + 70,
    ).state;
    expect(over.dropTarget).toEqual({ pile: "tableau", index: 0 });
  });

  it("reports no target over a pile that would refuse the run", () => {
    const state = withPile(
      withPile(table(), "tableau", 0, [card("clubs", 13)]),
      "tableau",
      1,
      [card("spades", 12)],
    );
    const held = pointerDown(state, COLUMN_X[1] + 50, TABLEAU_Y + 70).state;
    const over = pointerMove(
      held,
      COLUMN_X[1] + 50 - 122,
      TABLEAU_Y + 70,
    ).state;
    expect(over.dropTarget).toBeNull();
  });
});

describe("a release", () => {
  function twoColumns(): CascadeState {
    return withPile(
      withPile(table(), "tableau", 0, [card("spades", 13)]),
      "tableau",
      1,
      [card("hearts", 12)],
    );
  }

  it("within the drag threshold is a click, which returns the run", () => {
    const state = twoColumns();
    const grab = lowest(state, 1);
    let next = pointerDown(state, grab.x, grab.y).state;
    next = pointerMove(next, grab.x - (DRAG_THRESHOLD - 1), grab.y).state;
    const outcome = pointerUp(next, grab.x - (DRAG_THRESHOLD - 1), grab.y);
    expect(outcome.state.drag).toBeNull();
    expect(outcome.state.tableau[1].map((c) => c.rank)).toEqual([12]);
    expect(outcome.state.tableau[0].map((c) => c.rank)).toEqual([13]);
  });

  it("beyond it is a drop, which completes a legal move", () => {
    const state = twoColumns();
    const grab = lowest(state, 1);
    let next = pointerDown(state, grab.x, grab.y).state;
    next = pointerMove(next, grab.x - 122, grab.y).state;
    const outcome = pointerUp(next, grab.x - 122, grab.y);
    expect(outcome.state.tableau[0].map((c) => c.rank)).toEqual([13, 12]);
    expect(outcome.state.tableau[1]).toEqual([]);
    expect(outcome.cues).toContain(CUES.drop);
  });

  it("over an illegal pile returns the run to its column", () => {
    const state = withPile(
      withPile(table(), "tableau", 0, [card("clubs", 13)]),
      "tableau",
      1,
      [card("spades", 12)],
    );
    const grab = lowest(state, 1);
    let next = pointerDown(state, grab.x, grab.y).state;
    next = pointerMove(next, grab.x - 122, grab.y).state;
    const outcome = pointerUp(next, grab.x - 122, grab.y);
    expect(outcome.state.tableau[1].map((c) => c.rank)).toEqual([12]);
    expect(outcome.state.tableau[0]).toHaveLength(1);
    expect(outcome.cues).toEqual([CUES.reject]);
  });

  it("away from every pile returns the run", () => {
    const state = twoColumns();
    const grab = lowest(state, 1);
    let next = pointerDown(state, grab.x, grab.y).state;
    next = pointerMove(next, 60, 400).state;
    const outcome = pointerUp(next, 60, 400);
    expect(outcome.state.tableau[1].map((c) => c.rank)).toEqual([12]);
    expect(outcome.cues).toEqual([CUES.reject]);
  });

  it("with nothing held and no press changes nothing", () => {
    const state = twoColumns();
    const outcome = pointerUp(state, 400, 400);
    expect(outcome.state.tableau).toEqual(state.tableau);
    expect(outcome.state.drag).toBeNull();
    expect(outcome.cues).toEqual([]);
  });
});

describe("the stock's click", () => {
  it("turns cards onto the waste", () => {
    const state = withPile(table(), "stock", 0, [
      card("spades", 3, false),
      card("hearts", 4, false),
    ]);
    const point = { x: STOCK_X + 50, y: TOP_ROW_Y + 70 };
    const pressed = pointerDown(state, point.x, point.y).state;
    const outcome = pointerUp(pressed, point.x, point.y);
    expect(outcome.state.waste).toHaveLength(1);
    expect(outcome.cues).toEqual([CUES.turn]);
  });

  it("recycles when the stock is empty", () => {
    const state = {
      ...withPile(table(), "waste", 0, [card("spades", 3)]),
      wasteSets: [1],
    };
    const point = { x: STOCK_X + 50, y: TOP_ROW_Y + 70 };
    const pressed = pointerDown(state, point.x, point.y).state;
    const outcome = pointerUp(pressed, point.x, point.y);
    expect(outcome.state.stock).toHaveLength(1);
    expect(outcome.state.waste).toEqual([]);
    expect(outcome.cues).toEqual([CUES.recycle]);
  });
});

describe("the double click", () => {
  function acePosed(): CascadeState {
    return withPile(table(), "tableau", 0, [card("spades", 1)]);
  }

  function click(state: CascadeState, x: number, y: number): CascadeState {
    return pointerUp(pointerDown(state, x, y).state, x, y).state;
  }

  it("sends a playable card home", () => {
    const state = acePosed();
    const point = lowest(state, 0);
    const once = click(state, point.x, point.y);
    const twice = click(once, point.x, point.y);
    expect(twice.foundations[0].map((c) => c.rank)).toEqual([1]);
    expect(twice.tableau[0]).toEqual([]);
    expect(twice.drag).toBeNull();
  });

  it("does nothing when the second press is too late", () => {
    const state = acePosed();
    const point = lowest(state, 0);
    const once = click(state, point.x, point.y);
    const later = {
      ...once,
      simTime: once.simTime + DOUBLE_CLICK_WINDOW + 0.1,
    };
    const twice = click(later, point.x, point.y);
    expect(twice.foundations[0]).toEqual([]);
    expect(twice.tableau[0]).toHaveLength(1);
  });

  it("does nothing when the second press is too far away", () => {
    const state = acePosed();
    const point = lowest(state, 0);
    const once = click(state, point.x, point.y);
    // Still on the same card, but past DOUBLE_CLICK_SLOP from the first press.
    const twice = click(once, point.x + DOUBLE_CLICK_SLOP + 20, point.y);
    expect(twice.foundations[0]).toEqual([]);
    expect(twice.tableau[0]).toHaveLength(1);
  });

  it("does nothing on the bare table", () => {
    const state = table();
    const once = click(state, 60, 400);
    const twice = click(once, 60, 400);
    expect(twice.foundations.every((f) => f.length === 0)).toBe(true);
    expect(twice.tableau.every((c) => c.length === 0)).toBe(true);
  });
});

describe("the controls", () => {
  function click(state: CascadeState, x: number, y: number): CascadeState {
    return pointerUp(pointerDown(state, x, y).state, x, y).state;
  }

  it("deals and enters play from the title", () => {
    const start = openingState();
    const next = click(start, TITLE_NEW_GAME.x + 100, TITLE_NEW_GAME.y + 20);
    expect(next.screen).toBe("playing");
    expect(next.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("opens the how-to screen and comes back", () => {
    const start = openingState();
    const howto = click(start, TITLE_HOW_TO.x + 100, TITLE_HOW_TO.y + 20);
    expect(howto.screen).toBe("howto");
    const back = click(howto, 640, 626);
    expect(back.screen).toBe("title");
  });

  it("deals from the HUD and stays on the table", () => {
    const next = click(table(), HUD_NEW_GAME.x + 50, HUD_NEW_GAME.y + 18);
    expect(next.screen).toBe("playing");
    expect(next.stock).toHaveLength(24);
  });

  it("returns to the title from the HUD", () => {
    expect(click(table(), HUD_MENU.x + 50, HUD_MENU.y + 18).screen).toBe(
      "title",
    );
  });

  it("toggles muting from the HUD", () => {
    const muted = click(table(), HUD_SOUND.x + 50, HUD_SOUND.y + 18);
    expect(muted.muted).toBe(true);
    expect(click(muted, HUD_SOUND.x + 50, HUD_SOUND.y + 18).muted).toBe(false);
  });

  it("deals a fresh game on a press on the won screen", () => {
    const state: CascadeState = {
      ...table(),
      screen: "won",
      cascadeDone: true,
      trailStamps: 900,
    };
    const outcome = pointerDown(state, 400, 400);
    expect(outcome.state.screen).toBe("playing");
    expect(outcome.state.trailStamps).toBe(0);
    expect(outcome.state.stock).toHaveLength(24);
    expect(outcome.cues).toEqual([CUES.deal]);
  });
});
