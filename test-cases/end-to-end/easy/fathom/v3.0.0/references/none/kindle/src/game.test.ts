import { beforeEach, describe, expect, it } from "vitest";

import {
  BRIGHT_HALFLIFE,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  DEN_RELEASE_GAP,
  DRIFTER_INTERVAL,
  DRIFTER_MAX,
  FORAGER_SPEED,
  INK_COOLDOWN,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  START_LIVES,
  TICK_HZ,
} from "./constants";
import {
  beginDive,
  COUNTDOWN_TIME,
  fillPlankton,
  layoutMaze,
  toTitle,
  type FathomState,
} from "./game";
import {
  harness,
  poseBoard,
  stillCreatures,
  type Harness,
} from "./harness.test-support";
import { Maze } from "./maze";
import { tileKey } from "./sensing";
import { board, SEALED_DEN, stamp } from "./board.test-support";

/** Seconds, as whole ticks. */
function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/**
 * A straight corridor with a sealed den above it and a sealed three-tile
 * larder below, so `planktonRemaining` never reaches zero while a scenario
 * grazes and no hunter reaches the corridor unless it is posed there.
 */
function corridorBoard(): string[] {
  const rows = board([".".repeat(30)], 8, 3);
  return stamp(stamp(rows, SEALED_DEN, 1, 16), ["..."], 15, 2);
}

/** Take the game to live play on the shipped maze. */
function toPlay(h: Harness): void {
  h.press("confirm");
  h.advance(1);
  h.advance(ticks(COUNTDOWN_TIME) + 1);
}

describe("the opening state", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("opens on the title screen with the first menu item highlighted", () => {
    expect(h.state.screen).toBe("title");
    expect(h.state.menu).toBe(0);
  });

  it("opens with a dive's score, lives and depth", () => {
    expect(h.state.score).toBe(0);
    expect(h.state.lives).toBe(START_LIVES);
    expect(h.state.depth).toBe(1);
  });

  it("lays the maze out with a plankton on every corridor tile", () => {
    expect(h.state.planktonRemaining).toBe(h.state.maze.corridorTiles().length);
  });

  it("opens with the fog fully unrevealed", () => {
    expect(h.state.fog.rows().join("")).toMatch(/^u+$/);
  });

  it("opens with every predator in the den and unreleased", () => {
    expect(h.state.predators).toHaveLength(3);
    for (const p of h.state.predators) {
      expect(p.state).toBe("den");
      expect(p.released).toBe(false);
      expect(h.state.maze.isDen(p.col, p.row)).toBe(true);
    }
  });

  it("rests the forager on the maze's start tile", () => {
    expect(h.state.forager.tile).toEqual(h.state.maze.start);
    expect(h.state.forager.dir).toBeNull();
  });
});

describe("the screens", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("accumulates simulation time on every screen", () => {
    h.advance(120);
    expect(h.state.simTime).toBeCloseTo(1, 6);
    expect(h.state.screen).toBe("title");
  });

  it("moves the title selection by one and wraps at both ends", () => {
    h.press("up");
    h.advance(1);
    expect(h.state.menu).toBe(1);
    h.press("down");
    h.advance(1);
    expect(h.state.menu).toBe(0);
  });

  it("takes DIVE to the countdown and the countdown to live play", () => {
    h.press("confirm");
    h.advance(1);
    expect(h.state.screen).toBe("countdown");
    expect(h.state.countdown).toBeGreaterThanOrEqual(1);
    expect(h.state.countdown).toBeLessThanOrEqual(3);
    h.advance(ticks(COUNTDOWN_TIME) + 1);
    expect(h.state.screen).toBe("playing");
  });

  it("takes HOW TO PLAY to the how-to screen and back again", () => {
    h.press("down");
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    expect(h.state.screen).toBe("howto");
    h.press("back");
    h.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menu).toBe(0);
  });

  it("holds everything still while the countdown runs, but for the light", () => {
    h.press("confirm");
    h.advance(1);
    const before = h.state.forager.x;
    h.hold("right");
    h.advance(60);
    expect(h.state.forager.x).toBe(before);
    expect(h.state.fog.rows().join("")).not.toMatch(/^u+$/);
    expect(h.state.predators.every((p) => !p.released)).toBe(true);
  });

  it("pauses live play and resumes it, freezing the maze between", () => {
    toPlay(h);
    h.hold("left");
    h.advance(30);
    h.press("pause");
    h.advance(1);
    expect(h.state.screen).toBe("paused");
    const frozen = h.state.forager.x;
    h.advance(120);
    expect(h.state.forager.x).toBe(frozen);
    h.press("back");
    h.advance(1);
    expect(h.state.screen).toBe("playing");
  });

  it("restarts a whole dive from the pause menu", () => {
    toPlay(h);
    h.state.score = 400;
    h.press("pause");
    h.advance(1);
    h.press("down");
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    expect(h.state.screen).toBe("countdown");
    expect(h.state.score).toBe(0);
    expect(h.state.depth).toBe(1);
  });

  it("quits to the title, restoring what a dive begins from", () => {
    toPlay(h);
    h.state.score = 400;
    h.state.depth = 3;
    h.press("pause");
    h.advance(1);
    h.press("up");
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.score).toBe(0);
    expect(h.state.depth).toBe(1);
    expect(h.state.lives).toBe(START_LIVES);
  });

  it("reads the mute control on every screen", () => {
    h.press("mute");
    h.advance(1);
    expect(h.state.muted).toBe(true);
    toPlay(h);
    h.press("mute");
    h.advance(1);
    expect(h.state.muted).toBe(false);
  });
});

describe("the forager's travel", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
    poseBoard(h.state, corridorBoard());
    h.state.forager.placeOn(10, 8);
  });

  it("travels while a movement action is held", () => {
    h.hold("right");
    h.advance(ticks(1));
    expect(h.state.forager.x).toBeCloseTo(Maze.centerX(10) + FORAGER_SPEED, 3);
    expect(h.state.forager.dir).toBe("right");
  });

  it("comes to rest where it stands when nothing is held", () => {
    h.hold("right");
    h.advance(30);
    h.release("right");
    h.advance(2);
    expect(h.state.forager.dir).toBeNull();
  });

  it("takes the most recently pressed movement key", () => {
    h.hold("right");
    h.advance(10);
    h.hold("left");
    h.advance(10);
    expect(h.state.forager.dir).toBe("left");
  });

  it("stands still against rock, keeping its facing", () => {
    h.state.forager.placeOn(3, 8);
    h.hold("left");
    h.advance(ticks(1));
    expect(h.state.forager.tile).toEqual({ col: 3, row: 8 });
  });
});

describe("grazing", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
    poseBoard(h.state, corridorBoard());
    h.state.forager.placeOn(10, 8);
  });

  it("eats the plankton on the tile the forager's center enters", () => {
    const plankton = h.state.planktonRemaining;
    const score = h.state.score;
    h.hold("right");
    h.advance(ticks(0.25) + 1);
    expect(h.state.planktonRemaining).toBe(plankton - 2);
    expect(h.state.score).toBe(score + SCORE_PLANKTON * 2);
  });

  it("brightens the forager by one mouthful and arms the hold in full", () => {
    h.state.forager.brightness = 0;
    h.state.forager.hold = 0;
    h.advance(1);
    expect(h.state.forager.brightness).toBeCloseTo(BRIGHT_PER_EAT, 6);
    expect(h.state.forager.hold).toBe(BRIGHT_HOLD);
  });

  it("holds the brightness steady for the whole hold", () => {
    h.state.forager.brightness = 0;
    h.advance(1);
    const lit = h.state.forager.brightness;
    h.advance(ticks(BRIGHT_HOLD) - 2);
    expect(h.state.forager.brightness).toBeCloseTo(lit, 6);
  });

  it("halves the brightness every half-life once the hold has run out", () => {
    h.state.plankton[tileKey(10, 8)] = false;
    h.state.forager.brightness = 1;
    h.state.forager.hold = 0;
    h.advance(ticks(BRIGHT_HALFLIFE));
    expect(h.state.forager.brightness).toBeCloseTo(0.5, 2);
  });

  it("scores a bonus drifter the forager's tile carries", () => {
    h.state.drifters = [];
    const before = h.state.score;
    h.state.drifters.push(
      Object.assign(Object.create(Object.getPrototypeOf(h.state.forager)), {
        ...h.state.forager,
      }),
    );
    h.state.drifters[0].x = Maze.centerX(10);
    h.state.drifters[0].y = Maze.centerY(8);
    h.advance(1);
    expect(h.state.drifters).toHaveLength(0);
    expect(h.state.score - before).toBeGreaterThanOrEqual(SCORE_DRIFTER);
  });

  it("clears the maze on the plankton that leaves none behind", () => {
    h.state.plankton.fill(false);
    h.state.planktonRemaining = 1;
    h.state.plankton[tileKey(11, 8)] = true;
    const before = h.state.score;
    h.hold("right");
    h.advance(ticks(0.25) + 1);
    expect(h.state.screen).toBe("cleared");
    expect(h.state.score).toBe(before + SCORE_PLANKTON + SCORE_CLEAR);
  });

  it("descends to the next depth when the interstitial runs out", () => {
    h.state.plankton.fill(false);
    h.state.planktonRemaining = 1;
    h.state.plankton[tileKey(11, 8)] = true;
    h.hold("right");
    h.advance(ticks(0.25) + 1);
    h.release("right");
    h.advance(ticks(3));
    expect(h.state.depth).toBe(2);
    expect(h.state.screen).toBe("countdown");
    expect(h.state.planktonRemaining).toBe(h.state.maze.corridorTiles().length);
  });

  it("leaves an emptied maze in live play when nothing was just eaten", () => {
    h.state.plankton.fill(false);
    h.state.planktonRemaining = 0;
    h.advance(60);
    expect(h.state.screen).toBe("playing");
  });

  it("lays the game's own maze out over a posed fixture on the descent", () => {
    h.state.plankton.fill(false);
    h.state.planktonRemaining = 1;
    h.state.plankton[tileKey(11, 8)] = true;
    h.hold("right");
    h.advance(ticks(0.25) + 1);
    h.release("right");
    h.advance(ticks(3));
    expect(h.state.maze.rows()).not.toEqual(corridorBoard());
    expect(h.state.maze.gate).not.toBeNull();
  });

  it("runs the release schedule again once the descent drops the fixture", () => {
    h.state.plankton.fill(false);
    h.state.planktonRemaining = 1;
    h.state.plankton[tileKey(11, 8)] = true;
    h.hold("right");
    h.advance(ticks(0.25) + 1);
    h.release("right");
    h.advance(ticks(3) + ticks(COUNTDOWN_TIME) + 1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.predators[0].released).toBe(true);
  });
});

describe("the sonar pulse and the ink", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
    poseBoard(h.state, corridorBoard());
    h.state.forager.placeOn(10, 8);
  });

  it("emits a cyan pulse and puts the sonar on its cooldown", () => {
    h.press("a");
    h.advance(1);
    expect(h.state.waves).toHaveLength(1);
    expect(h.state.waves[0].tint).toBe("cyan");
    expect(h.state.sonarCooldown).toBeCloseTo(SONAR_COOLDOWN - 1 / TICK_HZ, 6);
  });

  it("emits nothing while the cooldown is still running", () => {
    h.press("a");
    h.advance(1);
    h.press("a");
    h.advance(1);
    expect(h.state.waves).toHaveLength(1);
  });

  it("reveals the corridor its front has swept over, and no further", () => {
    h.press("a");
    h.advance(ticks(0.2));
    expect(h.state.fog.isRevealed(12, 8)).toBe(true);
    expect(h.state.fog.isRevealed(28, 8)).toBe(false);
  });

  it("releases an ink cloud and puts ink on its cooldown", () => {
    h.press("b");
    h.advance(1);
    expect(h.state.ink.all).toHaveLength(1);
    expect(h.state.ink.all[0].x).toBeCloseTo(Maze.centerX(10), 6);
    expect(h.state.inkCooldown).toBeCloseTo(INK_COOLDOWN - 1 / TICK_HZ, 6);
  });

  it("lets an ink cloud dissipate on its own", () => {
    h.press("b");
    h.advance(ticks(3) + 2);
    expect(h.state.ink.all).toHaveLength(0);
  });
});

describe("the fog of war", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
    poseBoard(h.state, corridorBoard());
    h.state.forager.placeOn(10, 8);
    h.advance(1);
  });

  it("lights the pocket around the forager", () => {
    expect(h.state.fog.visibility(10, 8)).toBe("lit");
    expect(h.state.fog.visibility(12, 8)).toBe("lit");
  });

  it("remembers a tile the light has left", () => {
    h.state.forager.placeOn(20, 8);
    h.advance(1);
    expect(h.state.fog.visibility(10, 8)).toBe("remembered");
  });

  it("leaves a tile no source has touched unrevealed", () => {
    expect(h.state.fog.visibility(29, 8)).toBe("unrevealed");
  });
});

describe("the den and the release schedule", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
  });

  it("releases the roster on the staggered schedule from live play", () => {
    expect(h.state.predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    h.advance(ticks(DEN_RELEASE_GAP));
    expect(h.state.predators[1].released).toBe(true);
    expect(h.state.predators[2].released).toBe(false);
    h.advance(ticks(DEN_RELEASE_GAP));
    expect(h.state.predators[2].released).toBe(true);
  });

  it("runs the schedule over a posed board as it does over its own", () => {
    poseBoard(h.state, corridorBoard());
    h.advance(2);
    expect(h.state.predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    h.advance(ticks(DEN_RELEASE_GAP * 2) + 2);
    expect(h.state.predators.every((p) => p.released)).toBe(true);
    // The chamber's only way out is a gate onto rock, so each stays in the den.
    expect(h.state.predators.every((p) => p.state === "den")).toBe(true);
  });

  it("re-arms the schedule when a life is lost", () => {
    poseBoard(h.state, corridorBoard());
    h.advance(ticks(DEN_RELEASE_GAP * 3));
    layoutMaze(h.state, false);
    expect(h.state.predators.every((p) => !p.released)).toBe(true);
    h.advance(ticks(DEN_RELEASE_GAP) + 2);
    expect(h.state.predators.map((p) => p.released)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("swims a released predator out of the chamber and into the corridors", () => {
    h.advance(ticks(3));
    expect(h.state.predators[0].state).toBe("wander");
    expect(h.state.maze.isCorridor(...corridorOf(h.state, 0))).toBe(true);
  });
});

function corridorOf(state: FathomState, index: number): [number, number] {
  return [state.predators[index].col, state.predators[index].row];
}

describe("getting caught", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
    poseBoard(h.state, corridorBoard());
    stillCreatures(h.state);
    h.state.forager.placeOn(10, 8);
  });

  it("costs a life and starts another attempt at the same maze", () => {
    h.advance(1);
    const eaten = h.state.planktonRemaining;
    h.state.predators[0].state = "wander";
    h.state.predators[0].placeOn(10, 8);
    h.advance(1);
    expect(h.state.lives).toBe(START_LIVES - 1);
    expect(h.state.screen).toBe("countdown");
    expect(h.state.planktonRemaining).toBe(eaten);
    expect(h.state.predators.every((p) => p.state === "den")).toBe(true);
  });

  it("ends the dive when there is no life left in reserve", () => {
    h.state.lives = 0;
    h.state.predators[0].state = "wander";
    h.state.predators[0].placeOn(10, 8);
    h.advance(1);
    expect(h.state.screen).toBe("gameover");
    expect(h.state.lives).toBe(0);
  });

  it("leaves a predator in the den unable to make contact", () => {
    h.state.predators[0].placeOn(10, 8);
    h.advance(60);
    expect(h.state.lives).toBe(START_LIVES);
  });

  it("plays again from the game-over menu", () => {
    h.state.lives = 0;
    h.state.predators[0].state = "wander";
    h.state.predators[0].placeOn(10, 8);
    h.advance(1);
    h.press("confirm");
    h.advance(1);
    expect(h.state.screen).toBe("countdown");
    expect(h.state.lives).toBe(START_LIVES);
  });
});

describe("the bonus drifters", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
  });

  it("admits one at the gate on its cadence, up to the ceiling", () => {
    stillCreatures(h.state);
    h.advance(ticks(DRIFTER_INTERVAL) + 1);
    expect(h.state.drifters).toHaveLength(1);
    stillCreatures(h.state);
    h.advance(ticks(DRIFTER_INTERVAL) + 1);
    expect(h.state.drifters).toHaveLength(DRIFTER_MAX);
    stillCreatures(h.state);
    h.advance(ticks(DRIFTER_INTERVAL) + 1);
    expect(h.state.drifters).toHaveLength(DRIFTER_MAX);
  });

  it("admits none on a board with no den gate", () => {
    poseBoard(h.state, board([".".repeat(30)], 8, 3));
    h.advance(ticks(DRIFTER_INTERVAL * 2));
    expect(h.state.drifters).toHaveLength(0);
  });
});

describe("the creature minds", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    toPlay(h);
    poseBoard(h.state, corridorBoard());
  });

  it("holds every creature exactly where it stands when they are off", () => {
    h.state.predators[0].state = "wander";
    h.state.predators[0].released = true;
    h.state.predators[0].placeOn(20, 8);
    stillCreatures(h.state);
    h.advance(ticks(2));
    expect(h.state.predators[0].tile).toEqual({ col: 20, row: 8 });
    expect(h.state.predators[0].state).toBe("wander");
  });

  it("leaves everything else running while they are off", () => {
    stillCreatures(h.state);
    h.state.forager.placeOn(10, 8);
    h.press("a");
    h.hold("right");
    h.advance(ticks(0.5));
    expect(h.state.forager.tile.col).toBeGreaterThan(10);
    expect(h.state.score).toBeGreaterThan(0);
    expect(h.state.sonarCooldown).toBeLessThan(SONAR_COOLDOWN);
    expect(h.state.waves.length).toBeGreaterThan(0);
  });
});

describe("the cues", () => {
  it("plays each cue a tick raises exactly once", () => {
    const h = harness();
    toPlay(h);
    poseBoard(h.state, corridorBoard());
    h.state.forager.placeOn(10, 8);
    const before = h.cues.length;
    h.press("a");
    h.press("b");
    h.advance(1);
    expect(h.cues.slice(before).sort()).toEqual(["eat", "ink", "sonar"]);
  });
});

describe("laying a maze out", () => {
  it("refills the plankton and clears the fog when it is fresh", () => {
    const h = harness();
    h.state.plankton.fill(false);
    h.state.planktonRemaining = 0;
    h.state.fog.reveal(1, 1);
    layoutMaze(h.state, true);
    expect(h.state.planktonRemaining).toBeGreaterThan(0);
    expect(h.state.fog.isRevealed(1, 1)).toBe(false);
  });

  it("keeps the eaten plankton and the memory when it is not", () => {
    const h = harness();
    h.state.plankton.fill(false);
    h.state.planktonRemaining = 0;
    h.state.fog.reveal(1, 1);
    layoutMaze(h.state, false);
    expect(h.state.planktonRemaining).toBe(0);
    expect(h.state.fog.isRevealed(1, 1)).toBe(true);
  });

  it("puts no plankton in the den chamber or on its gate", () => {
    const h = harness();
    fillPlankton(h.state);
    for (const tile of [...h.state.maze.denTiles, h.state.maze.gate]) {
      if (tile === null) continue;
      expect(h.state.plankton[tileKey(tile.col, tile.row)]).toBe(false);
    }
  });
});

describe("beginning a dive", () => {
  it("opens on the countdown with a dive's own values", () => {
    const h = harness();
    h.state.score = 900;
    h.state.depth = 5;
    h.state.lives = 0;
    beginDive(h.state);
    expect(h.state.screen).toBe("countdown");
    expect(h.state.score).toBe(0);
    expect(h.state.depth).toBe(1);
    expect(h.state.lives).toBe(START_LIVES);
  });

  it("replaces a posed fixture with the game's own maze", () => {
    const h = harness();
    poseBoard(h.state, corridorBoard());
    beginDive(h.state);
    expect(h.state.maze.gate).not.toBeNull();
    expect(h.state.maze.corridorTiles().length).toBeGreaterThan(30);
  });

  it("leaves the simulation's own clock alone", () => {
    const h = harness();
    h.advance(120);
    const before = h.state.simTime;
    beginDive(h.state);
    expect(h.state.simTime).toBe(before);
  });
});

describe("returning to the title", () => {
  it("restores the score, the lives, the depth and the maze", () => {
    const h = harness();
    toPlay(h);
    h.state.score = 700;
    h.state.depth = 4;
    h.state.lives = 1;
    toTitle(h.state);
    expect(h.state.screen).toBe("title");
    expect(h.state.menu).toBe(0);
    expect(h.state.score).toBe(0);
    expect(h.state.depth).toBe(1);
    expect(h.state.lives).toBe(START_LIVES);
    expect(h.state.fog.rows().join("")).toMatch(/^u+$/);
  });
});
