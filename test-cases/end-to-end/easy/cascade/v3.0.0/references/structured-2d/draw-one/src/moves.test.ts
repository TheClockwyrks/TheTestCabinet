// Moving cards: what a foundation and a column take through the real move path,
// what a run carries with it, and what the auto-move sends home
// (specs/foundations.md, specs/tableau.md, specs/instrumentation.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  poseNearlyWon,
  poseWaste,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("a foundation through a move", () => {
  it("takes an Ace onto an empty foundation and refuses everything else", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 1 }]);
    poseColumn(debug, 1, [{ suit: "hearts", rank: 2 }]);
    poseColumn(debug, 2, [{ suit: "hearts", rank: 13 }]);
    expect(debug.move("tableau", 1, 0, "foundation", 0)).toBe(false);
    expect(debug.move("tableau", 2, 0, "foundation", 0)).toBe(false);
    expect(debug.move("tableau", 0, 0, "foundation", 0)).toBe(true);
    expect(debug.snapshot().foundations[0]).toHaveLength(1);
  });

  it("builds up by suit, refusing another suit, a gap and a lower rank", () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "hearts", 5);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 6 }]);
    poseColumn(debug, 1, [{ suit: "diamonds", rank: 6 }]);
    poseColumn(debug, 2, [{ suit: "hearts", rank: 7 }]);
    poseColumn(debug, 3, [{ suit: "hearts", rank: 3 }]);
    expect(debug.move("tableau", 1, 0, "foundation", 0)).toBe(false);
    expect(debug.move("tableau", 2, 0, "foundation", 0)).toBe(false);
    expect(debug.move("tableau", 3, 0, "foundation", 0)).toBe(false);
    expect(debug.move("tableau", 0, 0, "foundation", 0)).toBe(true);
    expect(debug.snapshot().foundations[0]).toHaveLength(6);
  });

  it("is locked to its suit once started, and takes nothing onto its King", () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "spades", 1);
    poseColumn(debug, 0, [{ suit: "clubs", rank: 2 }]);
    poseColumn(debug, 1, [{ suit: "spades", rank: 2 }]);
    expect(debug.move("tableau", 0, 0, "foundation", 0)).toBe(false);
    expect(debug.move("tableau", 1, 0, "foundation", 0)).toBe(true);

    poseFoundation(debug, 1, "hearts", 13);
    poseColumn(debug, 2, [{ suit: "hearts", rank: 1 }]);
    expect(debug.move("tableau", 2, 0, "foundation", 1)).toBe(false);
  });

  it("takes any suit on any empty slot, and refuses a run", () => {
    const { debug } = h;
    openTable(debug);
    for (const suit of ["spades", "hearts", "diamonds", "clubs"] as const) {
      poseColumn(debug, 0, [{ suit, rank: 1 }]);
      expect(debug.move("tableau", 0, 0, "foundation", 3)).toBe(true);
      debug.clearPile("foundation", 3);
    }
    poseFoundation(debug, 2, "spades", 1);
    poseColumn(debug, 1, [
      { suit: "spades", rank: 2 },
      { suit: "hearts", rank: 1 },
    ]);
    expect(debug.move("tableau", 1, 0, "foundation", 2)).toBe(false);
  });

  it("takes from the waste and from a column, and gives its top card back", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [{ suit: "clubs", rank: 1 }], [1]);
    expect(debug.move("waste", 0, 0, "foundation", 0)).toBe(true);
    expect(debug.snapshot().waste).toHaveLength(0);

    poseColumn(debug, 0, [{ suit: "clubs", rank: 2 }]);
    expect(debug.move("tableau", 0, 0, "foundation", 0)).toBe(true);
    expect(debug.snapshot().foundations[0]).toHaveLength(2);

    poseColumn(debug, 1, [{ suit: "hearts", rank: 3 }]);
    expect(debug.move("foundation", 0, 1, "tableau", 1)).toBe(true);
    expect(debug.snapshot().foundations[0]).toHaveLength(1);
    expect(debug.snapshot().tableau[1]).toHaveLength(2);
  });
});

describe("a column through a move", () => {
  it("builds down in alternating color and refuses everything else", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "clubs", rank: 8 }]);
    const refuse = (suit: "spades" | "hearts", rank: number): void => {
      poseColumn(debug, 6, [{ suit, rank }]);
      expect(debug.move("tableau", 6, 0, "tableau", 0), `${suit}${rank}`).toBe(
        false,
      );
      debug.clearPile("tableau", 6);
    };
    refuse("spades", 7);
    refuse("hearts", 9);
    refuse("hearts", 6);
    refuse("hearts", 8);
    poseColumn(debug, 6, [{ suit: "hearts", rank: 7 }]);
    expect(debug.move("tableau", 6, 0, "tableau", 0)).toBe(true);
  });

  it("takes only a King, or a King-led run, onto an empty column", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "spades", rank: 12 }]);
    expect(debug.move("tableau", 0, 0, "tableau", 5)).toBe(false);
    poseColumn(debug, 1, [{ suit: "spades", rank: 1 }]);
    expect(debug.move("tableau", 1, 0, "tableau", 5)).toBe(false);
    expect(debug.snapshot().tableau[5]).toHaveLength(0);

    poseColumn(debug, 2, [
      { suit: "spades", rank: 13 },
      { suit: "hearts", rank: 12 },
    ]);
    expect(debug.move("tableau", 2, 0, "tableau", 5)).toBe(true);
    expect(debug.snapshot().tableau[5]).toHaveLength(2);
  });

  it("takes nothing onto a column whose lowest card is face-down", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [{ suit: "clubs", rank: 8, faceUp: false }]);
    poseColumn(debug, 1, [{ suit: "hearts", rank: 7 }]);
    poseColumn(debug, 2, [{ suit: "spades", rank: 13 }]);
    expect(debug.move("tableau", 1, 0, "tableau", 0)).toBe(false);
    expect(debug.move("tableau", 2, 0, "tableau", 0)).toBe(false);
  });

  it("never moves a face-down card", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [
      { suit: "clubs", rank: 8, faceUp: false },
      { suit: "hearts", rank: 7, faceUp: false },
    ]);
    poseColumn(debug, 1, [{ suit: "spades", rank: 9 }]);
    const before = JSON.stringify(debug.snapshot().tableau);
    expect(debug.move("tableau", 0, 1, "tableau", 1)).toBe(false);
    expect(JSON.stringify(debug.snapshot().tableau)).toBe(before);
  });
});

describe("an ordered run", () => {
  it("moves as a unit, keeps its order, and leaves the cards above it", () => {
    const { debug } = h;
    openTable(debug);
    const ids = poseColumn(debug, 0, [
      { suit: "clubs", rank: 13 },
      { suit: "hearts", rank: 12 },
      { suit: "spades", rank: 8 },
      { suit: "hearts", rank: 7 },
      { suit: "clubs", rank: 6 },
    ]);
    poseColumn(debug, 1, [{ suit: "diamonds", rank: 9 }]);

    expect(debug.move("tableau", 0, 2, "tableau", 1)).toBe(true);
    const shot = debug.snapshot();
    expect(shot.tableau[0].map((card) => card.id)).toEqual([ids[0], ids[1]]);
    expect(shot.tableau[1].map((card) => card.id)).toEqual([
      shot.tableau[1][0].id,
      ids[2],
      ids[3],
      ids[4],
    ]);
  });

  it("is refused when the slice is not an ordered run, and returns intact", () => {
    const { debug } = h;
    openTable(debug);
    const ids = poseColumn(debug, 0, [
      { suit: "spades", rank: 8 },
      { suit: "clubs", rank: 7 },
    ]);
    poseColumn(debug, 1, [{ suit: "diamonds", rank: 9 }]);
    expect(debug.move("tableau", 0, 0, "tableau", 1)).toBe(false);
    expect(debug.snapshot().tableau[0].map((card) => card.id)).toEqual(ids);
    expect(debug.snapshot().tableau[1]).toHaveLength(1);
  });

  it("carries a thirteen-card run onto an empty column in one move", () => {
    const { debug } = h;
    openTable(debug);
    const suits = ["spades", "hearts"] as const;
    const run = Array.from({ length: 13 }, (_, i) => ({
      suit: suits[i % 2],
      rank: 13 - i,
    }));
    poseColumn(debug, 0, run);
    expect(debug.move("tableau", 0, 0, "tableau", 6)).toBe(true);
    expect(debug.snapshot().tableau[6]).toHaveLength(13);
    expect(debug.snapshot().tableau[0]).toHaveLength(0);
  });
});

describe("turning an exposed card", () => {
  it("turns only the newly lowest card, and only when it is face-down", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [
      { suit: "clubs", rank: 5, faceUp: false },
      { suit: "diamonds", rank: 9, faceUp: false },
      { suit: "spades", rank: 8 },
      { suit: "hearts", rank: 7 },
      { suit: "clubs", rank: 6 },
    ]);
    poseColumn(debug, 1, [{ suit: "diamonds", rank: 9 }]);
    expect(debug.move("tableau", 0, 2, "tableau", 1)).toBe(true);
    const shot = debug.snapshot();
    expect(shot.tableau[0][1].faceUp).toBe(true);
    expect(shot.tableau[0][0].faceUp).toBe(false);
  });

  it("turns nothing when the move leaves a face-up card lowest", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [
      { suit: "spades", rank: 8 },
      { suit: "hearts", rank: 7 },
    ]);
    poseColumn(debug, 1, [{ suit: "clubs", rank: 8 }]);
    expect(debug.move("tableau", 0, 1, "tableau", 1)).toBe(true);
    expect(debug.snapshot().tableau[0][0].faceUp).toBe(true);
  });
});

describe("the auto-move", () => {
  it("sends the waste's top card and a column's lowest card home", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [{ suit: "hearts", rank: 1 }], [1]);
    expect(debug.autoMove("waste", 0)).toBe(true);
    expect(debug.snapshot().foundations.flat()).toHaveLength(1);

    poseColumn(debug, 3, [{ suit: "hearts", rank: 2 }]);
    expect(debug.autoMove("tableau", 3)).toBe(true);
    expect(debug.snapshot().foundations.flat()).toHaveLength(2);
  });

  it("picks the foundation already holding the card's suit", () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "spades", 3);
    poseFoundation(debug, 1, "hearts", 2);
    poseFoundation(debug, 2, "clubs", 1);
    poseColumn(debug, 0, [{ suit: "hearts", rank: 3 }]);
    expect(debug.autoMove("tableau", 0)).toBe(true);
    expect(debug.snapshot().foundations[1]).toHaveLength(3);
  });

  it("changes nothing when no foundation takes the card", () => {
    const { debug } = h;
    openTable(debug);
    poseFoundation(debug, 0, "spades", 3);
    poseColumn(debug, 0, [{ suit: "spades", rank: 6 }]);
    const before = JSON.stringify(debug.snapshot());
    expect(debug.autoMove("tableau", 0)).toBe(false);
    expect(JSON.stringify(debug.snapshot())).toBe(before);
  });

  it("sends nothing from an empty pile, a face-down column or a foundation", () => {
    const { debug } = h;
    openTable(debug);
    expect(debug.autoMove("tableau", 4)).toBe(false);
    poseColumn(debug, 5, [{ suit: "hearts", rank: 1, faceUp: false }]);
    expect(debug.autoMove("tableau", 5)).toBe(false);
    poseFoundation(debug, 0, "spades", 1);
    expect(debug.autoMove("foundation", 0)).toBe(false);
  });

  it("takes one card, and turns the card it exposes", () => {
    const { debug } = h;
    openTable(debug);
    poseColumn(debug, 0, [
      { suit: "clubs", rank: 9, faceUp: false },
      { suit: "hearts", rank: 1 },
    ]);
    expect(debug.autoMove("tableau", 0)).toBe(true);
    const shot = debug.snapshot();
    expect(shot.tableau[0]).toHaveLength(1);
    expect(shot.tableau[0][0].faceUp).toBe(true);
  });

  it("can win the game", () => {
    const { debug } = h;
    openTable(debug);
    poseNearlyWon(debug);
    expect(debug.autoMove("tableau", 0)).toBe(true);
    expect(debug.snapshot().screen).toBe("won");
  });
});

describe("the win", () => {
  it("comes at fifty-two and not at fifty-one", () => {
    const { debug } = h;
    openTable(debug);
    poseNearlyWon(debug);
    expect(debug.snapshot().screen).toBe("playing");
    expect(debug.snapshot().foundations.flat()).toHaveLength(51);
    expect(debug.move("tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(debug.snapshot().screen).toBe("won");
  });
});
