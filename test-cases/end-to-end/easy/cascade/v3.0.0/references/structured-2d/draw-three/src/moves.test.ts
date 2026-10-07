import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DECK_SIZE } from "./constants";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseWaste,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  openTable(h);
});

afterEach(() => {
  h.dispose();
});

describe("a foundation", () => {
  it("takes an Ace onto an empty pile and refuses everything else", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    expect(h.debug.move("tableau", 0, 0, "foundation", 0)).toBe(true);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(1);

    poseColumn(h, 1, [{ suit: "clubs", rank: 2 }]);
    poseColumn(h, 2, [{ suit: "clubs", rank: 13 }]);
    expect(h.debug.move("tableau", 1, 0, "foundation", 1)).toBe(false);
    expect(h.debug.move("tableau", 2, 0, "foundation", 1)).toBe(false);
  });

  it("builds up by one in its own suit, and refuses off-suit and gaps", () => {
    poseFoundation(h, 0, "spades", 3);
    poseColumn(h, 0, [{ suit: "spades", rank: 4 }]);
    poseColumn(h, 1, [{ suit: "clubs", rank: 4 }]);
    poseColumn(h, 2, [{ suit: "spades", rank: 5 }]);
    poseColumn(h, 3, [{ suit: "spades", rank: 2 }]);

    expect(h.debug.move("tableau", 1, 0, "foundation", 0)).toBe(false);
    expect(h.debug.move("tableau", 2, 0, "foundation", 0)).toBe(false);
    expect(h.debug.move("tableau", 3, 0, "foundation", 0)).toBe(false);
    expect(h.debug.move("tableau", 0, 0, "foundation", 0)).toBe(true);
  });

  it("is complete at thirteen cards and then takes nothing", () => {
    poseFoundation(h, 0, "spades", 12);
    poseColumn(h, 0, [{ suit: "spades", rank: 13 }]);
    expect(h.debug.move("tableau", 0, 0, "foundation", 0)).toBe(true);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(13);

    poseColumn(h, 1, [{ suit: "hearts", rank: 1 }]);
    expect(h.debug.move("tableau", 1, 0, "foundation", 0)).toBe(false);
  });

  it("locks to its suit once it holds a card", () => {
    poseFoundation(h, 0, "spades", 1);
    poseColumn(h, 0, [{ suit: "clubs", rank: 2 }]);
    poseColumn(h, 1, [{ suit: "spades", rank: 2 }]);
    expect(h.debug.move("tableau", 0, 0, "foundation", 0)).toBe(false);
    expect(h.debug.move("tableau", 1, 0, "foundation", 0)).toBe(true);
  });

  it("takes any suit on any empty slot", () => {
    poseColumn(h, 0, [{ suit: "clubs", rank: 1 }]);
    expect(h.debug.move("tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(h.debug.snapshot().foundations[3][0].suit).toBe("clubs");
  });

  it("refuses a run whose leading card alone would be accepted", () => {
    poseColumn(h, 0, [
      { suit: "spades", rank: 1 },
      { suit: "hearts", rank: 13 },
    ]);
    expect(h.debug.move("tableau", 0, 0, "foundation", 0)).toBe(false);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(2);
  });

  it("takes a card from the waste, and gives one back to a column", () => {
    poseWaste(h, [{ suit: "hearts", rank: 1 }], [1]);
    expect(h.debug.move("waste", 0, 0, "foundation", 0)).toBe(true);
    expect(h.debug.snapshot().waste).toHaveLength(0);
    expect(h.debug.snapshot().wasteSets).toEqual([]);

    poseColumn(h, 0, [{ suit: "spades", rank: 2 }]);
    expect(h.debug.move("foundation", 0, 0, "tableau", 0)).toBe(true);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(0);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(2);
  });

  it("refuses a card offered by another foundation", () => {
    poseFoundation(h, 0, "spades", 1);
    poseFoundation(h, 1, "hearts", 1);
    expect(h.debug.move("foundation", 1, 0, "foundation", 0)).toBe(false);
  });
});

describe("a column", () => {
  it("builds down in rank and alternating in colour", () => {
    poseColumn(h, 0, [{ suit: "spades", rank: 8 }]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 7 }]);
    poseColumn(h, 2, [{ suit: "clubs", rank: 7 }]);
    poseColumn(h, 3, [{ suit: "hearts", rank: 6 }]);

    expect(h.debug.move("tableau", 2, 0, "tableau", 0)).toBe(false);
    expect(h.debug.move("tableau", 3, 0, "tableau", 0)).toBe(false);
    expect(h.debug.move("tableau", 1, 0, "tableau", 0)).toBe(true);
  });

  it("takes a King, and only a King, onto an empty column", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 12 }]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 1 }]);
    poseColumn(h, 2, [{ suit: "spades", rank: 13 }]);
    expect(h.debug.move("tableau", 0, 0, "tableau", 6)).toBe(false);
    expect(h.debug.move("tableau", 1, 0, "tableau", 6)).toBe(false);
    expect(h.debug.move("tableau", 2, 0, "tableau", 6)).toBe(true);
  });

  it("takes nothing when its lowest card is face-down", () => {
    poseColumn(h, 0, [{ suit: "spades", rank: 8, faceUp: false }]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 7 }]);
    expect(h.debug.move("tableau", 1, 0, "tableau", 0)).toBe(false);
  });

  it("refuses a move whose source card is face-down, unchanged", () => {
    poseColumn(h, 0, [
      { suit: "spades", rank: 8, faceUp: false },
      { suit: "hearts", rank: 7, faceUp: false },
    ]);
    poseColumn(h, 1, [{ suit: "spades", rank: 8 }]);
    const before = JSON.stringify(h.debug.snapshot().tableau);
    expect(h.debug.move("tableau", 0, 1, "tableau", 1)).toBe(false);
    expect(JSON.stringify(h.debug.snapshot().tableau)).toBe(before);
  });
});

describe("turning an exposed card", () => {
  it("turns the newly lowest card, and only that one", () => {
    poseColumn(h, 0, [
      { suit: "clubs", rank: 4, faceUp: false },
      { suit: "diamonds", rank: 9, faceUp: false },
      { suit: "hearts", rank: 7 },
    ]);
    poseColumn(h, 1, [{ suit: "spades", rank: 8 }]);
    expect(h.debug.move("tableau", 0, 2, "tableau", 1)).toBe(true);
    const column = h.debug.snapshot().tableau[0];
    expect(column[1].faceUp).toBe(true);
    expect(column[0].faceUp).toBe(false);
  });

  it("turns nothing when a face-up card is left lowest", () => {
    poseColumn(h, 0, [
      { suit: "spades", rank: 9 },
      { suit: "hearts", rank: 8 },
    ]);
    poseColumn(h, 1, [{ suit: "spades", rank: 9 }]);
    expect(h.debug.move("tableau", 0, 1, "tableau", 1)).toBe(true);
    expect(h.debug.snapshot().tableau[0][0].faceUp).toBe(true);
  });

  it("turns the card a whole run uncovers", () => {
    poseColumn(h, 0, [
      { suit: "clubs", rank: 4, faceUp: false },
      { suit: "spades", rank: 6 },
      { suit: "hearts", rank: 5 },
      { suit: "clubs", rank: 4 },
    ]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 7 }]);
    expect(h.debug.move("tableau", 0, 1, "tableau", 1)).toBe(true);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
    expect(h.debug.snapshot().tableau[0][0].faceUp).toBe(true);
  });

  it("leaves the card face-down while the flip is gated off", () => {
    h.debug.setAutoFlip(false);
    poseColumn(h, 0, [
      { suit: "clubs", rank: 4, faceUp: false },
      { suit: "hearts", rank: 7 },
    ]);
    poseColumn(h, 1, [{ suit: "spades", rank: 8 }]);
    expect(h.debug.move("tableau", 0, 1, "tableau", 1)).toBe(true);
    expect(h.debug.snapshot().tableau[0][0].faceUp).toBe(false);
  });

  it("plays the flip cue when a card turns", () => {
    poseColumn(h, 0, [
      { suit: "clubs", rank: 4, faceUp: false },
      { suit: "hearts", rank: 7 },
    ]);
    poseColumn(h, 1, [{ suit: "spades", rank: 8 }]);
    h.cues.length = 0;
    h.debug.move("tableau", 0, 1, "tableau", 1);
    expect(h.cues.map((play) => play.cue)).toContain("flip");
  });
});

describe("a run", () => {
  it("moves as a unit and keeps its order", () => {
    const ids = poseColumn(h, 0, [
      { suit: "spades", rank: 6 },
      { suit: "hearts", rank: 5 },
      { suit: "clubs", rank: 4 },
    ]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 7 }]);
    const target = h.debug.snapshot().tableau[1][0].id;
    expect(h.debug.move("tableau", 0, 0, "tableau", 1)).toBe(true);
    expect(h.debug.snapshot().tableau[1].map((card) => card.id)).toEqual([
      target,
      ...ids,
    ]);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(0);
  });

  it("takes every card below the grabbed one and leaves the ones above", () => {
    poseColumn(h, 0, [
      { suit: "clubs", rank: 9 },
      { suit: "hearts", rank: 8 },
      { suit: "spades", rank: 7 },
      { suit: "diamonds", rank: 6 },
      { suit: "clubs", rank: 5 },
    ]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 8 }]);
    expect(h.debug.move("tableau", 0, 2, "tableau", 1)).toBe(true);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(2);
    expect(h.debug.snapshot().tableau[1]).toHaveLength(4);
  });

  it("is refused when its cards are not in run order", () => {
    poseColumn(h, 0, [
      { suit: "spades", rank: 6 },
      { suit: "hearts", rank: 2 },
    ]);
    poseColumn(h, 1, [{ suit: "hearts", rank: 7 }]);
    expect(h.debug.move("tableau", 0, 0, "tableau", 1)).toBe(false);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(2);
  });

  it("returns intact when a target refuses it", () => {
    poseColumn(h, 0, [
      { suit: "spades", rank: 6 },
      { suit: "hearts", rank: 5 },
    ]);
    const before = JSON.stringify(h.debug.snapshot().tableau[0]);
    expect(h.debug.move("tableau", 0, 0, "tableau", 1)).toBe(false);
    expect(JSON.stringify(h.debug.snapshot().tableau[0])).toBe(before);
  });

  it("fills an empty column when it is led by a King, and not otherwise", () => {
    poseColumn(h, 0, [
      { suit: "spades", rank: 13 },
      { suit: "hearts", rank: 12 },
    ]);
    poseColumn(h, 1, [
      { suit: "spades", rank: 10 },
      { suit: "hearts", rank: 9 },
    ]);
    expect(h.debug.move("tableau", 1, 0, "tableau", 6)).toBe(false);
    expect(h.debug.move("tableau", 0, 0, "tableau", 6)).toBe(true);
  });

  it("moves a whole King-to-Ace run in one move", () => {
    const suits = ["spades", "hearts"] as const;
    poseColumn(
      h,
      0,
      Array.from({ length: 13 }, (_, i) => ({
        suit: suits[i % 2],
        rank: 13 - i,
      })),
    );
    expect(h.debug.move("tableau", 0, 0, "tableau", 6)).toBe(true);
    expect(h.debug.snapshot().tableau[6]).toHaveLength(13);
  });
});

describe("the auto-move", () => {
  it("sends the waste's top card home", () => {
    poseWaste(h, [{ suit: "hearts", rank: 1 }], [1]);
    expect(h.debug.autoMove("waste", 0)).toBe(true);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(1);
  });

  it("sends a column's lowest face-up card home", () => {
    poseColumn(h, 0, [{ suit: "clubs", rank: 1 }]);
    expect(h.debug.autoMove("tableau", 0)).toBe(true);
  });

  it("picks the foundation already holding the card's suit", () => {
    poseFoundation(h, 0, "spades", 1);
    poseFoundation(h, 1, "hearts", 1);
    poseFoundation(h, 2, "diamonds", 1);
    poseColumn(h, 0, [{ suit: "hearts", rank: 2 }]);
    expect(h.debug.autoMove("tableau", 0)).toBe(true);
    expect(h.debug.snapshot().foundations[1]).toHaveLength(2);
  });

  it("does nothing when no foundation accepts the card", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 5 }]);
    const before = JSON.stringify(h.debug.snapshot());
    expect(h.debug.autoMove("tableau", 0)).toBe(false);
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });

  it("takes only the named card, leaving what lies above it", () => {
    poseColumn(h, 0, [
      { suit: "hearts", rank: 9 },
      { suit: "spades", rank: 1 },
    ]);
    expect(h.debug.autoMove("tableau", 0)).toBe(true);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
  });

  it("sends nothing from an empty pile, a face-down column or a foundation", () => {
    expect(h.debug.autoMove("tableau", 4)).toBe(false);
    poseColumn(h, 0, [{ suit: "clubs", rank: 1, faceUp: false }]);
    expect(h.debug.autoMove("tableau", 0)).toBe(false);
    poseFoundation(h, 0, "spades", 1);
    expect(h.debug.autoMove("foundation", 0)).toBe(false);
    expect(h.debug.autoMove("stock", 0)).toBe(false);
  });

  it("turns the card it exposes", () => {
    poseColumn(h, 0, [
      { suit: "diamonds", rank: 6, faceUp: false },
      { suit: "clubs", rank: 1 },
    ]);
    expect(h.debug.autoMove("tableau", 0)).toBe(true);
    expect(h.debug.snapshot().tableau[0][0].faceUp).toBe(true);
  });

  it("plays the home cue on the frame the card lands", () => {
    poseColumn(h, 0, [{ suit: "clubs", rank: 1 }]);
    h.cues.length = 0;
    h.debug.autoMove("tableau", 0);
    expect(h.cues.map((play) => play.cue)).toContain("home");
  });
});

describe("winning", () => {
  it("wins the instant the fifty-second card lands, and not before", () => {
    poseFoundation(h, 0, "spades", 13);
    poseFoundation(h, 1, "hearts", 13);
    poseFoundation(h, 2, "diamonds", 13);
    poseFoundation(h, 3, "clubs", 12);
    poseColumn(h, 0, [{ suit: "clubs", rank: 13 }]);
    expect(h.debug.snapshot().screen).toBe("playing");

    expect(h.debug.move("tableau", 0, 0, "foundation", 3)).toBe(true);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("won");
    expect(shot.foundations.flat()).toHaveLength(DECK_SIZE);
  });

  it("stays on the table while the win test is gated off", () => {
    h.debug.setWinDetect(false);
    poseFoundation(h, 0, "spades", 13);
    poseFoundation(h, 1, "hearts", 13);
    poseFoundation(h, 2, "diamonds", 13);
    poseFoundation(h, 3, "clubs", 12);
    poseColumn(h, 0, [{ suit: "clubs", rank: 13 }]);
    expect(h.debug.move("tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(h.debug.snapshot().screen).toBe("playing");
  });

  it("can be won by the auto-move, and plays the win cue", () => {
    poseFoundation(h, 0, "spades", 13);
    poseFoundation(h, 1, "hearts", 13);
    poseFoundation(h, 2, "diamonds", 13);
    poseFoundation(h, 3, "clubs", 12);
    poseColumn(h, 0, [{ suit: "clubs", rank: 13 }]);
    h.cues.length = 0;
    expect(h.debug.autoMove("tableau", 0)).toBe(true);
    expect(h.debug.snapshot().screen).toBe("won");
    expect(h.cues.map((play) => play.cue)).toContain("win");
  });
});
