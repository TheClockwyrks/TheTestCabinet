// The screen transitions specs/ui.md fixes, checked as pure calls: what a match
// start sets, what a path back to the title restores and what it keeps, and how
// `reset` differs from quitting to the menu.

import { describe, expect, it } from "vitest";
import {
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  OBSTACLE_SPIN_RATE,
} from "./constants";
import { createInitialState, type CaromState } from "./game";
import {
  confirmMenuItem,
  pauseMatch,
  resetToTitle,
  resumeMatch,
  startMatch,
  toTitle,
  withObstacleClock,
} from "./screens";

/** A state deliberately far from the title, to see what a transition restores. */
function messy(): CaromState {
  const base = createInitialState();
  return {
    ...base,
    screen: "playing",
    mode: "versus",
    menuIndex: 2,
    titleIndex: 1,
    resumeScreen: "countdown",
    score: { p1: 7, p2: 4 },
    winner: "left",
    receiver: "right",
    paddles: {
      left: { cy: 120, vy: -300, driven: true, drivenVy: -300 },
      right: { cy: 600, vy: 200, driven: true, drivenVy: 200 },
    },
    ai: { tracking: false, movement: false },
    ball: null,
    obstacles: [],
    obstacleClock: 2.5,
    obstacleClockRunning: false,
    simTime: 42,
    muted: true,
  };
}

describe("toTitle", () => {
  it("restores every declared field but the five a menu path keeps", () => {
    const next = toTitle(messy());
    expect(next.screen).toBe("title");
    expect(next.mode).toBe("solo");
    expect(next.resumeScreen).toBe("playing");
    expect(next.score).toEqual({ p1: 0, p2: 0 });
    expect(next.winner).toBeNull();
    expect(next.receiver).toBe("left");
    expect(next.ai).toEqual({ tracking: true, movement: true });
    expect(next.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      driven: false,
      drivenVy: 0,
    });
    expect(next.ball?.holdTimer).toBe(HOLD_TIME);
    expect(next.obstacles.map((o) => o.index)).toEqual([0, 1]);
    expect(next.obstacleClock).toBe(0);
    expect(next.obstacleClockRunning).toBe(true);
    expect(next.pointerPresses).toEqual([]);

    // The three it keeps.
    expect(next.titleIndex).toBe(1);
    expect(next.simTime).toBe(42);
    expect(next.muted).toBe(true);
  });

  it("highlights the entry that led away from the title", () => {
    expect(toTitle(messy()).menuIndex).toBe(1);
  });
});

describe("resetToTitle", () => {
  it("restores the three a menu path keeps, and leaves only the mute bit", () => {
    const next = resetToTitle(messy());
    expect(next.menuIndex).toBe(0);
    expect(next.titleIndex).toBe(0);
    expect(next.simTime).toBe(0);
    expect(next.muted).toBe(true);
  });
});

describe("startMatch", () => {
  it("opens on the countdown with everything specs/ui.md lists", () => {
    const next = startMatch(messy(), "solo");
    expect(next.screen).toBe("countdown");
    expect(next.mode).toBe("solo");
    expect(next.resumeScreen).toBe("playing");
    expect(next.menuIndex).toBe(0);
    expect(next.score).toEqual({ p1: 0, p2: 0 });
    expect(next.winner).toBeNull();
    expect(next.receiver).toBe("left");
    expect(next.ball).toEqual({
      x: 640,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      serveSign: expect.any(Number),
      trail: [],
    });
    expect(next.paddles.left.cy).toBe(FIELD_CY);
    expect(next.paddles.left.vy).toBe(0);
    expect(next.obstacleClock).toBe(0);
    expect(next.obstacleClockRunning).toBe(true);
  });

  it("keeps `titleIndex` and says nothing about who holds a paddle", () => {
    const next = startMatch(messy(), "versus");
    expect(next.titleIndex).toBe(1);
    expect(next.paddles.left.driven).toBe(true);
    expect(next.paddles.left.drivenVy).toBe(-300);
    expect(next.ai).toEqual({ tracking: false, movement: false });
  });

  it("re-poses the obstacles that are present, and spawns none back", () => {
    const withOne: CaromState = {
      ...createInitialState(),
      obstacles: [{ index: 1, cx: 1, cy: 2, theta: 3 }],
      obstacleClock: 9,
    };
    const next = startMatch(withOne, "solo");
    expect(next.obstacles).toHaveLength(1);
    expect(next.obstacles[0].index).toBe(1);
    expect(next.obstacles[0].cy).toBeCloseTo(OBSTACLE_CENTERS[1].y, 9);
    expect(next.obstacles[0].theta).toBe(0);
  });
});

describe("pause and resume", () => {
  it("remembers which of the two live screens it interrupted", () => {
    const playing = createInitialState();
    expect(pauseMatch({ ...playing, screen: "playing" })).toMatchObject({
      screen: "paused",
      resumeScreen: "playing",
      menuIndex: 0,
    });
    expect(pauseMatch({ ...playing, screen: "countdown" })).toMatchObject({
      screen: "paused",
      resumeScreen: "countdown",
    });
  });

  it("resumes to whichever it remembered", () => {
    const paused: CaromState = {
      ...createInitialState(),
      screen: "paused",
      resumeScreen: "countdown",
    };
    expect(resumeMatch(paused).screen).toBe("countdown");
  });
});

describe("confirmMenuItem", () => {
  const title = createInitialState();

  it("starts each mode from the title and remembers the entry", () => {
    expect(confirmMenuItem(title, 0)).toMatchObject({
      screen: "countdown",
      mode: "solo",
      titleIndex: 0,
    });
    expect(confirmMenuItem(title, 1)).toMatchObject({
      screen: "countdown",
      mode: "versus",
      titleIndex: 1,
    });
    expect(confirmMenuItem(title, 2)).toMatchObject({
      screen: "howto",
      menuIndex: 0,
      titleIndex: 2,
    });
  });

  it("takes each pause item where specs/ui.md sends it", () => {
    const paused: CaromState = {
      ...title,
      screen: "paused",
      mode: "versus",
      resumeScreen: "countdown",
      titleIndex: 2,
    };
    expect(confirmMenuItem(paused, 0).screen).toBe("countdown"); // RESUME
    expect(confirmMenuItem(paused, 1)).toMatchObject({
      screen: "countdown",
      mode: "versus",
    }); // RESTART
    expect(confirmMenuItem(paused, 2)).toMatchObject({
      screen: "title",
      menuIndex: 2,
    }); // QUIT TO MENU
  });

  it("takes each match-over item where specs/ui.md sends it", () => {
    const over: CaromState = {
      ...title,
      screen: "matchover",
      mode: "versus",
      titleIndex: 1,
      winner: "right",
    };
    expect(confirmMenuItem(over, 0)).toMatchObject({
      screen: "countdown",
      mode: "versus",
      winner: null,
    });
    expect(confirmMenuItem(over, 1)).toMatchObject({
      screen: "title",
      menuIndex: 1,
    });
  });

  it("returns to the title from the how-to screen's single item", () => {
    const howto: CaromState = { ...title, screen: "howto", titleIndex: 2 };
    expect(confirmMenuItem(howto, 0)).toMatchObject({
      screen: "title",
      menuIndex: 2,
    });
  });

  it("does nothing for an index that names no item, or on a live screen", () => {
    expect(confirmMenuItem(title, 3)).toBe(title);
    expect(confirmMenuItem(title, -1)).toBe(title);
    const playing: CaromState = { ...title, screen: "playing" };
    expect(confirmMenuItem(playing, 0)).toBe(playing);
  });
});

describe("withObstacleClock", () => {
  it("re-poses the obstacles present, and spawns none back", () => {
    const cleared: CaromState = { ...createInitialState(), obstacles: [] };
    expect(withObstacleClock(cleared, 1).obstacles).toEqual([]);

    const next = withObstacleClock(createInitialState(), 1);
    expect(next.obstacleClock).toBe(1);
    expect(next.obstacles[0].theta).toBeCloseTo(OBSTACLE_SPIN_RATE, 9);
  });
});
