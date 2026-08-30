// The eight screens, their menus, and where confirming a row leads.

import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_ITEMS,
  DIFFICULTY_TABLE,
  ENDING_ITEMS,
  MODE_ITEMS,
  PAUSE_ITEMS,
  START_LIVES,
  SUDDEN_DEATH_LIVES,
  TITLE_ITEMS,
} from "./constants";
import { menuRows } from "./flow";
import { menuRowRect } from "./layout";
import { createHarness, poseTower, startRun, type Harness } from "./harness";

/** The centre of one menu row on the screen the game is showing. */
function rowCentre(harness: Harness, index: number): [number, number] {
  const screen = harness.debug.snapshot().screen;
  const rect = menuRowRect(screen, index);
  if (rect === null) throw new Error(`no menu on ${screen}`);
  return [rect.x + rect.w / 2, rect.y + rect.h / 2];
}

describe("the menus", () => {
  it("counts the rows each screen states", () => {
    expect(menuRows("title")).toBe(TITLE_ITEMS.length);
    expect(menuRows("modeselect")).toBe(MODE_ITEMS.length);
    expect(menuRows("difficultyselect")).toBe(DIFFICULTY_ITEMS.length);
    expect(menuRows("paused")).toBe(PAUSE_ITEMS.length);
    expect(menuRows("victory")).toBe(ENDING_ITEMS.length);
    expect(menuRows("gameover")).toBe(ENDING_ITEMS.length);
    expect(menuRows("howto")).toBe(0);
    expect(menuRows("playing")).toBe(0);
  });

  it("wraps down from the last row and up from the first, on every menu", async () => {
    const harness = await createHarness();
    for (const screen of ["title", "modeselect", "difficultyselect", "paused", "victory", "gameover"] as const) {
      const rows = menuRows(screen);
      harness.debug.setScreen(screen);
      harness.debug.setMenuIndex(rows - 1);
      harness.tap("ArrowDown");
      await harness.engine.advance(1);
      expect(harness.debug.snapshot().menuIndex).toBe(0);

      harness.debug.setScreen(screen);
      harness.debug.setMenuIndex(0);
      harness.tap("ArrowUp");
      await harness.engine.advance(1);
      expect(harness.debug.snapshot().menuIndex).toBe(rows - 1);
    }
    harness.dispose();
  });

  it("moves the highlight with left and right as well", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("modeselect");
    harness.debug.setMenuIndex(0);
    harness.tap("ArrowRight");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().menuIndex).toBe(1);
    harness.tap("ArrowLeft");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().menuIndex).toBe(0);
    harness.dispose();
  });

  it("sounds the menu cue when the highlight moves, and not otherwise", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("howto");
    harness.debug.setMenuIndex(0);
    harness.cues.length = 0;
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.cues.filter((c) => c.cue === "menu")).toHaveLength(0);

    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(0);
    harness.cues.length = 0;
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.cues.filter((c) => c.cue === "menu")).toHaveLength(1);
    harness.dispose();
  });

  it("answers a move and a confirm arriving on one frame as two presses", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(0);
    harness.tap("ArrowDown");
    harness.tap("Enter");
    await harness.engine.advance(1);
    // Down took the highlight to HOW TO PLAY, and the confirm took that row.
    expect(harness.debug.snapshot().screen).toBe("howto");
    harness.dispose();
  });
});

describe("where each row leads", () => {
  it("takes PLAY to modeselect and HOW TO PLAY to howto, starting no game", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(0);
    harness.tap("Enter");
    await harness.engine.advance(1);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("modeselect");
    expect(snapshot.menuIndex).toBe(0);

    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("howto");
    harness.dispose();
  });

  it("does nothing on back from the title", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("title");
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("title");
    harness.dispose();
  });

  it("takes CONTAINMENT to difficultyselect and every other mode into play", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("modeselect");
    harness.debug.setMenuIndex(0);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("difficultyselect");

    for (const [index, mode] of (
      ["hundred", "deeppockets", "bottleneck", "suddendeath"] as const
    ).entries()) {
      harness.debug.reset();
      harness.debug.setScreen("modeselect");
      harness.debug.setMenuIndex(index + 1);
      harness.tap("Enter");
      await harness.engine.advance(1);
      const snapshot = harness.debug.snapshot();
      expect(snapshot.screen).toBe("playing");
      expect(snapshot.phase).toBe("opening");
      expect(snapshot.mode).toBe(mode);
      expect(snapshot.wave).toBe(1);
      expect(snapshot.money).toBe(snapshot.startMoney);
      expect(snapshot.lives).toBe(snapshot.startLives);
    }
    harness.dispose();
  });

  it("opens Sudden Death on one life and every other mode on twenty", async () => {
    const harness = await createHarness();
    harness.debug.setMode("suddendeath");
    expect(harness.debug.snapshot().startLives).toBe(SUDDEN_DEATH_LIVES);
    harness.debug.setMode("hundred");
    expect(harness.debug.snapshot().startLives).toBe(START_LIVES);
    harness.dispose();
  });

  it("opens Containment at the difficulty confirmed, with that row's figures", async () => {
    const harness = await createHarness();
    for (const [index, difficulty] of DIFFICULTY_ITEMS.entries()) {
      const key = (["easy", "medium", "hard"] as const)[index];
      harness.debug.reset();
      harness.debug.setScreen("difficultyselect");
      harness.debug.setMenuIndex(index);
      harness.tap("Enter");
      await harness.engine.advance(1);
      const snapshot = harness.debug.snapshot();
      expect(difficulty).toBeTruthy();
      expect(snapshot.screen).toBe("playing");
      expect(snapshot.mode).toBe("containment");
      expect(snapshot.difficulty).toBe(key);
      expect(snapshot.money).toBe(DIFFICULTY_TABLE[key].money);
      expect(snapshot.waveCount).toBe(DIFFICULTY_TABLE[key].waves);
    }
    harness.dispose();
  });

  it("returns from difficultyselect to modeselect and from howto to the title", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("difficultyselect");
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("modeselect");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("title");

    harness.debug.setScreen("howto");
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("title");
    harness.dispose();
  });
});

describe("the pause menu", () => {
  it("opens on the pause key and resumes with the floor as it was", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setScreen("playing");
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("paused");

    harness.tap("KeyP");
    await harness.engine.advance(1);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.towers.map((t) => t.id)).toContain(id);
    harness.dispose();
  });

  it("resumes on RESUME and on back, and quits to the title on QUIT TO MENU", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("paused");
    harness.debug.setMenuIndex(0);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("playing");

    harness.debug.setScreen("paused");
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("playing");

    harness.debug.setScreen("paused");
    harness.debug.setMenuIndex(2);
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("title");
    harness.dispose();
  });

  it("restarts the same pair from its opening phase on RESTART", async () => {
    const harness = await createHarness();
    startRun(harness, "bottleneck");
    poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setMoney(7);
    harness.debug.setScore(500);
    harness.debug.setWave(6);
    harness.debug.setScreen("paused");
    harness.debug.setMenuIndex(1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.phase).toBe("opening");
    expect(snapshot.mode).toBe("bottleneck");
    expect(snapshot.wave).toBe(1);
    expect(snapshot.score).toBe(0);
    expect(snapshot.money).toBe(snapshot.startMoney);
    expect(snapshot.towers).toHaveLength(0);
    harness.dispose();
  });
});

describe("the end screens", () => {
  it("replays the pair just played on PLAY AGAIN and leaves on MENU", async () => {
    const harness = await createHarness();
    startRun(harness, "containment", "hard");
    harness.debug.setScreen("victory");
    harness.debug.setMenuIndex(0);
    harness.tap("Enter");
    await harness.engine.advance(1);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.difficulty).toBe("hard");
    expect(snapshot.money).toBe(DIFFICULTY_TABLE.hard.money);

    harness.debug.setScreen("gameover");
    harness.debug.setMenuIndex(1);
    harness.tap("Enter");
    await harness.engine.advance(1);
    snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("title");

    harness.debug.setScreen("victory");
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("title");
    harness.dispose();
  });
});

describe("a tap on a menu row", () => {
  it("highlights the row and takes it, exactly as a confirm does", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(0);
    const [x, y] = rowCentre(harness, 1);
    await harness.press(x, y);
    expect(harness.debug.snapshot().screen).toBe("howto");
    harness.dispose();
  });

  it("leaves the screen where it is when the press lands on no row", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("title");
    harness.debug.setMenuIndex(0);
    await harness.press(20, 20);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    harness.dispose();
  });
});
