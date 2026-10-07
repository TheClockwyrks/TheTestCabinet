import { describe, expect, it } from "vitest";
import { noCues } from "./audio";
import { addBoltTo, advanceBolts } from "./bolts";
import {
  BOARD_Y,
  BOLT_SPEED,
  DROPPER_SPEED,
  DROPPER_SPEED_HIT,
  SCORE_BODY,
  SCORE_CORRUPTOR,
  SCORE_DROPPER,
  SCORE_GLITCH,
  SCORE_HEAD,
  SCORE_INERT_NODE,
  TILE,
  tileCX,
  tileCY,
} from "./constants";
import { playingState, poseFoe, poseWorm } from "./fixtures";
import { nodeAt, putNode } from "./grid";

const FRAME = 1 / 60;

/** A bolt on the center of tile `(c, r)`, one frame from resolving. */
function boltAt(state: ReturnType<typeof playingState>, c: number, r: number) {
  return addBoltTo(state, tileCX(c), tileCY(r));
}

describe("a bolt into a node", () => {
  it("removes an inert node and pays for it", () => {
    const state = playingState();
    putNode(state, 8, 6, 0);
    boltAt(state, 8, 6);
    advanceBolts(state, FRAME, noCues());
    expect(nodeAt(state.nodes, 8, 6)).toBeNull();
    expect(state.score).toBe(SCORE_INERT_NODE);
    expect(state.bolts).toHaveLength(0);
  });

  it("knocks a charged node down one level and pays nothing", () => {
    const state = playingState();
    putNode(state, 8, 6, 2);
    boltAt(state, 8, 6);
    advanceBolts(state, FRAME, noCues());
    expect(nodeAt(state.nodes, 8, 6)?.charge).toBe(1);
    expect(state.score).toBe(0);
  });

  it("detonates a critical node", () => {
    const state = playingState();
    putNode(state, 8, 6, 3);
    putNode(state, 9, 6, 1);
    boltAt(state, 8, 6);
    const cues = noCues();
    advanceBolts(state, FRAME, cues);
    expect(state.nodes).toHaveLength(0);
    expect(state.arcs).toHaveLength(1);
    expect(cues.discharge).toBe(true);
  });

  it("resolves against the first thing it reached over the frame it swept", () => {
    const state = playingState();
    putNode(state, 8, 6, 0);
    putNode(state, 8, 4, 0);
    // Three tiles below the lower node, and a frame long enough to sweep past
    // both: the lower one is what it reached first.
    addBoltTo(state, tileCX(8), tileCY(6) + 3 * TILE);
    advanceBolts(state, (4 * TILE) / BOLT_SPEED, noCues());
    expect(nodeAt(state.nodes, 8, 6)).toBeNull();
    expect(nodeAt(state.nodes, 8, 4)).not.toBeNull();
  });
});

describe("a bolt into the worm", () => {
  it("destroys the segment, pays the head or the body, and leaves a node", () => {
    const head = playingState();
    poseWorm(head, 8, 6, 3);
    boltAt(head, 8, 6);
    const cues = noCues();
    expect(advanceBolts(head, FRAME, cues)).toBe(1);
    expect(head.score).toBe(SCORE_HEAD);
    expect(cues.cut).toBe(true);
    expect(nodeAt(head.nodes, 8, 6)?.charge).toBe(0);

    const body = playingState();
    poseWorm(body, 8, 6, 3);
    boltAt(body, 7, 6);
    advanceBolts(body, FRAME, noCues());
    expect(body.score).toBe(SCORE_BODY);
  });

  it("strikes the segment rather than the node they share a tile with", () => {
    const state = playingState();
    poseWorm(state, 8, 6, 2);
    putNode(state, 8, 6, 2);
    boltAt(state, 8, 6);
    advanceBolts(state, FRAME, noCues());
    expect(state.worms[0].segments).toHaveLength(1);
    // The standing node keeps the charge it had: no fresh node is laid over it.
    expect(nodeAt(state.nodes, 8, 6)?.charge).toBe(2);
  });
});

describe("a bolt into a foe", () => {
  it("destroys a glitch and pays its bounty", () => {
    const state = playingState();
    const glitch = poseFoe(state, "glitch", 8, 6);
    glitch.mind = false;
    glitch.travel = false;
    boltAt(state, 8, 6);
    const cues = noCues();
    advanceBolts(state, FRAME, cues);
    expect(state.foes).toHaveLength(0);
    expect(state.score).toBe(SCORE_GLITCH);
    expect(cues.foe).toBe(true);
  });

  it("speeds a dropper on its first bolt and destroys it on the second", () => {
    const state = playingState();
    const dropper = poseFoe(state, "dropper", 8, 6);
    dropper.mind = false;
    dropper.travel = false;
    expect(dropper.vy).toBe(DROPPER_SPEED);
    boltAt(state, 8, 6);
    advanceBolts(state, FRAME, noCues());
    expect(state.foes).toHaveLength(1);
    expect(dropper.hit).toBe(true);
    expect(dropper.vy).toBe(DROPPER_SPEED_HIT);
    expect(state.score).toBe(0);

    boltAt(state, 8, 6);
    advanceBolts(state, FRAME, noCues());
    expect(state.foes).toHaveLength(0);
    expect(state.score).toBe(SCORE_DROPPER);
  });

  it("destroys a corruptor and pays its bounty", () => {
    const state = playingState();
    const corruptor = poseFoe(state, "corruptor", 8, 6);
    corruptor.mind = false;
    corruptor.travel = false;
    boltAt(state, 8, 6);
    advanceBolts(state, FRAME, noCues());
    expect(state.foes).toHaveLength(0);
    expect(state.score).toBe(SCORE_CORRUPTOR);
  });
});

describe("a bolt that reaches nothing", () => {
  it("keeps climbing at its own speed", () => {
    const state = playingState();
    const bolt = addBoltTo(state, 500, 600);
    advanceBolts(state, FRAME, noCues());
    expect(state.bolts).toHaveLength(1);
    expect(bolt.y).toBeCloseTo(600 - BOLT_SPEED * FRAME, 6);
    expect(bolt.x).toBe(500);
  });

  it("is gone once its center leaves the top of the board", () => {
    const state = playingState();
    addBoltTo(state, 500, BOARD_Y + 4);
    advanceBolts(state, FRAME, noCues());
    expect(state.bolts).toHaveLength(0);
  });
});
