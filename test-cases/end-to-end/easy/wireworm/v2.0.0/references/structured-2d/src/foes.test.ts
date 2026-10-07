import { describe, expect, it } from "vitest";
import { noCues } from "./audio";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
  CORRUPTOR_SPEED,
  DROPPER_CHECK_INTERVAL,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
  DROPPER_SPEED,
  GLITCH_DART_INTERVAL,
  GLITCH_FROM_LEVEL,
  GLITCH_H_SPEED,
  GLITCH_MAX_INTERVAL,
  GLITCH_MAX_ON_BOARD,
  GLITCH_MIN_INTERVAL,
  GLITCH_V_SPEED,
  STAGE_H,
  STAGE_W,
  tileCX,
  tileCY,
} from "./constants";
import { playingState, poseFoe } from "./fixtures";
import { advanceFoes, lowerFieldCount, runSpawners } from "./foes";
import { nodeAt, putNode } from "./grid";

const FRAME = 1 / 60;

/** Every arrival the level's own spawners made over `seconds`, a frame at a time. */
function spawnFor(
  state: ReturnType<typeof playingState>,
  seconds: number,
): { at: number; kind: string }[] {
  const arrivals: { at: number; kind: string }[] = [];
  const frames = Math.round(seconds / FRAME);
  for (let frame = 0; frame < frames; frame += 1) {
    const before = state.foes.length;
    runSpawners(state, FRAME);
    if (state.foes.length > before) {
      arrivals.push({
        at: (frame + 1) * FRAME,
        kind: state.foes[state.foes.length - 1].kind,
      });
    }
  }
  return arrivals;
}

describe("the glitch", () => {
  it("travels horizontally and downward at once", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 10, 8);
    glitch.mind = false;
    const x = glitch.x;
    const y = glitch.y;
    advanceFoes(state, 0.5, noCues());
    expect(glitch.x).toBeCloseTo(x + GLITCH_H_SPEED * 0.5, 6);
    expect(glitch.y).toBeCloseTo(y + GLITCH_V_SPEED * 0.5, 6);
  });

  it("reverses its horizontal direction at each dart interval", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 10, 8);
    glitch.travel = false;
    advanceFoes(state, GLITCH_DART_INTERVAL, noCues());
    expect(glitch.vx).toBeCloseTo(-GLITCH_H_SPEED, 6);
    advanceFoes(state, GLITCH_DART_INTERVAL, noCues());
    expect(glitch.vx).toBeCloseTo(GLITCH_H_SPEED, 6);
  });

  it("makes every reversal a long frame covered", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 10, 8);
    glitch.travel = false;
    advanceFoes(state, GLITCH_DART_INTERVAL * 3.5, noCues());
    expect(glitch.vx).toBeCloseTo(-GLITCH_H_SPEED, 6);
  });

  it("reverses at a side edge rather than leaving through one", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 0, 8, -1);
    glitch.mind = false;
    advanceFoes(state, 0.5, noCues());
    expect(glitch.x).toBe(0);
    expect(glitch.vx).toBeGreaterThan(0);
    expect(state.foes).toHaveLength(1);
  });

  it("eats the node on the tile it stands on, whatever its charge", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 10, 8);
    glitch.travel = false;
    putNode(state, 10, 8, 2);
    advanceFoes(state, FRAME, noCues());
    expect(nodeAt(state.nodes, 10, 8)).toBeNull();
  });

  it("eats a critical node without detonating it", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 10, 8);
    glitch.travel = false;
    putNode(state, 10, 8, 3);
    putNode(state, 11, 8, 2);
    const cues = noCues();
    advanceFoes(state, FRAME, cues);
    expect(nodeAt(state.nodes, 10, 8)).toBeNull();
    expect(nodeAt(state.nodes, 11, 8)?.charge).toBe(2);
    expect(state.arcs).toHaveLength(0);
    expect(cues.discharge).toBe(false);
    expect(state.score).toBe(0);
  });

  it("is gone once its center passes below the board", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 10, 19);
    glitch.mind = false;
    glitch.y = STAGE_H - 1;
    advanceFoes(state, 0.5, noCues());
    expect(state.foes).toHaveLength(0);
  });
});

describe("the dropper", () => {
  it("falls straight down, laying a fresh inert node on each empty tile it stands on", () => {
    const state = playingState();
    const dropper = poseFoe(state, "dropper", 10, 4);
    expect(dropper.vx).toBe(0);
    expect(dropper.vy).toBe(DROPPER_SPEED);
    advanceFoes(state, FRAME, noCues());
    expect(nodeAt(state.nodes, 10, 4)?.charge).toBe(0);
    expect(dropper.x).toBe(tileCX(10));
  });

  it("leaves a tile that already holds a node exactly as it is", () => {
    const state = playingState();
    const dropper = poseFoe(state, "dropper", 10, 4);
    dropper.travel = false;
    putNode(state, 10, 4, 2);
    advanceFoes(state, FRAME, noCues());
    expect(nodeAt(state.nodes, 10, 4)?.charge).toBe(2);
    expect(state.nodes).toHaveLength(1);
  });

  it("lays nothing in the entry row or in the player band", () => {
    const entry = playingState();
    const top = poseFoe(entry, "dropper", 10, 0);
    top.travel = false;
    advanceFoes(entry, FRAME, noCues());
    expect(entry.nodes).toHaveLength(0);

    const band = playingState();
    const low = poseFoe(band, "dropper", 10, 18);
    low.travel = false;
    advanceFoes(band, FRAME, noCues());
    expect(band.nodes).toHaveLength(0);
  });
});

describe("the corruptor", () => {
  it("crawls across its row and never leaves it", () => {
    const state = playingState();
    const corruptor = poseFoe(state, "corruptor", 4, 3);
    corruptor.mind = false;
    const y = corruptor.y;
    advanceFoes(state, 0.5, noCues());
    expect(corruptor.x).toBeCloseTo(tileCX(4) + CORRUPTOR_SPEED * 0.5, 6);
    expect(corruptor.y).toBe(y);
  });

  it("slams the node it crosses straight to critical, and lays none", () => {
    const state = playingState();
    const corruptor = poseFoe(state, "corruptor", 4, 3);
    corruptor.travel = false;
    putNode(state, 4, 3, 1);
    const cues = noCues();
    advanceFoes(state, FRAME, cues);
    expect(nodeAt(state.nodes, 4, 3)?.charge).toBe(3);
    expect(cues.critical).toBe(true);

    const empty = playingState();
    const alone = poseFoe(empty, "corruptor", 6, 3);
    alone.travel = false;
    advanceFoes(empty, FRAME, noCues());
    expect(empty.nodes).toHaveLength(0);
  });

  it("is gone once its center passes a side edge", () => {
    const state = playingState();
    const corruptor = poseFoe(state, "corruptor", 39, 3);
    corruptor.mind = false;
    corruptor.x = STAGE_W - 1;
    advanceFoes(state, 0.5, noCues());
    expect(state.foes).toHaveLength(0);
  });
});

describe("the level's own spawning", () => {
  it("brings in no glitch below the level it starts at", () => {
    const state = playingState();
    state.level = GLITCH_FROM_LEVEL - 1;
    expect(spawnFor(state, 30)).toHaveLength(0);
  });

  it("brings a glitch in after an interval inside its own window", () => {
    const state = playingState();
    state.level = GLITCH_FROM_LEVEL;
    const arrivals = spawnFor(state, GLITCH_MAX_INTERVAL + 1);
    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals[0].at).toBeGreaterThanOrEqual(GLITCH_MIN_INTERVAL - FRAME);
    expect(arrivals[0].at).toBeLessThanOrEqual(GLITCH_MAX_INTERVAL + FRAME);
    const glitch = state.foes[0];
    expect(glitch.kind).toBe("glitch");
    // At a side edge, on a row from 8 to 15, heading inward.
    expect(glitch.y).toBeGreaterThanOrEqual(tileCY(8));
    expect(glitch.y).toBeLessThanOrEqual(tileCY(15));
    expect(glitch.x < STAGE_W / 2 ? glitch.vx : -glitch.vx).toBeGreaterThan(0);
  });

  it("holds at its cap of glitches on the board", () => {
    const state = playingState();
    state.level = GLITCH_FROM_LEVEL;
    spawnFor(state, GLITCH_MAX_INTERVAL * 6);
    expect(state.foes).toHaveLength(GLITCH_MAX_ON_BOARD);
  });

  it("draws a dropper in on a sparse lower field and not on a dense one", () => {
    const sparse = playingState();
    sparse.level = DROPPER_FROM_LEVEL;
    const arrivals = spawnFor(sparse, DROPPER_CHECK_INTERVAL + 2 * FRAME);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].at).toBeGreaterThanOrEqual(
      DROPPER_CHECK_INTERVAL - FRAME,
    );
    expect(arrivals[0].at).toBeLessThanOrEqual(
      DROPPER_CHECK_INTERVAL + 2 * FRAME,
    );
    expect(sparse.foes[0].kind).toBe("dropper");

    const dense = playingState();
    dense.level = DROPPER_FROM_LEVEL;
    for (let c = 0; c < DROPPER_SPARSE_THRESHOLD; c += 1) {
      putNode(dense, c, 12, 0);
    }
    expect(lowerFieldCount(dense)).toBe(DROPPER_SPARSE_THRESHOLD);
    expect(spawnFor(dense, DROPPER_CHECK_INTERVAL * 2)).toHaveLength(0);
  });

  it("brings a corruptor in only from the level it starts at", () => {
    // A level below the corruptor's own gate still brings glitches in, so the
    // reading is the corruptors among the arrivals rather than their number.
    const early = playingState();
    early.level = CORRUPTOR_FROM_LEVEL - 1;
    const before = spawnFor(early, CORRUPTOR_MAX_INTERVAL + 1);
    expect(before.filter((arrival) => arrival.kind === "corruptor")).toEqual(
      [],
    );

    const state = playingState();
    state.level = CORRUPTOR_FROM_LEVEL;
    const arrivals = spawnFor(state, CORRUPTOR_MAX_INTERVAL + 1).filter(
      (arrival) => arrival.kind === "corruptor",
    );
    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals[0].at).toBeGreaterThanOrEqual(
      CORRUPTOR_MIN_INTERVAL - FRAME,
    );
    expect(arrivals[0].at).toBeLessThanOrEqual(CORRUPTOR_MAX_INTERVAL + FRAME);
    const corruptor = state.foes.find((foe) => foe.kind === "corruptor");
    expect(corruptor?.y).toBeGreaterThanOrEqual(tileCY(1));
    expect(corruptor?.y).toBeLessThanOrEqual(tileCY(6));
    expect(Math.abs(corruptor?.vx ?? 0)).toBe(CORRUPTOR_SPEED);
  });
});
