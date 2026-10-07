// The pointer: what a press lifts, what a release decides, and every control.

import { beforeEach, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  CUES,
  DOUBLE_CLICK_WINDOW,
  DRAG_THRESHOLD,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  TURN_COUNT,
} from "./constants";
import {
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./menus";
import { openingState } from "./flow";
import { columnCardTops, wasteFanX } from "./layout";
import { moveTo, pressAt, releaseAt } from "./pointer";
import { takeId, toSim, type MutCard, type Sim } from "./sim";
import type { PileKind, Suit } from "./game";

function newSim(): Sim {
  const sim = toSim(openingState());
  sim.screen = "playing";
  return sim;
}

function put(
  sim: Sim,
  pile: PileKind,
  index: number,
  suit: Suit,
  rank: number,
  faceUp = true,
): MutCard {
  const card: MutCard = { id: takeId(sim), suit, rank, faceUp };
  const target =
    pile === "stock"
      ? sim.stock
      : pile === "waste"
        ? sim.waste
        : pile === "foundation"
          ? (sim.foundations[index] as MutCard[])
          : (sim.tableau[index] as MutCard[]);
  target.push(card);
  return card;
}

/** The centre of the card drawn at `row` of column `index`. */
function columnPoint(sim: Sim, index: number, row: number): [number, number] {
  const column = sim.tableau[index] as MutCard[];
  const tops = columnCardTops(column);
  return [(COLUMN_X[index] as number) + CARD_W / 2, (tops[row] as number) + 12];
}

/** A whole press-move-release gesture. */
function gesture(sim: Sim, from: [number, number], to: [number, number]): void {
  pressAt(sim, from[0], from[1]);
  moveTo(sim, to[0], to[1]);
  releaseAt(sim, to[0], to[1]);
}

/** A press and a release at one point. */
function click(sim: Sim, x: number, y: number): void {
  pressAt(sim, x, y);
  releaseAt(sim, x, y);
}

let sim: Sim;
beforeEach(() => {
  sim = newSim();
});

describe("what a press lifts", () => {
  it("takes a column's card and every card below it, on the press itself", () => {
    put(sim, "tableau", 0, "spades", 9, false);
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 0, "clubs", 7);
    put(sim, "tableau", 0, "diamonds", 6);
    const [x, y] = columnPoint(sim, 0, 1);
    pressAt(sim, x, y);
    expect(sim.drag?.cards).toHaveLength(3);
    expect(sim.drag?.fromPile).toBe("tableau");
    expect(sim.tableau[0]).toHaveLength(1);
    expect(sim.pendingCues).toContain(CUES.lift);
  });

  it("takes the waste's top card alone", () => {
    put(sim, "waste", 0, "spades", 5);
    put(sim, "waste", 0, "hearts", 6);
    sim.wasteSets = [2];
    pressAt(sim, wasteFanX(1) + 50, TOP_ROW_Y + 70);
    expect(sim.drag?.cards).toHaveLength(1);
    expect(sim.drag?.fromPile).toBe("waste");
  });

  it("takes a foundation's top card", () => {
    put(sim, "foundation", 2, "spades", 1);
    pressAt(sim, (FOUNDATION_X[2] as number) + 50, TOP_ROW_Y + 70);
    expect(sim.drag?.cards).toHaveLength(1);
    expect(sim.drag?.fromPile).toBe("foundation");
  });

  it("takes nothing from a face-down card, the bare table or the stock", () => {
    put(sim, "tableau", 3, "spades", 9, false);
    pressAt(sim, ...columnPoint(sim, 3, 0));
    expect(sim.drag).toBeNull();

    releaseAt(sim, ...columnPoint(sim, 3, 0));
    pressAt(sim, 40, 400);
    expect(sim.drag).toBeNull();

    releaseAt(sim, 40, 400);
    put(sim, "stock", 0, "hearts", 4, false);
    pressAt(sim, STOCK_X + 50, TOP_ROW_Y + 70);
    expect(sim.drag).toBeNull();
  });

  it("takes nothing from a waste card behind the front one", () => {
    put(sim, "waste", 0, "spades", 5);
    put(sim, "waste", 0, "hearts", 6);
    put(sim, "waste", 0, "clubs", 7);
    sim.wasteSets = [3];
    pressAt(sim, wasteFanX(0) + 10, TOP_ROW_Y + 70);
    expect(sim.drag).toBeNull();
  });
});

describe("the run in hand", () => {
  beforeEach(() => {
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 1, "spades", 7);
  });

  it("travels exactly as far as the pointer does", () => {
    pressAt(sim, ...columnPoint(sim, 1, 0));
    expect(sim.drag?.x).toBe(COLUMN_X[1] as number);
    moveTo(sim, (COLUMN_X[1] as number) + CARD_W / 2 + 40, TABLEAU_Y + 60);
    expect(sim.drag?.x).toBe((COLUMN_X[1] as number) + 40);
  });

  it("reports a legal target under it and no illegal one", () => {
    const [px, py] = columnPoint(sim, 1, 0);
    pressAt(sim, px, py);
    moveTo(sim, px - 122, py);
    expect(sim.dropTarget).toEqual({ pile: "tableau", index: 0 });
    moveTo(sim, px - 122 + 244, py);
    expect(sim.dropTarget).toBeNull();
  });

  it("lands on a legal target and leaves its source", () => {
    const [px, py] = columnPoint(sim, 1, 0);
    gesture(sim, [px, py], [px - 122, py]);
    expect(sim.tableau[0]).toHaveLength(2);
    expect(sim.tableau[1]).toHaveLength(0);
    expect(sim.drag).toBeNull();
    expect(sim.pendingCues).toContain(CUES.drop);
  });

  it("returns to its source over a pile that refuses it", () => {
    const [px, py] = columnPoint(sim, 1, 0);
    gesture(sim, [px, py], [px + 400, TOP_ROW_Y + 70]);
    expect(sim.tableau[1]).toHaveLength(1);
    expect(sim.pendingCues).toContain(CUES.reject);
  });

  it("returns to its source over no pile at all", () => {
    const [px, py] = columnPoint(sim, 1, 0);
    gesture(sim, [px, py], [px - 200, py]);
    expect(sim.tableau[1]).toHaveLength(1);
    expect(sim.drag).toBeNull();
  });

  it("resolves by where the leading card's centre lies, not by overlap", () => {
    // Moved one whole column pitch left, the card overlaps nothing else and its
    // centre sits inside column 0's rectangle.
    const [px, py] = columnPoint(sim, 1, 0);
    gesture(sim, [px, py], [px - 122, py]);
    expect(sim.tableau[0]).toHaveLength(2);
  });

  it("leaves an empty column empty when it refuses the run", () => {
    const [px, py] = columnPoint(sim, 1, 0);
    gesture(sim, [px, py], [px + 122 * 2, py]);
    expect(sim.tableau[3]).toHaveLength(0);
    expect(sim.tableau[1]).toHaveLength(1);
  });
});

describe("a click and a drop", () => {
  it("treats a release inside the threshold as a click", () => {
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 1, "spades", 7);
    const [px, py] = columnPoint(sim, 1, 0);
    gesture(sim, [px, py], [px - DRAG_THRESHOLD + 1, py]);
    expect(sim.tableau[1]).toHaveLength(1);
    expect(sim.tableau[0]).toHaveLength(1);
  });

  it("treats a release beyond the threshold as a drop", () => {
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 1, "spades", 7);
    const [px, py] = columnPoint(sim, 1, 0);
    // Six units left, which is past the threshold, but the centre stays inside
    // column 1's own rectangle and column 1 no longer accepts the card.
    gesture(sim, [px, py], [px - DRAG_THRESHOLD - 1, py]);
    expect(sim.tableau[1]).toHaveLength(1);
    expect(sim.pendingCues).toContain(CUES.reject);
  });

  it("turns the stock on a click in its rectangle", () => {
    for (let i = 0; i < 6; i++) put(sim, "stock", 0, "spades", i + 1, false);
    click(sim, STOCK_X + 50, TOP_ROW_Y + 70);
    expect(sim.waste).toHaveLength(TURN_COUNT);
    expect(sim.wasteSets).toEqual([TURN_COUNT]);
  });

  it("recycles on a click in the empty stock's slot", () => {
    put(sim, "waste", 0, "spades", 5);
    put(sim, "waste", 0, "hearts", 6);
    sim.wasteSets = [2];
    click(sim, STOCK_X + 50, TOP_ROW_Y + 70);
    expect(sim.stock).toHaveLength(2);
    expect(sim.waste).toHaveLength(0);
    expect(sim.wasteSets).toEqual([]);
  });

  it("changes nothing on a release with nothing held and nothing under it", () => {
    releaseAt(sim, 60, 400);
    expect(sim.drag).toBeNull();
    expect(sim.tableau.every((c) => c.length === 0)).toBe(true);
  });
});

describe("the double click", () => {
  beforeEach(() => {
    put(sim, "foundation", 0, "spades", 1);
    put(sim, "tableau", 4, "spades", 2);
  });

  it("sends a card home on a quick second press at the same point", () => {
    const [px, py] = columnPoint(sim, 4, 0);
    click(sim, px, py);
    sim.simTime += 0.1;
    pressAt(sim, px, py);
    expect(sim.foundations[0]).toHaveLength(2);
    expect(sim.tableau[4]).toHaveLength(0);
    expect(sim.drag).toBeNull();
  });

  it("does not pair a second press past the window", () => {
    const [px, py] = columnPoint(sim, 4, 0);
    click(sim, px, py);
    sim.simTime += DOUBLE_CLICK_WINDOW + 0.1;
    pressAt(sim, px, py);
    expect(sim.foundations[0]).toHaveLength(1);
    expect(sim.drag?.cards).toHaveLength(1);
  });

  it("does not pair a second press past the slop", () => {
    const [px, py] = columnPoint(sim, 4, 0);
    click(sim, px - 40, py);
    sim.simTime += 0.1;
    pressAt(sim, px, py);
    expect(sim.foundations[0]).toHaveLength(1);
  });

  it("does nothing on two quick presses over bare table", () => {
    click(sim, 60, 420);
    sim.simTime += 0.1;
    click(sim, 60, 420);
    expect(sim.foundations[0]).toHaveLength(1);
    expect(sim.tableau[4]).toHaveLength(1);
  });
});

describe("the controls", () => {
  it("deals and enters play from the title's NEW GAME", () => {
    sim.screen = "title";
    click(sim, TITLE_NEW_GAME.x + 10, TITLE_NEW_GAME.y + 10);
    expect(sim.screen).toBe("playing");
    expect(sim.stock).toHaveLength(24);
  });

  it("opens the how-to screen and returns from it", () => {
    sim.screen = "title";
    click(sim, TITLE_HOW_TO.x + 10, TITLE_HOW_TO.y + 10);
    expect(sim.screen).toBe("howto");
    click(sim, HOWTO_BACK.x + 10, HOWTO_BACK.y + 10);
    expect(sim.screen).toBe("title");
  });

  it("deals from the HUD, returns to the title, and toggles the sound", () => {
    click(sim, HUD_NEW_GAME.x + 10, HUD_NEW_GAME.y + 10);
    expect(sim.screen).toBe("playing");
    expect(sim.stock).toHaveLength(24);

    expect(sim.muted).toBe(false);
    click(sim, HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    expect(sim.muted).toBe(true);
    click(sim, HUD_SOUND.x + 10, HUD_SOUND.y + 10);
    expect(sim.muted).toBe(false);

    click(sim, HUD_MENU.x + 10, HUD_MENU.y + 10);
    expect(sim.screen).toBe("title");
  });

  it("answers a control only on the screen it belongs to", () => {
    click(sim, TITLE_NEW_GAME.x + 10, TITLE_NEW_GAME.y + 10);
    expect(sim.stock).toHaveLength(0);
  });

  it("deals a fresh game on a press over the won screen", () => {
    sim.screen = "won";
    sim.trailStamps = 40;
    sim.launched = 52;
    pressAt(sim, 640, 360);
    expect(sim.screen).toBe("playing");
    expect(sim.stock).toHaveLength(24);
    expect(sim.trailStamps).toBe(0);
    expect(sim.launched).toBe(0);
  });
});

describe("every sample of a frame", () => {
  it("answers a press, a move and a release delivered together", () => {
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 1, "spades", 7);
    const [px, py] = columnPoint(sim, 1, 0);
    pressAt(sim, px, py);
    moveTo(sim, px - 122, py);
    releaseAt(sim, px - 122, py);
    expect(sim.tableau[0]).toHaveLength(2);
  });

  it("puts a run already in hand back before it answers a new press", () => {
    put(sim, "tableau", 1, "spades", 7);
    const [px, py] = columnPoint(sim, 1, 0);
    pressAt(sim, px, py);
    expect(sim.drag).not.toBeNull();
    pressAt(sim, 40, 640 - CARD_H);
    expect(sim.drag).toBeNull();
    expect(sim.tableau[1]).toHaveLength(1);
  });
});
