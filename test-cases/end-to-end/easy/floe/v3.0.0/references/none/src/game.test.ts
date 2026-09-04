// The rules: the hop and every refusal, the bays, the run, the scoring, and the
// six screens. Each scenario is posed through the debugging surface and then let
// run, exactly as a driver would drive it.

import { describe, expect, it } from "vitest";
import {
  BAYFILL_PAUSE,
  BAYS,
  BONUS_LIFE_EVERY,
  CLEAR_PAUSE,
  CUES,
  DEATH_PAUSE,
  HOP_COOLDOWN,
  ROW_MEDIAN,
  ROW_NEAR,
  TICK_DT,
  SCORE_BAY,
  SCORE_BONUS_CATCH,
  SCORE_LEVEL,
  SCORE_ROW,
  SCORE_TIME_BONUS,
  SCORE_VICTORY_LIFE,
  START_COL,
  START_LIVES,
  STRAIT_W,
  TILE,
  TOTAL_LEVELS,
  crossingTimer,
  tileCX,
  tileLeft,
} from "./constants";
import { createDebugApi, type FloeDebugApi } from "./debug";
import { createFloe } from "./game";
import { Keyboard } from "./keyboard";
import { harness, lastId, startCrossing } from "./harness.test-support";

describe("hopping", () => {
  it("moves exactly one tile per press", () => {
    const h = harness();
    startCrossing(h);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().critter.row).toBe(ROW_NEAR - 1);
    h.advance(5);
    expect(h.api.snapshot().critter.row).toBe(ROW_NEAR - 1);
  });

  it("ignores a press inside the cooldown and takes one at its end", () => {
    const h = harness();
    startCrossing(h);
    h.hold("up");
    h.advance(1);
    h.hold(null);
    h.seconds(0.06);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().critter.row).toBe(ROW_NEAR - 1);
    h.hold(null);
    h.seconds(HOP_COOLDOWN);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().critter.row).toBe(ROW_NEAR - 2);
  });

  it("auto-repeats a held direction at the cooldown", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(START_COL, ROW_NEAR);
    h.hold("left");
    h.seconds(1);
    const moved = START_COL - h.api.snapshot().critter.col;
    expect(
      Math.abs(moved - (Math.floor(1 / HOP_COOLDOWN) + 1)),
    ).toBeLessThanOrEqual(1);
  });

  it("puts the critter's centre exactly on the target tile, riding or not", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, 5);
    h.api.addFloe(5, "raft4", tileLeft(18));
    h.api.setLaneSpeed(5, 4);
    h.api.setLaneDirection(5, 1);
    h.seconds(0.2);
    const drifted = h.api.snapshot().critter;
    expect(drifted.x).not.toBe(tileCX(20));
    const column = drifted.col;
    h.hold("up");
    h.advance(1);
    const hopped = h.api.snapshot().critter;
    expect(hopped.x).toBe(tileCX(column));
    expect(hopped.row).toBe(4);
  });

  it("refuses a hop off either edge and below the near shore", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(0, ROW_MEDIAN);
    h.hold("left");
    h.advance(1);
    expect(h.api.snapshot().critter.col).toBe(0);

    h.api.setCritterTile(39, ROW_MEDIAN);
    h.api.setHopCooldown(0);
    h.hold("right");
    h.advance(1);
    expect(h.api.snapshot().critter.col).toBe(39);

    h.api.setCritterTile(START_COL, ROW_NEAR);
    h.api.setHopCooldown(0);
    h.hold("down");
    h.advance(1);
    expect(h.api.snapshot().critter.row).toBe(ROW_NEAR);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
  });

  it("refuses a hop into the solid far shore and into a filled bay", () => {
    const h = harness();
    startCrossing(h);
    // A raft the whole width of row 2, held still: the critter has to survive
    // standing there while its hop is refused, or the refusal is untestable.
    for (let col = 0; col < 40; col += 4)
      h.api.addFloe(2, "raft4", tileLeft(col));
    h.api.setLaneSpeed(2, 0);

    h.api.setCritterTile(8, 2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().critter.row).toBe(2);
    expect(h.api.snapshot().critter.present).toBe(true);

    h.api.setBay(0, true);
    h.api.setCritterTile(BAYS[0][0], 2);
    h.api.setHopCooldown(0);
    h.advance(1);
    expect(h.api.snapshot().critter.row).toBe(2);
    expect(h.api.snapshot().bays[0]).toBe(true);

    h.api.setBay(0, false);
    h.api.setHopCooldown(0);
    h.advance(1);
    const shot = h.api.snapshot();
    expect(shot.bays[0]).toBe(true);
    expect(shot.critter.present).toBe(false);
  });

  it("refuses a hop onto a tile a vehicle covers, and scores nothing for it", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, 12);
    h.api.addVehicle(11, "plow", tileLeft(19));
    h.api.setLaneSpeed(11, 0);
    const score = h.api.snapshot().score;
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().critter.row).toBe(12);
    expect(h.api.snapshot().score).toBe(score);
    expect(h.bus.cues).not.toContain(CUES.hop);
  });

  it("faces the way it last hopped", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, 14);
    for (const facing of ["up", "down", "left", "right"] as const) {
      h.api.setHopCooldown(0);
      h.hold(facing);
      h.advance(1);
      expect(h.api.snapshot().critter.facing).toBe(facing);
    }
  });
});

describe("the water", () => {
  it("reports the footing of the tile the critter stands on", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, ROW_MEDIAN);
    expect(h.api.snapshot().critter.footing).toBe("solid");
    h.api.setCritterTile(20, 6);
    expect(h.api.snapshot().critter.footing).toBe("water");
    h.api.addFloe(6, "raft4", tileLeft(18));
    h.api.setLaneSpeed(6, 0);
    expect(h.api.snapshot().critter.footing).toBe("floe");
  });

  it("carries a rider at its lane's speed and direction", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, 6);
    h.api.addFloe(6, "raft4", tileLeft(19));
    h.api.setLaneSpeed(6, 3);
    h.api.setLaneDirection(6, 1);
    const before = h.api.snapshot().critter.x;
    h.seconds(1);
    const after = h.api.snapshot().critter;
    expect(after.x - before).toBeCloseTo(3 * TILE, 0);
    expect(after.col).toBe(Math.floor(after.x / TILE));
  });

  it("costs a life on open water and off either edge", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, 6);
    h.advance(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
    expect(h.api.snapshot().phase).toBe("dying");

    startCrossing(h);
    h.api.addFloe(6, "raft4", 0);
    h.api.setLaneSpeed(6, 6);
    h.api.setLaneDirection(6, -1);
    h.api.setCritterTile(1, 6);
    h.seconds(0.5);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);

    startCrossing(h);
    h.api.addFloe(6, "raft4", STRAIT_W - TILE);
    h.api.setLaneSpeed(6, 6);
    h.api.setLaneDirection(6, 1);
    h.api.setCritterTile(39, 6);
    h.seconds(0.5);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
  });
});

describe("the ice", () => {
  it("crushes only under a moving vehicle", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, 14);
    h.api.addVehicle(14, "plow", tileLeft(19));
    h.api.setLaneSpeed(14, 0);
    h.seconds(3);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
    h.api.setLaneSpeed(14, 2);
    h.advance(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
    expect(h.bus.cues).toContain(CUES.crush);
  });
});

describe("the bays", () => {
  it("fills the bay the crossing ends in, and no other", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(BAYS[2][0], 2);
    h.hold("up");
    h.advance(1);
    const shot = h.api.snapshot();
    expect(shot.bays).toEqual([false, false, true, false, false]);
    expect(shot.critter.present).toBe(false);
    expect(shot.phase).toBe("crossing");
    expect(shot.phaseTimer).toBeCloseTo(BAYFILL_PAUSE, 6);
  });

  it("begins a fresh crossing once the hold has run out", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(10);
    h.api.setCritterTile(BAYS[1][1], 2);
    h.hold("up");
    h.advance(1);
    h.hold(null);
    h.seconds(BAYFILL_PAUSE + 0.02);
    const shot = h.api.snapshot();
    expect(shot.critter.present).toBe(true);
    expect(shot.critter.col).toBe(START_COL);
    expect(shot.critter.row).toBe(ROW_NEAR);
    expect(shot.timer).toBeCloseTo(crossingTimer(1), 6);
  });

  it("clears the level on the hop that fills the last bay, not on the count", () => {
    const h = harness();
    startCrossing(h);
    for (const bay of [0, 1, 2, 3, 4]) h.api.setBay(bay, true);
    h.seconds(5);
    expect(h.api.snapshot().phase).toBe("crossing");

    h.api.setBay(4, false);
    h.api.setCritterTile(BAYS[4][0], 2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().phase).toBe("clearing");
  });

  it("opens the next level with five open bays", () => {
    const h = harness();
    startCrossing(h);
    for (const bay of [0, 1, 2, 3]) h.api.setBay(bay, true);
    h.api.setCritterTile(BAYS[4][0], 2);
    h.hold("up");
    h.advance(1);
    h.hold(null);
    h.seconds(CLEAR_PAUSE + 0.02);
    const shot = h.api.snapshot();
    expect(shot.level).toBe(2);
    expect(shot.bays).toEqual([false, false, false, false, false]);
    expect(shot.phase).toBe("crossing");
  });

  it("keeps the bonus catch to one bay at a time, moving it on each time", () => {
    const h = harness();
    startCrossing(h);
    h.api.setFishCadence(true);
    const seen: number[] = [];
    for (let tick = 0; tick < 120 * 60; tick += 1) {
      h.advance(1);
      const bay = h.api.snapshot().fishBay;
      if (bay !== null && seen[seen.length - 1] !== bay) seen.push(bay);
    }
    expect(seen.length).toBeGreaterThan(2);
    for (let i = 1; i < seen.length; i += 1)
      expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it("lingers five seconds and returns eight seconds later", () => {
    const h = harness();
    startCrossing(h);
    h.api.setFishCadence(true);
    let appeared = -1;
    let left = -1;
    let again = -1;
    for (let tick = 0; tick < 120 * 40; tick += 1) {
      const before = h.api.snapshot().fishBay;
      h.advance(1);
      const after = h.api.snapshot().fishBay;
      const now = h.api.snapshot().simTime;
      if (before === null && after !== null) {
        if (appeared < 0) appeared = now;
        else if (again < 0) again = now;
      }
      if (before !== null && after === null && left < 0) left = now;
    }
    expect(left - appeared).toBeCloseTo(5, 1);
    expect(again - left).toBeCloseTo(8, 1);
  });
});

describe("the run", () => {
  it("holds the death pause, keeps the critter out of play, and respawns", () => {
    const h = harness();
    startCrossing(h);
    h.api.setBay(0, true);
    h.api.setBay(3, true);
    h.api.setCritterTile(20, 6);
    h.advance(1);
    expect(h.api.snapshot().phase).toBe("dying");
    h.seconds(DEATH_PAUSE - 0.05);
    expect(h.api.snapshot().critter.present).toBe(false);
    h.seconds(0.1);
    const shot = h.api.snapshot();
    expect(shot.phase).toBe("crossing");
    expect(shot.critter.present).toBe(true);
    expect(shot.critter.row).toBe(ROW_NEAR);
    expect(shot.critter.col).toBe(START_COL);
    expect(shot.critter.bestRow).toBe(ROW_NEAR);
    expect(shot.bays).toEqual([true, false, false, true, false]);
  });

  it("keeps the strait running through the death pause", () => {
    const h = harness();
    startCrossing(h);
    h.api.addVehicle(14, "car", 0);
    h.api.setLaneSpeed(14, 2);
    h.api.setLaneDirection(14, 1);
    h.api.setCritterTile(20, 6);
    h.advance(1);
    const before = h.api.snapshot().vehicles[0].x;
    h.seconds(0.5);
    expect(h.api.snapshot().vehicles[0].x).toBeGreaterThan(before);
  });

  it("costs a life when the timer runs down, on the tick it reaches zero", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimerRunning(true);
    h.api.setTimer(0.5);
    h.seconds(0.6);
    const shot = h.api.snapshot();
    expect(shot.timer).toBe(0);
    expect(shot.phase).toBe("dying");
    expect(shot.lives).toBe(START_LIVES - 1);
  });

  it("gives each level the timer the closed form gives it", () => {
    const h = harness();
    startCrossing(h);
    for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
      h.api.setLevel(level);
      expect(h.api.snapshot().timerMax).toBe(
        Math.max(15, 30 - (level - 1) * 2),
      );
    }
    h.api.setLevel(8);
    expect(h.api.snapshot().timerMax).toBe(16);
  });

  it("ends the run on the death that empties the lives, not on the count", () => {
    const h = harness();
    startCrossing(h);
    h.api.setLives(0);
    h.seconds(5);
    expect(h.api.snapshot().screen).toBe("playing");

    h.api.setLives(1);
    h.api.setCritterTile(20, 6);
    h.advance(1);
    h.seconds(DEATH_PAUSE + 0.05);
    expect(h.api.snapshot().screen).toBe("gameover");
    expect(h.bus.cues).toContain(CUES.gameOver);
  });

  it("wins the run on the hop that clears level eight", () => {
    const h = harness();
    startCrossing(h, TOTAL_LEVELS);
    h.api.clearVehicles();
    h.api.clearFloes();
    for (const bay of [0, 1, 2, 3]) h.api.setBay(bay, true);
    h.api.setCritterTile(BAYS[4][1], 2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().screen).toBe("victory");
    expect(h.bus.cues).toContain(CUES.victory);
  });

  it("awards a life for every ten-thousand boundary a real award crosses", () => {
    const h = harness();
    startCrossing(h);
    h.api.setScore(BONUS_LIFE_EVERY - 5);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
    h.api.setCritterTile(20, 12);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES + 1);
    expect(h.bus.cues).toContain(CUES.bonusLife);
  });
});

describe("scoring", () => {
  it("pays ten a newly reached row and nothing for a retread", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, 14);
    h.api.setBestRow(14);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().score).toBe(SCORE_ROW);
    h.hold("down");
    h.api.setHopCooldown(0);
    h.advance(1);
    h.hold("up");
    h.api.setHopCooldown(0);
    h.advance(1);
    expect(h.api.snapshot().score).toBe(SCORE_ROW);
  });

  it("pays the row, the bay and the time bonus on a completing hop", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(12);
    h.api.setCritterTile(BAYS[0][0], 2);
    h.api.setBestRow(2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().score).toBe(
      SCORE_ROW + SCORE_BAY + SCORE_TIME_BONUS * 12,
    );
  });

  it("pays the bonus catch only in the bay holding it", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(0);
    h.api.setFishBay(0);
    h.api.setCritterTile(BAYS[3][0], 2);
    h.api.setBestRow(2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().score).toBe(SCORE_ROW + SCORE_BAY);

    startCrossing(h);
    h.api.setTimer(0);
    h.api.setFishBay(0);
    h.api.setCritterTile(BAYS[0][0], 2);
    h.api.setBestRow(2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().score).toBe(
      SCORE_ROW + SCORE_BAY + SCORE_BONUS_CATCH,
    );
    expect(h.api.snapshot().fishBay).toBeNull();
  });

  it("pays a hundred a level on a clear and two-fifty a life on a win", () => {
    const h = harness();
    startCrossing(h, 3);
    h.api.clearVehicles();
    h.api.clearFloes();
    h.api.setTimer(0);
    for (const bay of [0, 1, 2, 3]) h.api.setBay(bay, true);
    h.api.setCritterTile(BAYS[4][0], 2);
    h.api.setBestRow(2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().score).toBe(
      SCORE_ROW + SCORE_BAY + SCORE_LEVEL * 3,
    );

    startCrossing(h, TOTAL_LEVELS);
    h.api.clearVehicles();
    h.api.clearFloes();
    h.api.setTimer(0);
    h.api.setLives(3);
    for (const bay of [0, 1, 2, 3]) h.api.setBay(bay, true);
    h.api.setCritterTile(BAYS[4][0], 2);
    h.api.setBestRow(2);
    h.hold("up");
    h.advance(1);
    expect(h.api.snapshot().score).toBe(
      SCORE_ROW +
        SCORE_BAY +
        SCORE_LEVEL * TOTAL_LEVELS +
        SCORE_VICTORY_LIFE * 3,
    );
  });
});

describe("the screens", () => {
  it("opens on the title screen and crosses from its first item", () => {
    const h = harness();
    expect(h.api.snapshot().screen).toBe("title");
    expect(h.api.snapshot().menuIndex).toBe(0);
    h.press("confirm");
    h.advance(1);
    const shot = h.api.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.level).toBe(1);
    expect(shot.lives).toBe(START_LIVES);
    expect(shot.timer).toBe(crossingTimer(1));
    expect(shot.bays).toEqual([false, false, false, false, false]);
    expect(shot.critter.row).toBe(ROW_NEAR);
  });

  it("moves a menu one item a press, wrapping, and plays its cue", () => {
    const h = harness();
    h.press("down");
    h.advance(1);
    expect(h.api.snapshot().menuIndex).toBe(1);
    expect(h.bus.cues.filter((cue) => cue === CUES.menu)).toHaveLength(1);
    h.press("down");
    h.advance(1);
    expect(h.api.snapshot().menuIndex).toBe(0);
    h.press("up");
    h.advance(1);
    expect(h.api.snapshot().menuIndex).toBe(1);
  });

  it("moves only, on a tick carrying both a move and a confirm", () => {
    const h = harness();
    h.press("down");
    h.press("confirm");
    h.advance(1);
    expect(h.api.snapshot().screen).toBe("title");
    expect(h.api.snapshot().menuIndex).toBe(1);
  });

  it("opens the how-to screen and returns from it", () => {
    const h = harness();
    h.press("down");
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    expect(h.api.snapshot().screen).toBe("howto");
    h.press("back");
    h.advance(1);
    expect(h.api.snapshot().screen).toBe("title");
    expect(h.api.snapshot().menuIndex).toBe(0);
  });

  it("pauses, freezes the strait, and resumes it exactly as it stood", () => {
    const h = harness();
    startCrossing(h);
    h.api.addVehicle(14, "car", 100);
    h.api.setLaneSpeed(14, 2);
    h.api.addBear(20, 16);
    h.press("pause");
    h.advance(1);
    expect(h.api.snapshot().screen).toBe("paused");
    const frozen = h.api.snapshot();
    h.seconds(3);
    const later = h.api.snapshot();
    expect(later.vehicles[0].x).toBe(frozen.vehicles[0].x);
    expect(later.bears[0].x).toBe(frozen.bears[0].x);
    expect(later.critter.x).toBe(frozen.critter.x);
    expect(later.simTime).toBeGreaterThan(frozen.simTime);
    h.press("back");
    h.advance(1);
    const resumed = h.api.snapshot();
    expect(resumed.screen).toBe("playing");
    expect(resumed.score).toBe(frozen.score);
    expect(resumed.bears).toHaveLength(1);
  });

  it("restarts and quits from the pause menu", () => {
    const h = harness();
    startCrossing(h);
    h.api.setScore(500);
    h.press("pause");
    h.advance(1);
    h.press("down");
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    let shot = h.api.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.score).toBe(0);
    expect(shot.lives).toBe(START_LIVES);

    h.press("pause");
    h.advance(1);
    h.press("down");
    h.advance(1);
    h.press("down");
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    shot = h.api.snapshot();
    expect(shot.screen).toBe("title");
  });

  it("plays again and returns to the menu from both end screens", () => {
    for (const screen of ["victory", "gameover"] as const) {
      const h = harness();
      startCrossing(h);
      h.api.setScreen(screen);
      h.api.setMenuIndex(0);
      h.press("confirm");
      h.advance(1);
      expect(h.api.snapshot().screen).toBe("playing");
      expect(h.api.snapshot().score).toBe(0);

      h.api.setScreen(screen);
      h.api.setMenuIndex(1);
      h.press("confirm");
      h.advance(1);
      expect(h.api.snapshot().screen).toBe("title");
    }
  });

  it("toggles mute from a live crossing, both ways", () => {
    const h = harness();
    startCrossing(h);
    h.press("mute");
    h.advance(1);
    expect(h.api.snapshot().muted).toBe(true);
    h.press("mute");
    h.advance(1);
    expect(h.api.snapshot().muted).toBe(false);
  });
});

describe("the world gates", () => {
  it("holds the crossing clock while the timer gate is off", () => {
    const h = harness();
    startCrossing(h);
    h.api.setTimer(20);
    h.seconds(10);
    expect(h.api.snapshot().timer).toBe(20);
    h.api.setTimerRunning(true);
    h.seconds(10);
    expect(h.api.snapshot().timer).toBeCloseTo(10, 1);
  });

  it("keeps the bonus catch away while its cadence is off", () => {
    const h = harness();
    startCrossing(h);
    h.seconds(60);
    expect(h.api.snapshot().fishBay).toBeNull();
  });

  it("costs no life while the catch test is off, and one with it on", () => {
    const h = harness();
    startCrossing(h);
    h.api.setCritterTile(20, ROW_MEDIAN);
    h.api.addBear(20, ROW_MEDIAN);
    const bear = lastId(h.api.snapshot().bears);
    h.api.setBearTravel(bear, false);
    h.seconds(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES);
    h.api.setCatchTest(true);
    h.advance(1);
    expect(h.api.snapshot().lives).toBe(START_LIVES - 1);
  });
});

describe("a tick that is asked for nothing", () => {
  it("changes nothing but the clock", () => {
    const h = harness();
    startCrossing(h);
    const before = h.api.snapshot();
    h.advance(1);
    const after = h.api.snapshot();
    expect({ ...after, simTime: before.simTime }).toEqual(before);
  });
});

describe("the keyboard the runtime hands the game", () => {
  /**
   * The game over a keyboard the test drives, with no canvas and no art: what is
   * checked is how a tick reads the keys, which is `readIntents` inside
   * `createFloe`'s `update`.
   */
  function keyed(): {
    keyboard: Keyboard;
    target: EventTarget;
    api: FloeDebugApi;
    tick(): void;
  } {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    // A mute bit of the test's own, standing in for the runtime's audio bus.
    let muted = false;
    const floe = createFloe({} as never);
    const state = floe.initialize({
      input: { register: (name, keys) => keyboard.register(name, keys) },
      audio: { define: () => undefined },
      diagnostics: { register: () => undefined },
    });
    const api = createDebugApi(state, {
      setAutoStep: () => undefined,
      advance: () => undefined,
    });
    return {
      keyboard,
      target,
      api,
      tick: () => {
        floe.update(
          state,
          {
            input: {
              value: (name) => keyboard.value(name),
              pressed: (name) => keyboard.pressed(name),
            },
            audio: {
              play: () => undefined,
              setMuted: (value) => {
                muted = value;
              },
              muted: () => muted,
            },
          },
          TICK_DT,
        );
        keyboard.endTick();
      },
    };
  }

  /** A `KeyboardEvent`-shaped event, as a browser and a driver both dispatch. */
  class KeyEvent extends Event {
    readonly code: string;
    readonly repeat = false;

    constructor(type: "keydown" | "keyup", code: string) {
      super(type);
      this.code = code;
    }
  }

  function playing(k: ReturnType<typeof keyed>): void {
    k.api.reset();
    k.api.setScreen("playing");
    k.api.clearVehicles();
    k.api.clearFloes();
    k.api.setTimerRunning(false);
    k.api.setBearEmergence(false);
    k.api.addCritter(START_COL, ROW_NEAR);
  }

  it("hops on a press and release that both land between two ticks", () => {
    const k = keyed();
    playing(k);
    k.target.dispatchEvent(new KeyEvent("keydown", "ArrowLeft"));
    k.target.dispatchEvent(new KeyEvent("keyup", "ArrowLeft"));
    k.tick();
    expect(k.api.snapshot().critter.col).toBe(START_COL - 1);
    expect(k.api.snapshot().critter.facing).toBe("left");
  });

  it("hops exactly once for that press, however long the tick runs after it", () => {
    const k = keyed();
    playing(k);
    k.target.dispatchEvent(new KeyEvent("keydown", "ArrowLeft"));
    k.target.dispatchEvent(new KeyEvent("keyup", "ArrowLeft"));
    for (let i = 0; i < 120; i += 1) k.tick();
    expect(k.api.snapshot().critter.col).toBe(START_COL - 1);
  });

  it("repeats a held direction at the cooldown", () => {
    const k = keyed();
    playing(k);
    k.target.dispatchEvent(new KeyEvent("keydown", "ArrowRight"));
    for (let i = 0; i < 120; i += 1) k.tick();
    k.target.dispatchEvent(new KeyEvent("keyup", "ArrowRight"));
    const moved = k.api.snapshot().critter.col - START_COL;
    expect(moved).toBeGreaterThanOrEqual(Math.floor(1 / HOP_COOLDOWN));
    expect(moved).toBeLessThanOrEqual(Math.floor(1 / HOP_COOLDOWN) + 2);
  });

  it("answers to every key the specification binds, and to no other", () => {
    for (const [code, facing] of [
      ["ArrowUp", "up"],
      ["KeyW", "up"],
      ["ArrowDown", "down"],
      ["KeyS", "down"],
      ["ArrowLeft", "left"],
      ["KeyA", "left"],
      ["ArrowRight", "right"],
      ["KeyD", "right"],
    ] as const) {
      const k = keyed();
      playing(k);
      k.api.setCritterTile(START_COL, ROW_NEAR - 4);
      k.target.dispatchEvent(new KeyEvent("keydown", code));
      k.tick();
      expect(k.api.snapshot().critter.facing, code).toBe(facing);
    }

    const quiet = keyed();
    playing(quiet);
    const before = quiet.api.snapshot();
    quiet.target.dispatchEvent(new KeyEvent("keydown", "KeyZ"));
    quiet.tick();
    const after = quiet.api.snapshot();
    expect({ ...after, simTime: 0 }).toEqual({ ...before, simTime: 0 });
  });

  it("pauses on either of its keys and goes back on Escape", () => {
    for (const code of ["KeyP", "Escape"] as const) {
      const k = keyed();
      playing(k);
      k.target.dispatchEvent(new KeyEvent("keydown", code));
      k.tick();
      expect(k.api.snapshot().screen, code).toBe("paused");
      k.target.dispatchEvent(new KeyEvent("keyup", code));
      k.target.dispatchEvent(new KeyEvent("keydown", "Escape"));
      k.tick();
      expect(k.api.snapshot().screen).toBe("playing");
    }
  });

  it("confirms on either of its keys, and mutes on M", () => {
    for (const code of ["Enter", "Space"] as const) {
      const k = keyed();
      k.api.reset();
      k.target.dispatchEvent(new KeyEvent("keydown", code));
      k.tick();
      expect(k.api.snapshot().screen, code).toBe("playing");
    }
    const k = keyed();
    k.api.reset();
    k.target.dispatchEvent(new KeyEvent("keydown", "KeyM"));
    k.tick();
    expect(k.api.snapshot().muted).toBe(true);
    k.target.dispatchEvent(new KeyEvent("keyup", "KeyM"));
    k.target.dispatchEvent(new KeyEvent("keydown", "KeyM"));
    k.tick();
    expect(k.api.snapshot().muted).toBe(false);
  });
});
