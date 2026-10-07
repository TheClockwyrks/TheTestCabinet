import { describe, expect, it } from "vitest";
import { turnStock, wasteVisibleCount } from "./board";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  CUES,
  DOUBLE_CLICK_WINDOW,
  FOUNDATION_X,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  HOWTO_BACK,
  STOCK_X,
  TABLEAU_Y,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
  TOP_ROW_Y,
  WASTE_X,
} from "./constants";
import { playableAt, resolvePointer } from "./controls";
import { columnCardYs, columnDropRect, foundationRect } from "./table";
import { RecordingAudio, put, testState } from "./harness.test-support";
import type { CascadeState } from "./state";

const audio = (): RecordingAudio => new RecordingAudio();

function press(state: CascadeState, x: number, y: number, bus = audio()): void {
  resolvePointer(state, { type: "down", x, y }, bus);
}
function glide(state: CascadeState, x: number, y: number, bus = audio()): void {
  resolvePointer(state, { type: "move", x, y }, bus);
}
function release(
  state: CascadeState,
  x: number,
  y: number,
  bus = audio(),
): void {
  resolvePointer(state, { type: "up", x, y }, bus);
}

/** How far inside the grabbed card's top-left every grab below presses. */
const GRAB_DX = CARD_W / 2;
const GRAB_DY = 8;

/**
 * Where to press to grab the card at `row` of a column: inside the strip that
 * card leaves showing, which is what a player aims at.
 */
function grabPoint(state: CascadeState, index: number, row: number) {
  return {
    x: COLUMN_X[index] + GRAB_DX,
    y: columnCardYs(state.tableau[index])[row] + GRAB_DY,
  };
}

/**
 * Where to release so that the leading card's centre lands on `centre`, given
 * a gesture that grabbed at {@link grabPoint}.
 */
function releaseFor(centre: { x: number; y: number }) {
  return {
    x: centre.x - CARD_W / 2 + GRAB_DX,
    y: centre.y - CARD_H / 2 + GRAB_DY,
  };
}

/** The middle of a rectangle, which is a point inside exactly that pile. */
function middle(rect: { x: number; y: number; w: number; h: number }) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function playing(): CascadeState {
  const state = testState();
  state.screen = "playing";
  return state;
}

describe("a press", () => {
  it("lifts a column card and every card below it, on the press itself", () => {
    const state = playing();
    put(state, "tableau", 0, "clubs", 9, false);
    put(state, "tableau", 0, "spades", 8);
    put(state, "tableau", 0, "hearts", 7);
    const at = grabPoint(state, 0, 1);
    press(state, at.x, at.y);
    expect(state.drag?.cards.map((c) => c.rank)).toEqual([8, 7]);
    expect(state.drag?.fromPile).toBe("tableau");
    expect(state.tableau[0]).toHaveLength(1);
    // Lifting turns nothing: the card beneath is still face-down.
    expect(state.tableau[0][0].faceUp).toBe(false);
    expect(state.cues.peek()).toContain(CUES.lift);
  });

  it("lifts the waste's top card alone, and a foundation's top card alone", () => {
    const state = playing();
    put(state, "stock", 0, "hearts", 4, false);
    turnStock(state);
    press(state, WASTE_X + 10, TOP_ROW_Y + 10);
    expect(state.drag?.cards).toHaveLength(1);
    release(state, WASTE_X + 10, TOP_ROW_Y + 10);

    put(state, "foundation", 1, "spades", 1);
    press(state, FOUNDATION_X[1] + 10, TOP_ROW_Y + 10);
    expect(state.drag?.fromPile).toBe("foundation");
    expect(state.drag?.fromIndex).toBe(1);
  });

  it("lifts nothing off a face-down card, the bare table, or the stock", () => {
    const state = playing();
    put(state, "tableau", 0, "clubs", 9, false);
    put(state, "stock", 0, "clubs", 4, false);
    press(state, ...([COLUMN_X[0] + 10, TABLEAU_Y + 10] as const));
    expect(state.drag).toBeNull();
    press(state, 640, 400);
    expect(state.drag).toBeNull();
    press(state, STOCK_X + 10, TOP_ROW_Y + 10);
    expect(state.drag).toBeNull();
  });

  it("is reported by the pointer and by lastPress", () => {
    const state = playing();
    state.simTime = 4.5;
    press(state, 100, 200);
    expect(state.pointer).toEqual({ x: 100, y: 200, down: true });
    expect(state.lastPress).toEqual({ x: 100, y: 200, at: 4.5 });
    glide(state, 120, 210);
    expect(state.pointer).toEqual({ x: 120, y: 210, down: true });
    release(state, 120, 210);
    expect(state.pointer).toEqual({ x: 120, y: 210, down: false });
  });
});

describe("a held run", () => {
  it("follows the pointer and reports a legal target under it", () => {
    const state = playing();
    put(state, "tableau", 0, "hearts", 12);
    put(state, "tableau", 1, "spades", 13);
    const at = grabPoint(state, 0, 0);
    press(state, at.x, at.y);
    expect(state.dropTarget).toBeNull();
    const over = releaseFor(middle(columnDropRect(1, state.tableau[1])));
    glide(state, over.x, over.y);
    expect(state.drag?.x).toBe(COLUMN_X[1]);
    expect(state.dropTarget).toEqual({ pile: "tableau", index: 1 });
  });

  it("reports no target over a pile that would refuse it", () => {
    const state = playing();
    put(state, "tableau", 0, "hearts", 12);
    put(state, "tableau", 1, "hearts", 13);
    const at = grabPoint(state, 0, 0);
    press(state, at.x, at.y);
    const over = releaseFor(middle(columnDropRect(1, state.tableau[1])));
    glide(state, over.x, over.y);
    expect(state.dropTarget).toBeNull();
  });
});

describe("a click and a drop", () => {
  it("returns the run when the release lies within the drag threshold", () => {
    const state = playing();
    put(state, "tableau", 0, "hearts", 12);
    put(state, "tableau", 1, "spades", 13);
    const at = grabPoint(state, 0, 0);
    press(state, at.x, at.y);
    glide(state, at.x + 4, at.y);
    release(state, at.x + 4, at.y);
    expect(state.drag).toBeNull();
    expect(state.tableau[0]).toHaveLength(1);
    expect(state.tableau[1]).toHaveLength(1);
  });

  it("completes the drop when the release lies beyond it", () => {
    const state = playing();
    put(state, "tableau", 0, "hearts", 12);
    put(state, "tableau", 1, "spades", 13);
    const at = grabPoint(state, 0, 0);
    const over = releaseFor(middle(columnDropRect(1, state.tableau[1])));
    press(state, at.x, at.y);
    glide(state, over.x, over.y);
    release(state, over.x, over.y);
    expect(state.tableau[0]).toHaveLength(0);
    expect(state.tableau[1].map((c) => c.rank)).toEqual([13, 12]);
    expect(state.cues.peek()).toContain(CUES.drop);
  });

  it("returns the run when the release lands on no pile at all", () => {
    const state = playing();
    put(state, "tableau", 0, "clubs", 9, false);
    put(state, "tableau", 0, "hearts", 12);
    const at = grabPoint(state, 0, 1);
    press(state, at.x, at.y);
    release(state, 640, 640);
    expect(state.tableau[0]).toHaveLength(2);
    expect(state.tableau[0][0].faceUp).toBe(false);
    expect(state.cues.peek()).toContain(CUES.reject);
  });

  it("resolves to the pile the leading card's centre lies in", () => {
    const state = playing();
    put(state, "tableau", 0, "hearts", 1);
    put(state, "foundation", 2, "hearts", 0);
    state.foundations[2].length = 0;
    const at = grabPoint(state, 0, 0);
    press(state, at.x, at.y);
    const centre = releaseFor(middle(foundationRect(2)));
    glide(state, centre.x, centre.y);
    release(state, centre.x, centre.y);
    expect(state.foundations[2].map((c) => c.rank)).toEqual([1]);
    expect(state.foundations[3]).toHaveLength(0);
  });

  it("changes nothing on a release with no press behind it", () => {
    const state = playing();
    put(state, "tableau", 0, "hearts", 12);
    release(state, 500, 500);
    expect(state.drag).toBeNull();
    expect(state.tableau[0]).toHaveLength(1);
  });
});

describe("the stock's click", () => {
  it("turns cards, and recycles once the stock is empty", () => {
    const state = playing();
    put(state, "stock", 0, "hearts", 4, false);
    press(state, STOCK_X + 10, TOP_ROW_Y + 10);
    expect(state.waste).toHaveLength(0);
    release(state, STOCK_X + 10, TOP_ROW_Y + 10);
    expect(state.waste).toHaveLength(1);
    press(state, STOCK_X + 10, TOP_ROW_Y + 10);
    release(state, STOCK_X + 10, TOP_ROW_Y + 10);
    expect(state.stock).toHaveLength(1);
    expect(state.waste).toHaveLength(0);
    expect(wasteVisibleCount(state)).toBe(0);
  });
});

describe("the double click", () => {
  it("sends a playable card home when both presses are close in time and place", () => {
    const state = playing();
    put(state, "tableau", 0, "hearts", 1);
    const at = grabPoint(state, 0, 0);
    press(state, at.x, at.y);
    release(state, at.x, at.y);
    state.simTime += 0.1;
    press(state, at.x, at.y);
    expect(state.foundations[0].map((c) => c.rank)).toEqual([1]);
    expect(state.drag).toBeNull();
    // The release that follows a double click changes nothing.
    release(state, at.x, at.y);
    expect(state.foundations[0]).toHaveLength(1);
  });

  it("does nothing when the second press is late or far away", () => {
    const late = playing();
    put(late, "tableau", 0, "hearts", 1);
    const at = grabPoint(late, 0, 0);
    press(late, at.x, at.y);
    release(late, at.x, at.y);
    late.simTime += DOUBLE_CLICK_WINDOW + 0.1;
    press(late, at.x, at.y);
    expect(late.foundations[0]).toHaveLength(0);

    const far = playing();
    put(far, "tableau", 0, "hearts", 1);
    press(far, at.x, at.y);
    release(far, at.x, at.y);
    far.simTime += 0.1;
    press(far, at.x + 40, at.y);
    expect(far.foundations[0]).toHaveLength(0);
  });

  it("does nothing on the bare table", () => {
    const state = playing();
    press(state, 640, 420);
    release(state, 640, 420);
    state.simTime += 0.1;
    press(state, 640, 420);
    expect(state.drag).toBeNull();
    expect(state.foundations.every((f) => f.length === 0)).toBe(true);
  });

  it("names the playable card under a point, and nothing elsewhere", () => {
    const state = playing();
    put(state, "tableau", 3, "clubs", 9, false);
    expect(playableAt(state, COLUMN_X[3] + 5, TABLEAU_Y + 5)).toBeNull();
    put(state, "tableau", 3, "hearts", 8);
    expect(playableAt(state, COLUMN_X[3] + 5, TABLEAU_Y + 24 + 5)).toEqual({
      pile: "tableau",
      index: 3,
    });
    expect(playableAt(state, 640, 660)).toBeNull();
  });
});

describe("the controls", () => {
  it("answers a click inside its rectangle, on the screen it belongs to", () => {
    const state = testState();
    press(state, TITLE_HOW_TO.x + 10, TITLE_HOW_TO.y + 10);
    release(state, TITLE_HOW_TO.x + 10, TITLE_HOW_TO.y + 10);
    expect(state.screen).toBe("howto");
    press(state, HOWTO_BACK.x + 10, HOWTO_BACK.y + 10);
    release(state, HOWTO_BACK.x + 10, HOWTO_BACK.y + 10);
    expect(state.screen).toBe("title");
    press(state, TITLE_NEW_GAME.x + 10, TITLE_NEW_GAME.y + 10);
    release(state, TITLE_NEW_GAME.x + 10, TITLE_NEW_GAME.y + 10);
    expect(state.screen).toBe("playing");
    expect(state.stock).toHaveLength(24);
  });

  it("deals from the HUD, returns to the title, and toggles the sound", () => {
    const state = playing();
    const bus = audio();
    press(state, HUD_SOUND.x + 10, HUD_SOUND.y + 10, bus);
    release(state, HUD_SOUND.x + 10, HUD_SOUND.y + 10, bus);
    expect(state.muted).toBe(true);
    expect(bus.muted()).toBe(true);
    press(state, HUD_SOUND.x + 10, HUD_SOUND.y + 10, bus);
    release(state, HUD_SOUND.x + 10, HUD_SOUND.y + 10, bus);
    expect(state.muted).toBe(false);

    press(state, HUD_NEW_GAME.x + 10, HUD_NEW_GAME.y + 10);
    release(state, HUD_NEW_GAME.x + 10, HUD_NEW_GAME.y + 10);
    expect(state.screen).toBe("playing");
    expect(state.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    press(state, HUD_MENU.x + 10, HUD_MENU.y + 10);
    release(state, HUD_MENU.x + 10, HUD_MENU.y + 10);
    expect(state.screen).toBe("title");
  });

  it("deals a fresh game on a press anywhere on the won screen", () => {
    const state = playing();
    state.screen = "won";
    state.trailStamps = 900;
    press(state, 20, 20);
    expect(state.screen).toBe("playing");
    expect(state.trailStamps).toBe(0);
    expect(state.tableau.flat()).toHaveLength(28);
  });
});
