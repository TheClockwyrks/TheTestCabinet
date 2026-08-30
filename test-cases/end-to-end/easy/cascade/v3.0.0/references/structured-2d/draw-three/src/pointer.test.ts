import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEAL_STOCK_CARDS,
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
  TURN_COUNT,
  type Rect,
} from "./constants";
import {
  centreOf,
  clickAt,
  columnCardTopLeft,
  createHarness,
  doubleClickAt,
  drag,
  openTable,
  pileTopLeft,
  poseColumn,
  poseFoundation,
  poseStock,
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

function middleOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The centre of a column's lowest card, which is the whole of what it shows. */
function columnCardCentre(
  column: number,
  row: number,
): { x: number; y: number } {
  const at = columnCardTopLeft(h, column, row);
  return centreOf(at.x, at.y);
}

/**
 * A point on the strip a buried column card shows: a press lower down would land
 * on the card fanned beneath it, which is the one drawn over it there.
 */
function columnCardStrip(
  column: number,
  row: number,
): { x: number; y: number } {
  const at = columnCardTopLeft(h, column, row);
  return { x: at.x + 50, y: at.y + 12 };
}

function pileCentre(
  pile: "stock" | "waste" | "foundation" | "tableau",
  index: number,
) {
  const at = pileTopLeft(pile, index);
  return centreOf(at.x, at.y);
}

describe("what a press picks up", () => {
  it("lifts a column card and every card below it, on the press itself", () => {
    poseColumn(h, 0, [
      { suit: "clubs", rank: 9 },
      { suit: "hearts", rank: 8 },
      { suit: "spades", rank: 7 },
    ]);
    const at = columnCardStrip(0, 1);
    h.debug.pointerDown(at.x, at.y);

    const shot = h.debug.snapshot();
    expect(shot.drag).not.toBeNull();
    expect(shot.drag?.cards).toHaveLength(2);
    expect(shot.drag?.fromPile).toBe("tableau");
    expect(shot.drag?.fromIndex).toBe(0);
    // The run has left the pile it was lifted from for the length of the gesture.
    expect(shot.tableau[0]).toHaveLength(1);
  });

  it("lifts the waste's top card alone", () => {
    poseWaste(
      h,
      [
        { suit: "clubs", rank: 3 },
        { suit: "hearts", rank: 4 },
        { suit: "spades", rank: 5 },
      ],
      [3],
    );
    // The frontmost fanned card, two pitches right of the anchor.
    h.debug.pointerDown(346 + 26 * 2 + 50, 94);
    expect(h.debug.snapshot().drag?.cards).toHaveLength(1);
    expect(h.debug.snapshot().drag?.fromPile).toBe("waste");
  });

  it("lifts a foundation's top card", () => {
    poseFoundation(h, 1, "hearts", 2);
    const at = pileCentre("foundation", 1);
    h.debug.pointerDown(at.x, at.y);
    expect(h.debug.snapshot().drag?.cards).toHaveLength(1);
    expect(h.debug.snapshot().drag?.fromPile).toBe("foundation");
  });

  it("lifts nothing from a face-down card, the stock, or the bare table", () => {
    poseColumn(h, 0, [{ suit: "clubs", rank: 9, faceUp: false }]);
    poseStock(h, [{ suit: "hearts", rank: 2 }]);

    const column = columnCardCentre(0, 0);
    h.debug.pointerDown(column.x, column.y);
    expect(h.debug.snapshot().drag).toBeNull();
    h.debug.pointerUp(column.x, column.y);

    const stock = pileCentre("stock", 0);
    h.debug.pointerDown(stock.x, stock.y);
    expect(h.debug.snapshot().drag).toBeNull();
    h.debug.pointerUp(stock.x, stock.y);

    h.debug.pointerDown(640, 520);
    expect(h.debug.snapshot().drag).toBeNull();
  });

  it("lifts nothing from a waste card that is not its top", () => {
    poseWaste(
      h,
      [
        { suit: "clubs", rank: 3 },
        { suit: "hearts", rank: 4 },
        { suit: "spades", rank: 5 },
      ],
      [3],
    );
    h.debug.pointerDown(346 + 20, 94);
    expect(h.debug.snapshot().drag).toBeNull();
  });

  it("plays the lift cue", () => {
    poseColumn(h, 0, [{ suit: "clubs", rank: 9 }]);
    const at = columnCardCentre(0, 0);
    h.cues.length = 0;
    h.debug.pointerDown(at.x, at.y);
    expect(h.cues.map((play) => play.cue)).toContain("lift");
  });
});

describe("carrying a run", () => {
  it("keeps the offset between the press point and the leading card", () => {
    poseColumn(h, 0, [{ suit: "spades", rank: 13 }]);
    const at = columnCardTopLeft(h, 0, 0);
    h.debug.pointerDown(at.x + 20, at.y + 30);
    h.debug.pointerMove(at.x + 220, at.y + 130);
    const dragged = h.debug.snapshot().drag;
    expect(dragged?.x).toBe(at.x + 200);
    expect(dragged?.y).toBe(at.y + 100);
  });

  it("reports the legal pile under the leading card's centre", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const from = columnCardCentre(0, 0);
    const to = pileCentre("foundation", 2);
    h.debug.pointerDown(from.x, from.y);
    expect(h.debug.snapshot().dropTarget).toBeNull();
    h.debug.pointerMove(to.x, to.y);
    expect(h.debug.snapshot().dropTarget).toEqual({
      pile: "foundation",
      index: 2,
    });
  });

  it("reports nothing over a pile that would refuse the run", () => {
    poseFoundation(h, 0, "spades", 1);
    poseColumn(h, 0, [{ suit: "hearts", rank: 9 }]);
    const from = columnCardCentre(0, 0);
    const to = pileCentre("foundation", 0);
    h.debug.pointerDown(from.x, from.y);
    h.debug.pointerMove(to.x, to.y);
    expect(h.debug.snapshot().dropTarget).toBeNull();
  });
});

describe("where a drop lands", () => {
  it("completes the move onto a legal target", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const from = columnCardCentre(0, 0);
    const to = pileCentre("foundation", 0);
    h.cues.length = 0;
    drag(h, from.x, from.y, to.x, to.y);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(1);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(0);
    expect(h.cues.map((play) => play.cue)).toContain("drop");
    expect(h.cues.map((play) => play.cue)).toContain("home");
  });

  it("returns the run when the pile it resolved to refuses it", () => {
    poseFoundation(h, 0, "spades", 1);
    poseColumn(h, 0, [{ suit: "hearts", rank: 9 }]);
    const from = columnCardCentre(0, 0);
    const to = pileCentre("foundation", 0);
    h.cues.length = 0;
    drag(h, from.x, from.y, to.x, to.y);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
    expect(h.cues.map((play) => play.cue)).toContain("reject");
  });

  it("returns the run when its leading card's centre lies on no pile", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 9 }]);
    const from = columnCardCentre(0, 0);
    drag(h, from.x, from.y, 640, 560);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
    expect(h.debug.snapshot().drag).toBeNull();
  });

  it("resolves to the pile holding the centre, not one the card overlaps", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const from = columnCardCentre(0, 0);
    // Just inside foundation 1's rectangle, with the card overlapping
    // foundation 0's column position as well.
    drag(h, from.x, from.y, 716, 94);
    expect(h.debug.snapshot().foundations[1]).toHaveLength(1);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(0);
  });

  it("leaves an empty column empty when it refuses the run", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 9 }]);
    const from = columnCardCentre(0, 0);
    const to = pileCentre("tableau", 4);
    drag(h, from.x, from.y, to.x, to.y);
    expect(h.debug.snapshot().tableau[4]).toHaveLength(0);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
  });

  it("turns nothing while a run is merely in hand", () => {
    poseColumn(h, 0, [
      { suit: "clubs", rank: 9, faceUp: false },
      { suit: "hearts", rank: 8 },
    ]);
    const from = columnCardCentre(0, 1);
    h.debug.pointerDown(from.x, from.y);
    expect(h.debug.snapshot().drag).not.toBeNull();
    expect(h.debug.snapshot().tableau[0][0].faceUp).toBe(false);
    h.debug.pointerMove(640, 560);
    expect(h.debug.snapshot().tableau[0][0].faceUp).toBe(false);
    h.debug.pointerUp(640, 560);
    expect(h.debug.snapshot().tableau[0][0].faceUp).toBe(false);
  });
});

describe("a click against a drop", () => {
  it("reads a release within the threshold as a click, and past it as a drop", async () => {
    poseWaste(h, [{ suit: "spades", rank: 5 }], [1]);
    const at = pileCentre("waste", 0);

    h.cues.length = 0;
    h.debug.pointerDown(at.x, at.y);
    h.debug.pointerMove(at.x + 4, at.y);
    h.debug.pointerUp(at.x + 4, at.y);
    expect(h.debug.snapshot().waste).toHaveLength(1);
    expect(h.cues.map((play) => play.cue)).not.toContain("reject");

    // Far enough past the double-click window that the next press opens a
    // gesture of its own rather than pairing with the one before it.
    await h.advance(24);
    h.cues.length = 0;
    h.debug.pointerDown(at.x, at.y);
    h.debug.pointerMove(at.x + 6, at.y);
    h.debug.pointerUp(at.x + 6, at.y);
    expect(h.debug.snapshot().waste).toHaveLength(1);
    expect(h.cues.map((play) => play.cue)).toContain("reject");
  });

  it("leaves the waste's set memory exactly as it was after a cancelled drag", () => {
    poseWaste(
      h,
      [
        { suit: "clubs", rank: 3 },
        { suit: "hearts", rank: 4 },
        { suit: "spades", rank: 5 },
      ],
      [3],
    );
    const before = h.debug.snapshot();
    drag(h, 346 + 26 * 2 + 50, 94, 640, 560);
    const after = h.debug.snapshot();
    expect(after.waste.map((card) => card.id)).toEqual(
      before.waste.map((card) => card.id),
    );
    expect(after.wasteSets).toEqual(before.wasteSets);
    expect(after.wasteVisibleCount).toBe(before.wasteVisibleCount);
  });

  it("turns the stock on a click in its rectangle", () => {
    poseStock(h, [
      { suit: "spades", rank: 2 },
      { suit: "spades", rank: 3 },
      { suit: "spades", rank: 4 },
      { suit: "spades", rank: 5 },
    ]);
    const at = pileCentre("stock", 0);
    clickAt(h, at.x, at.y);
    expect(h.debug.snapshot().waste).toHaveLength(TURN_COUNT);
  });

  it("recycles on a click in the empty stock's slot", () => {
    poseWaste(
      h,
      [
        { suit: "spades", rank: 2 },
        { suit: "spades", rank: 3 },
      ],
      [2],
    );
    const at = pileCentre("stock", 0);
    clickAt(h, at.x, at.y);
    expect(h.debug.snapshot().stock).toHaveLength(2);
    expect(h.debug.snapshot().waste).toHaveLength(0);
  });

  it("changes nothing on a release that no press opened", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 9 }]);
    const before = JSON.stringify(h.debug.snapshot());
    h.debug.pointerUp(640, 500);
    const after = h.debug.snapshot();
    expect(after.drag).toBeNull();
    expect(
      JSON.stringify({ ...after, pointer: JSON.parse(before).pointer }),
    ).toBe(before);
  });
});

describe("the double click", () => {
  it("sends a playable card home and lifts nothing", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const at = columnCardCentre(0, 0);
    doubleClickAt(h, at.x, at.y);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(1);
    expect(h.debug.snapshot().drag).toBeNull();
  });

  it("does nothing when the second press comes past the window", async () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const at = columnCardCentre(0, 0);
    clickAt(h, at.x, at.y);
    // 0.4 s of game time, past DOUBLE_CLICK_WINDOW.
    await h.advance(24);
    clickAt(h, at.x, at.y);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(0);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
  });

  it("does nothing when the second press comes past the slop", () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const at = columnCardCentre(0, 0);
    clickAt(h, at.x, at.y);
    clickAt(h, at.x, at.y + 40);
    expect(h.debug.snapshot().foundations[0]).toHaveLength(0);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
  });

  it("does nothing on the bare table", () => {
    const before = JSON.stringify(h.debug.snapshot().tableau);
    doubleClickAt(h, 640, 520);
    expect(JSON.stringify(h.debug.snapshot().tableau)).toBe(before);
  });

  it("records every press, so the next one is measured against it", () => {
    h.debug.pointerDown(300, 400);
    const press = h.debug.snapshot().lastPress;
    expect(press?.x).toBe(300);
    expect(press?.y).toBe(400);
    expect(press?.at).toBe(h.debug.snapshot().simTime);
  });
});

describe("the controls", () => {
  it("deals and enters play from the title's NEW GAME", () => {
    h.debug.reset();
    const at = middleOf(TITLE_NEW_GAME);
    clickAt(h, at.x, at.y);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.stock).toHaveLength(DEAL_STOCK_CARDS);
  });

  it("opens and leaves the how-to screen", () => {
    h.debug.reset();
    const open = middleOf(TITLE_HOW_TO);
    clickAt(h, open.x, open.y);
    expect(h.debug.snapshot().screen).toBe("howto");
    const back = middleOf(HOWTO_BACK);
    clickAt(h, back.x, back.y);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("deals afresh from the HUD and stays on the table", () => {
    const at = middleOf(HUD_NEW_GAME);
    clickAt(h, at.x, at.y);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.tableau.map((column) => column.length)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("returns to the title from the HUD's MENU", () => {
    const at = middleOf(HUD_MENU);
    clickAt(h, at.x, at.y);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("toggles muting from the HUD's SOUND, and back again", () => {
    const at = middleOf(HUD_SOUND);
    expect(h.debug.snapshot().muted).toBe(false);
    clickAt(h, at.x, at.y);
    expect(h.debug.snapshot().muted).toBe(true);
    clickAt(h, at.x, at.y);
    expect(h.debug.snapshot().muted).toBe(false);
  });

  it("answers a control only on the screen it belongs to", () => {
    const at = middleOf(TITLE_NEW_GAME);
    poseColumn(h, 0, [{ suit: "hearts", rank: 9 }]);
    clickAt(h, at.x, at.y);
    // The title's rectangle carries nothing on the playing screen.
    expect(h.debug.snapshot().screen).toBe("playing");
    expect(h.debug.snapshot().tableau[0]).toHaveLength(1);
  });

  it("deals a fresh game from a press on the won screen", () => {
    h.debug.setScreen("won");
    clickAt(h, 640, 400);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.stock).toHaveLength(DEAL_STOCK_CARDS);
    expect(shot.trailStamps).toBe(0);
  });

  it("spends the whole gesture on a won-screen press, HUD or not", () => {
    // The press lands where the FRESH table draws a HUD control, so a build
    // whose release re-resolved on the new screen would answer that control:
    // MENU would walk straight back to the title, SOUND would flip the mute
    // bit, and NEW GAME would deal a second time. The gesture belongs to the
    // `won` screen, and a control answers only on the screen it belongs to.
    for (const rect of [HUD_MENU, HUD_SOUND, HUD_NEW_GAME]) {
      h.debug.setScreen("won");
      const wasMuted = h.debug.snapshot().muted;
      const at = middleOf(rect);
      clickAt(h, at.x, at.y);
      const shot = h.debug.snapshot();
      expect(shot.screen).toBe("playing");
      expect(shot.stock).toHaveLength(DEAL_STOCK_CARDS);
      expect(shot.muted).toBe(wasMuted);
      // Nothing is left for a following press to pair a double click with.
      expect(shot.lastPress).toBeNull();
    }
  });
});

describe("the engine's own pointer", () => {
  it("answers every sample a frame delivers, in the order it arrived", async () => {
    poseColumn(h, 0, [{ suit: "hearts", rank: 1 }]);
    const from = columnCardCentre(0, 0);
    const to = pileCentre("foundation", 0);

    // A whole gesture inside one frame: a build that folded only the frame's
    // last sample would see the release alone and lift nothing.
    h.pointer("pointerdown", from.x, from.y);
    h.pointer("pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2);
    h.pointer("pointermove", to.x, to.y);
    h.pointer("pointerup", to.x, to.y);
    await h.advance(1);

    expect(h.debug.snapshot().foundations[0]).toHaveLength(1);
    expect(h.debug.snapshot().tableau[0]).toHaveLength(0);
  });

  it("reports the pointer it was driven with", async () => {
    h.pointer("pointerdown", 400, 300);
    await h.advance(1);
    const shot = h.debug.snapshot();
    expect(shot.pointer).toEqual({ x: 400, y: 300, down: true });
    h.pointer("pointerup", 400, 300);
    await h.advance(1);
    expect(h.debug.snapshot().pointer.down).toBe(false);
  });
});
