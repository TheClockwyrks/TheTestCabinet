// The debug surface as pure transitions and readings over `CaromState`
// (specs/instrumentation.md). `src/engine.test.ts` drives it through a real
// engine; what is checked here is the shape of each operation by itself — what it
// sets, what it leaves alone, and that the state it is handed is never written.
//
// EVERY OPERATION IS ATOMIC, so the assertions come in pairs: the field the
// operation names took the value it was given, and the neighbouring fields it
// does not name are exactly what they were.

import { describe, expect, it } from "vitest";
import {
  BALL_COUNT,
  BALL_HOMES,
  CAROM_DEBUG_VERSION,
  FIELD_CY,
  HOLD_TIME,
  MATCHOVER_ITEMS,
  OBSTACLE_CENTERS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import { createDebugApi } from "./debug";
import { createInitialState } from "./flow";
import { menuFor } from "./menu";
import type { CaromState, Screen } from "./game";

const debug = createDebugApi();

/** A state mid-rally, with the player still in control. */
function rally(): CaromState {
  const title = createInitialState();
  return {
    ...title,
    screen: "playing",
    mode: "solo",
    menuIndex: 1,
    titleIndex: 2,
    resumeScreen: "countdown",
    score: { p1: 3, p2: 5 },
    simTime: 12.5,
    muted: true,
    paddles: {
      left: { cy: 200, vy: 50, driven: false, drivenVy: 0 },
      right: { cy: 500, vy: -50, driven: false, drivenVy: 0 },
    },
    balls: title.balls.map((ball, i) => ({
      ...ball,
      x: 100 + i * 300,
      y: 300,
      vx: 400,
      vy: 40,
      spin: 20,
      held: i === 2,
      holdTimer: i === 2 ? 0.4 : 0,
      trail: [{ x: 90 + i * 300, y: 299, t: 12.4 }],
    })),
  };
}

describe("every operation", () => {
  it("returns a new state and leaves the one it was handed as it was", () => {
    const before = rally();
    const frozen = JSON.stringify(before);
    const results = [
      debug.clearWorld(before),
      debug.spawnBall(before, 0),
      debug.spawnObstacle(before, 1),
      debug.reset(before),
      debug.setBallLaunchAngle(before, 0, 1),
      debug.drawBallLaunchAngle(before, 0),
      debug.setScreen(before, "paused"),
      debug.setMode(before, "versus"),
      debug.setMenuIndex(before, 2),
      debug.setTitleIndex(before, 1),
      debug.setResumeScreen(before, "playing"),
      debug.setScore(before, 1, 2),
      debug.setWinner(before, "right"),
      debug.setPaddleCy(before, "left", 1),
      debug.setPaddleVy(before, "left", 2),
      debug.setPaddleDriven(before, "left", true),
      debug.setBallPosition(before, 0, 1, 2),
      debug.setBallVelocity(before, 0, 3, 4),
      debug.setBallSpin(before, 0, 5),
      debug.setBallHeld(before, 0, true),
      debug.setBallHoldTimer(before, 0, 0.5),
      debug.setAiTracking(before, false),
      debug.setAiMovement(before, false),
    ];
    debug.snapshot(before);
    debug.menuItemRect(before, 0);
    expect(JSON.stringify(before)).toBe(frozen);
    for (const result of results) expect(result).not.toBe(before);
  });

  it("reports the surface version as a plain number", () => {
    expect(debug.version).toBe(CAROM_DEBUG_VERSION);
  });
});

// ---- The world ----------------------------------------------------------

describe("clearWorld", () => {
  it("empties the field of every ball and every obstacle", () => {
    const cleared = debug.clearWorld(rally());
    expect(cleared.balls).toEqual([]);
    expect(cleared.obstacles).toEqual([]);
  });

  it("leaves the paddles, the screen, and the scores alone", () => {
    const before = rally();
    const cleared = debug.clearWorld(before);
    expect(cleared.paddles).toEqual(before.paddles);
    expect(cleared.screen).toBe("playing");
    expect(cleared.score).toEqual({ p1: 3, p2: 5 });
  });
});

describe("spawnBall", () => {
  it("places a missing ball at its home, held, with a full hold timer", () => {
    const spawned = debug.spawnBall(debug.clearWorld(rally()), 1);
    expect(spawned.balls).toHaveLength(1);
    expect(spawned.balls[0]).toEqual({
      index: 1,
      x: BALL_HOMES[1].x,
      y: BALL_HOMES[1].y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      launchAngle: expect.any(Number),
      trail: [],
    });
  });

  it("keeps the balls in play order however they were spawned", () => {
    let state = debug.clearWorld(rally());
    for (const index of [2, 0, 1]) state = debug.spawnBall(state, index);
    expect(state.balls.map((ball) => ball.index)).toEqual([0, 1, 2]);
  });

  it("returns a ball already present to that same arrangement", () => {
    const before = rally();
    const respawned = debug.spawnBall(before, 0);
    expect(respawned.balls).toHaveLength(BALL_COUNT);
    expect(respawned.balls[0]).toEqual({
      index: 0,
      x: BALL_HOMES[0].x,
      y: BALL_HOMES[0].y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      launchAngle: expect.any(Number),
      trail: [],
    });
    // And nothing else moved.
    expect(respawned.balls[1]).toEqual(before.balls[1]);
  });

  it("leaves the state alone for an index this variant does not have", () => {
    const before = rally();
    for (const index of [-1, BALL_COUNT, 1.5, NaN]) {
      expect(debug.spawnBall(before, index)).toBe(before);
    }
  });
});

describe("spawnObstacle", () => {
  it("places a missing obstacle at its own fixed center", () => {
    const spawned = debug.spawnObstacle(debug.clearWorld(rally()), 1);
    expect(spawned.obstacles).toEqual([
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);
  });

  it("keeps the obstacles in the order OBSTACLE_CENTERS lists them", () => {
    let state = debug.clearWorld(rally());
    for (const index of [1, 0]) state = debug.spawnObstacle(state, index);
    expect(state.obstacles.map((o) => o.index)).toEqual([0, 1]);
  });

  it("leaves the state alone for an index the field does not have", () => {
    const before = rally();
    for (const index of [-1, OBSTACLE_CENTERS.length, 0.5]) {
      expect(debug.spawnObstacle(before, index)).toBe(before);
    }
  });
});

describe("reset", () => {
  it("restores every declared field but muted", () => {
    const reset = debug.reset(rally());
    expect(reset).toEqual({
      ...createInitialState(),
      muted: true,
      // Each parked ball draws its own launch angle.
      balls: reset.balls.map((ball, index) => ({
        ...createInitialState().balls[index],
        launchAngle: ball.launchAngle,
      })),
    });
  });

  it("returns the clock to zero", () => {
    const reset = debug.reset(rally());
    expect(reset.simTime).toBe(0);
  });

  it("releases both paddles and wakes both of the AI's faculties", () => {
    const taken = debug.setAiMovement(
      debug.setAiTracking(
        debug.setPaddleDriven(
          debug.setPaddleDriven(rally(), "left", true),
          "right",
          true,
        ),
        false,
      ),
      false,
    );
    const reset = debug.reset(taken);
    expect(reset.paddles.left.driven).toBe(false);
    expect(reset.paddles.right.driven).toBe(false);
    expect(reset.paddles.left.drivenVy).toBe(0);
    expect(reset.ai).toEqual({ tracking: true, movement: true });
  });

  it("puts the world back exactly as the spawns place it", () => {
    const reset = debug.reset(debug.clearWorld(rally()));
    expect(reset.balls).toHaveLength(BALL_COUNT);
    expect(reset.balls.every((ball) => ball.held)).toBe(true);
    expect(reset.obstacles.map((o) => o.index)).toEqual([0, 1]);
  });
});

describe("setBallLaunchAngle", () => {
  it("sets one ball's launch angle and nothing else", () => {
    const before = rally();
    const posed = debug.setBallLaunchAngle(before, 1, 2.5);
    expect(posed.balls[1].launchAngle).toBe(2.5);
    expect(posed.balls[0]).toEqual(before.balls[0]);
    expect(posed.balls[2]).toEqual(before.balls[2]);
    expect(posed.simTime).toBe(before.simTime);
  });
});

describe("drawBallLaunchAngle", () => {
  it("draws one ball's launch angle afresh, inside the circle", () => {
    const before = debug.setBallLaunchAngle(rally(), 1, -1);
    const drawn = debug.drawBallLaunchAngle(before, 1);
    expect(drawn.balls[1].launchAngle).toBeGreaterThanOrEqual(0);
    expect(drawn.balls[1].launchAngle).toBeLessThan(2 * Math.PI);
    expect(drawn.balls[0]).toEqual(before.balls[0]);
    expect(drawn.balls[2]).toEqual(before.balls[2]);
  });
});

// ---- Screens and menus --------------------------------------------------

describe("the screen and menu poses", () => {
  it("each set their own field and leave the others alone", () => {
    const before = rally();
    expect(debug.setScreen(before, "matchover").screen).toBe("matchover");
    expect(debug.setScreen(before, "matchover").menuIndex).toBe(1);
    expect(debug.setScreen(before, "matchover").score).toEqual(before.score);

    expect(debug.setMode(before, "versus").mode).toBe("versus");
    expect(debug.setMenuIndex(before, 2).menuIndex).toBe(2);
    expect(debug.setMenuIndex(before, 2).titleIndex).toBe(2);
    expect(debug.setTitleIndex(before, 0).titleIndex).toBe(0);
    expect(debug.setTitleIndex(before, 0).menuIndex).toBe(1);
    expect(debug.setResumeScreen(before, "playing").resumeScreen).toBe(
      "playing",
    );
  });
});

// ---- Match state --------------------------------------------------------

describe("setScore and setWinner", () => {
  it("sets both scores as one fixed pair", () => {
    const set = debug.setScore(rally(), 10, 9);
    expect(set.score).toEqual({ p1: 10, p2: 9 });
    expect(set.winner).toBeNull();
    expect(set.screen).toBe("playing");
  });

  it("sets and clears the winning side", () => {
    expect(debug.setWinner(rally(), "right").winner).toBe("right");
    expect(debug.setWinner(debug.setWinner(rally(), "left"), null).winner).toBe(
      null,
    );
  });
});

// ---- Paddles ------------------------------------------------------------

describe("the paddle poses", () => {
  it("sets one side's center and leaves the other side untouched", () => {
    const set = debug.setPaddleCy(rally(), "right", 123);
    expect(set.paddles.right.cy).toBe(123);
    expect(set.paddles.right.vy).toBe(-50);
    expect(set.paddles.left).toEqual(rally().paddles.left);
  });

  it("writes drivenVy and leaves the integrated vy alone", () => {
    const set = debug.setPaddleVy(rally(), "left", 300);
    expect(set.paddles.left.drivenVy).toBe(300);
    expect(set.paddles.left.vy).toBe(50);
    expect(set.paddles.left.driven).toBe(false);
    expect(set.paddles.right.drivenVy).toBe(0);
  });

  it("takes one side and hands it back without touching the other", () => {
    const taken = debug.setPaddleDriven(rally(), "left", true);
    expect(taken.paddles.left.driven).toBe(true);
    expect(taken.paddles.right.driven).toBe(false);
    expect(
      debug.setPaddleDriven(taken, "left", false).paddles.left.driven,
    ).toBe(false);
  });

  it("keeps drivenVy across a release and a re-take", () => {
    const set = debug.setPaddleVy(rally(), "right", -220);
    const cycled = debug.setPaddleDriven(
      debug.setPaddleDriven(set, "right", true),
      "right",
      false,
    );
    expect(cycled.paddles.right.drivenVy).toBe(-220);
  });
});

// ---- Balls --------------------------------------------------------------

describe("the ball poses", () => {
  it("sets one field of one ball and leaves the rest as they were", () => {
    const before = rally();
    const moved = debug.setBallPosition(before, 1, 11, 22);
    expect(moved.balls[1].x).toBe(11);
    expect(moved.balls[1].y).toBe(22);
    expect(moved.balls[1].vx).toBe(400);
    expect(moved.balls[0]).toEqual(before.balls[0]);

    expect(debug.setBallVelocity(before, 1, 3, 4).balls[1].vx).toBe(3);
    expect(debug.setBallVelocity(before, 1, 3, 4).balls[1].x).toBe(400);
    expect(debug.setBallSpin(before, 1, -9).balls[1].spin).toBe(-9);
    expect(debug.setBallHeld(before, 0, true).balls[0].held).toBe(true);
    expect(debug.setBallHeld(before, 0, true).balls[0].holdTimer).toBe(0);
    expect(debug.setBallHoldTimer(before, 2, 0).balls[2].holdTimer).toBe(0);
    expect(debug.setBallHoldTimer(before, 2, 0).balls[2].held).toBe(true);
  });

  it("does nothing at all when the ball named is absent", () => {
    const emptied = debug.clearWorld(rally());
    expect(debug.setBallPosition(emptied, 0, 1, 2)).toBe(emptied);
    expect(debug.setBallVelocity(emptied, 0, 1, 2)).toBe(emptied);
    expect(debug.setBallSpin(emptied, 0, 1)).toBe(emptied);
    expect(debug.setBallHeld(emptied, 0, true)).toBe(emptied);
    expect(debug.setBallHoldTimer(emptied, 0, 1)).toBe(emptied);
  });

  it("does nothing for an index this variant does not have", () => {
    const before = rally();
    for (const index of [-1, BALL_COUNT, 1.5, NaN]) {
      expect(debug.setBallPosition(before, index, 1, 2)).toBe(before);
    }
  });
});

// ---- The AI opponent ----------------------------------------------------

describe("the AI faculties", () => {
  it("gates each one on its own", () => {
    const blind = debug.setAiTracking(rally(), false);
    expect(blind.ai).toEqual({ tracking: false, movement: true });
    const still = debug.setAiMovement(blind, false);
    expect(still.ai).toEqual({ tracking: false, movement: false });
    expect(debug.setAiTracking(still, true).ai.movement).toBe(false);
  });
});

// ---- Readings -----------------------------------------------------------

describe("snapshot", () => {
  it("reads every field straight off the state, with speed derived", () => {
    const state = rally();
    expect(debug.snapshot(state)).toEqual({
      version: CAROM_DEBUG_VERSION,
      screen: "playing",
      mode: "solo",
      menuIndex: 1,
      titleIndex: 2,
      resumeScreen: "countdown",
      score: { p1: 3, p2: 5 },
      winner: null,
      muted: true,
      paddles: {
        left: { cy: 200, vy: 50, drivenVy: 0, driven: false },
        right: { cy: 500, vy: -50, drivenVy: 0, driven: false },
      },
      ai: { tracking: true, movement: true },
      balls: state.balls.map((ball) => ({
        index: ball.index,
        x: ball.x,
        y: ball.y,
        vx: 400,
        vy: 40,
        speed: Math.hypot(400, 40),
        spin: 20,
        held: ball.held,
        holdTimer: ball.holdTimer,
        launchAngle: ball.launchAngle,
        trail: [{ x: ball.x - 10, y: 299, t: 12.4 }],
      })),
      obstacles: [
        { index: 0, cx: OBSTACLE_CENTERS[0].x, cy: OBSTACLE_CENTERS[0].y },
        { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
      ],
      simTime: 12.5,
    });
  });

  it("reports only what is present, so a cleared field reports neither", () => {
    const snap = debug.snapshot(debug.clearWorld(rally()));
    expect(snap.balls).toEqual([]);
    expect(snap.obstacles).toEqual([]);
  });

  it("carries each entity's own index", () => {
    const one = debug.spawnBall(debug.clearWorld(rally()), 2);
    expect(debug.snapshot(one).balls.map((ball) => ball.index)).toEqual([2]);
    const obstacle = debug.spawnObstacle(one, 1);
    expect(debug.snapshot(obstacle).obstacles.map((o) => o.index)).toEqual([1]);
  });

  it("returns a fresh plain object, sharing nothing with the state", () => {
    const state = rally();
    const snap = debug.snapshot(state);
    expect(snap.score).not.toBe(state.score);
    expect(snap.paddles.left).not.toBe(state.paddles.left);
    expect(snap.balls[0].trail).not.toBe(state.balls[0].trail);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("reports the title screen exactly as specs/state.md fixes it", () => {
    const snap = debug.snapshot(createInitialState());
    expect(snap.screen).toBe("title");
    expect(snap.mode).toBe("solo");
    expect(snap.menuIndex).toBe(0);
    expect(snap.titleIndex).toBe(0);
    expect(snap.resumeScreen).toBe("playing");
    expect(snap.winner).toBeNull();
    expect(snap.simTime).toBe(0);
    expect(snap.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
    expect(snap.ai).toEqual({ tracking: true, movement: true });
    expect(snap.balls).toHaveLength(BALL_COUNT);
    expect(snap.balls.every((ball) => ball.holdTimer === HOLD_TIME)).toBe(true);
    expect(snap.obstacles).toHaveLength(OBSTACLE_CENTERS.length);
  });
});

describe("menuItemRect", () => {
  const counts: Record<string, number> = {
    title: TITLE_ITEMS.length,
    howto: 1,
    paused: PAUSE_ITEMS.length,
    matchover: MATCHOVER_ITEMS.length,
  };

  it("reports one region per item of the menu the screen shows", () => {
    for (const [screen, count] of Object.entries(counts)) {
      const state = debug.setScreen(rally(), screen as Screen);
      for (let index = 0; index < count; index++) {
        const rect = debug.menuItemRect(state, index);
        expect(rect).not.toBeNull();
        expect(rect?.w).toBeGreaterThan(0);
        expect(rect?.h).toBeGreaterThan(0);
      }
      expect(debug.menuItemRect(state, count)).toBeNull();
      expect(debug.menuItemRect(state, -1)).toBeNull();
    }
  });

  it("reports none on the two screens that show no menu", () => {
    for (const screen of ["countdown", "playing"] as const) {
      const state = debug.setScreen(rally(), screen);
      expect(debug.menuItemRect(state, 0)).toBeNull();
    }
  });

  it("reports the regions the build actually lays the items out at", () => {
    const state = debug.setScreen(rally(), "title");
    const layout = menuFor("title");
    const rect = debug.menuItemRect(state, 1);
    expect(layout).not.toBeNull();
    expect(rect).toEqual({
      x: (layout?.centerX ?? 0) - (layout?.hitW ?? 0) / 2,
      y:
        (layout?.startY ?? 0) +
        (layout?.spacing ?? 0) -
        (layout?.hitH ?? 0) / 2,
      w: layout?.hitW,
      h: layout?.hitH,
    });
  });

  it("keeps consecutive items apart, so a point lands on at most one", () => {
    const state = debug.setScreen(rally(), "title");
    const first = debug.menuItemRect(state, 0);
    const second = debug.menuItemRect(state, 1);
    expect((first?.y ?? 0) + (first?.h ?? 0)).toBeLessThan(second?.y ?? 0);
  });
});
