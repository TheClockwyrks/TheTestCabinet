import { beforeEach, describe, expect, it } from "vitest";

import { board, SEALED_DEN, stamp } from "./board.test-support";
import {
  BRIGHT_HOLD,
  DEN_RELEASE_GAP,
  FATHOM_DEBUG_VERSION,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_LIFE,
  INK_RADIUS,
  KINDLE_VISION_MIN,
  LANTERN_RANGE_BASE,
  LINGER_TIME,
  SCORE_PLANKTON,
  START_LIVES,
  TICK_HZ,
  TILE,
  VISION_MIN,
} from "./constants";
import { createDebugApi, type FathomDebugApi } from "./debug";
import { COUNTDOWN_TIME } from "./game";
import { harness, type Harness } from "./harness.test-support";
import { Maze } from "./maze";
import { tileKey } from "./sensing";
import { CLEARED_HOLD } from "./theme";
import type { Screen } from "./types";

/** Seconds, as whole ticks. */
function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** A fixture: one straight corridor, a sealed den, and a sealed larder. */
function fixture(): string[] {
  return stamp(
    stamp(board([".".repeat(30)], 8, 3), SEALED_DEN, 1, 16),
    ["..."],
    15,
    2,
  );
}

describe("the debug surface", () => {
  let h: Harness;
  let api: FathomDebugApi;

  /**
   * The fixture board, arranged one call at a time.
   *
   * The surface has no operation that arranges a whole board, so this says each
   * thing it wants: the layout, an empty roster, a plankton on every corridor
   * tile of it, the fog back to unrevealed, and the forager somewhere it may
   * stand. Every scenario below that wants a hunter puts one back itself, so
   * nothing hunts a check that is not about hunting.
   */
  function poseFixture(): void {
    api.setMaze(fixture());
    api.clearPredators();
    api.clearDrifters();
    api.clearPlankton();
    for (const tile of h.state.maze.corridorTiles()) {
      api.setPlankton(tile.col, tile.row, true);
    }
    api.clearFog();
    api.setForagerTile(3, 8);
  }

  /** The depth-one roster back on the fixture board, parked in its den. */
  function denRoster(): void {
    api.setDepth(1);
  }

  /** Live play on the fixture board, which most scenarios below open with. */
  function playOnFixture(): void {
    api.reset();
    api.setScreen("playing");
    poseFixture();
  }

  beforeEach(() => {
    h = harness();
    api = createDebugApi(h.state, h.clock);
  });

  it("reports the version the specification fixes", () => {
    expect(api.version).toBe(FATHOM_DEBUG_VERSION);
    expect(api.snapshot().version).toBe(FATHOM_DEBUG_VERSION);
  });

  describe("the clock", () => {
    it("takes the game off real time and gives it back", () => {
      api.setAutoStep(false);
      expect(api.snapshot().autoStep).toBe(false);
      api.setAutoStep(true);
      expect(api.snapshot().autoStep).toBe(true);
    });

    it("runs exactly the ticks it is given, in order", () => {
      api.setAutoStep(false);
      api.advance(TICK_HZ);
      expect(api.snapshot().simTime).toBeCloseTo(1, 6);
    });

    it("runs nothing on advance(0)", () => {
      api.advance(0);
      expect(api.snapshot().simTime).toBe(0);
    });

    it("refuses a tick count that is not a whole, non-negative number", () => {
      expect(() => api.advance(-1)).toThrow(RangeError);
      expect(() => api.advance(0.5)).toThrow(RangeError);
    });
  });

  describe("reset", () => {
    it("restores every field to its title-screen value", () => {
      api.setScreen("playing");
      api.advance(TICK_HZ);
      api.reset();
      const s = api.snapshot();
      expect(s.screen).toBe("title");
      expect(s.score).toBe(0);
      expect(s.lives).toBe(START_LIVES);
      expect(s.depth).toBe(1);
      expect(s.brightness).toBe(0);
      expect(s.brightHold).toBe(0);
      expect(s.simTime).toBe(0);
      expect(s.sonar.ready).toBe(true);
      expect(s.ink.ready).toBe(true);
      expect(s.pulses).toHaveLength(0);
      expect(s.inkClouds).toHaveLength(0);
      expect(s.drifters).toHaveLength(0);
      expect(s.visibility.join("")).toMatch(/^u+$/);
      expect(s.planktonRemaining).toBeGreaterThan(0);
      expect(s.predators.every((p) => p.state === "den" && !p.released)).toBe(
        true,
      );
      expect(s.predators.every((p) => p.mind && p.travel)).toBe(true);
      expect(h.state.menu).toBe(0);
    });

    it("lays the maze out afresh with a plankton on every corridor tile", () => {
      api.clearPlankton();
      api.reset();
      const s = api.snapshot();
      expect(s.planktonRemaining).toBe(h.state.maze.corridorTiles().length);
      for (let ty = 0; ty < GRID_ROWS; ty += 1) {
        for (let tx = 0; tx < GRID_COLS; tx += 1) {
          expect(s.plankton[ty][tx]).toBe(s.tiles[ty][tx] === "." ? "*" : "-");
        }
      }
    });

    it("re-arms manual stepping, leaving the game off the wall clock", () => {
      api.setAutoStep(true);
      api.reset();
      expect(api.snapshot().autoStep).toBe(false);
    });

    it("leaves the mute preference alone", () => {
      h.state.muted = true;
      api.reset();
      expect(h.state.muted).toBe(true);
    });

    it("restores a creature's mind and its travel", () => {
      api.setScreen("playing");
      api.setPredatorMind(0, false);
      api.setPredatorTravel(0, false);
      api.reset();
      const p = api.snapshot().predators[0];
      expect(p.mind).toBe(true);
      expect(p.travel).toBe(true);
    });

    it("reseeds the game's randomness, so a run repeats exactly", () => {
      const run = (): number[] => {
        api.reset({ seed: 7 });
        api.setScreen("playing");
        api.advance(TICK_HZ * 6);
        return api.snapshot().predators.flatMap((p) => [p.tx, p.ty]);
      };
      expect(run()).toEqual(run());
    });

    it("takes a different seed to a different run", () => {
      const run = (seed: number): number[] => {
        api.reset({ seed });
        api.setScreen("playing");
        api.advance(TICK_HZ * 8);
        return api.snapshot().predators.flatMap((p) => [p.tx, p.ty]);
      };
      expect(run(1)).not.toEqual(run(99));
    });
  });

  describe("setScreen", () => {
    it("sets the screen and changes nothing else", () => {
      api.setScore(120);
      api.setLives(1);
      api.setDepth(3);
      const before = api.snapshot();
      api.setScreen("howto");
      const s = api.snapshot();
      expect(s.screen).toBe("howto");
      expect(s.score).toBe(120);
      expect(s.lives).toBe(1);
      expect(s.depth).toBe(3);
      expect(s.tiles).toEqual(before.tiles);
      expect(s.planktonRemaining).toBe(before.planktonRemaining);
    });

    it("counts the dive countdown down and gives way to live play", () => {
      api.setScreen("countdown");
      api.advance(ticks(COUNTDOWN_TIME) - 2);
      expect(api.snapshot().screen).toBe("countdown");
      api.advance(3);
      expect(api.snapshot().screen).toBe("playing");
    });

    it("takes the release schedule's origin from live play beginning", () => {
      api.setScreen("playing");
      expect(api.snapshot().predators[0].released).toBe(true);
      expect(api.snapshot().predators[1].released).toBe(false);
      api.advance(ticks(DEN_RELEASE_GAP) + 1);
      expect(api.snapshot().predators[1].released).toBe(true);
      expect(api.snapshot().predators[2].released).toBe(false);
    });

    it("freezes the maze while it is paused", () => {
      playOnFixture();
      api.setScreen("paused");
      h.hold("right");
      api.advance(TICK_HZ);
      const s = api.snapshot();
      expect([s.forager.tx, s.forager.ty]).toEqual([3, 8]);
      expect(s.simTime).toBeGreaterThan(0);
    });

    it("descends from the cleared interstitial on its own hold", () => {
      api.setScreen("cleared");
      api.advance(ticks(CLEARED_HOLD) + 1);
      const s = api.snapshot();
      expect(s.depth).toBe(2);
      expect(s.screen).toBe("countdown");
    });

    it("opens a menu screen on its first item", () => {
      h.state.menu = 2;
      api.setScreen("gameover");
      expect(h.state.menu).toBe(0);
    });

    it("refuses a screen the game does not carry", () => {
      expect(() => api.setScreen("nowhere" as Screen)).toThrow(RangeError);
    });
  });

  describe("setScore and setLives", () => {
    it("sets the running score, which play carries on from", () => {
      playOnFixture();
      api.setScore(250);
      expect(api.snapshot().score).toBe(250);
      api.setForagerTile(10, 8);
      api.advance(1);
      expect(api.snapshot().score).toBe(250 + SCORE_PLANKTON);
    });

    it("sets the lives held in reserve, the one being played apart", () => {
      playOnFixture();
      api.setLives(0);
      expect(api.snapshot().lives).toBe(0);
      api.setForagerTile(20, 8);
      api.addPredator("gloamfin", 20, 8);
      api.advance(1);
      expect(api.snapshot().screen).toBe("gameover");
    });

    it("refuses a figure below zero, or one that is not whole", () => {
      expect(() => api.setScore(-1)).toThrow(RangeError);
      expect(() => api.setScore(1.5)).toThrow(RangeError);
      expect(() => api.setLives(-1)).toThrow(RangeError);
      expect(() => api.setLives(1.5)).toThrow(RangeError);
    });
  });

  describe("setDepth", () => {
    it("recomputes the sonar range from the depth", () => {
      for (const [depth, range] of [
        [1, 9],
        [2, 8],
        [3, 7],
        [4, 6],
        [5, 5],
        [9, 5],
      ]) {
        api.setDepth(depth);
        expect(api.snapshot().sonar.range).toBe(range);
      }
    });

    it("recomputes the roster from the depth", () => {
      api.setDepth(1);
      expect(api.snapshot().predators.map((p) => p.kind)).toEqual([
        "lanternjaw",
        "gloamfin",
        "flarefish",
      ]);
      api.setDepth(4);
      expect(api.snapshot().predators.map((p) => p.kind)).toEqual([
        "lanternjaw",
        "gloamfin",
        "flarefish",
        "gloamfin",
        "lanternjaw",
        "flarefish",
      ]);
      api.setDepth(9);
      expect(api.snapshot().predators).toHaveLength(6);
    });

    it("lays the roster out in the den with every release flag false", () => {
      api.setScreen("playing");
      api.advance(TICK_HZ);
      api.setDepth(2);
      for (const p of api.snapshot().predators) {
        expect(p.state).toBe("den");
        expect(p.released).toBe(false);
        expect(h.state.maze.isDen(p.tx, p.ty)).toBe(true);
      }
    });

    it("changes neither the maze, the plankton, the fog nor the screen", () => {
      api.setScreen("countdown");
      api.advance(TICK_HZ);
      const before = api.snapshot();
      api.setDepth(3);
      const s = api.snapshot();
      expect(s.tiles).toEqual(before.tiles);
      expect(s.plankton).toEqual(before.plankton);
      expect(s.visibility).toEqual(before.visibility);
      expect(s.screen).toBe("countdown");
    });

    it("refuses a depth below one, or one that is not whole", () => {
      expect(() => api.setDepth(0)).toThrow(RangeError);
      expect(() => api.setDepth(1.5)).toThrow(RangeError);
    });
  });

  describe("setMaze", () => {
    beforeEach(() => {
      api.reset();
      api.setScreen("playing");
    });

    it("uses the posed layout exactly as given", () => {
      api.setMaze(fixture());
      expect(api.snapshot().tiles).toEqual(fixture());
    });

    it("leaves the score, the lives, the depth and the screen alone", () => {
      api.setScore(120);
      api.setLives(1);
      api.setDepth(3);
      api.setMaze(fixture());
      const s = api.snapshot();
      expect(s.score).toBe(120);
      expect(s.lives).toBe(1);
      expect(s.depth).toBe(3);
      expect(s.screen).toBe("playing");
    });

    it("leaves the cooldowns as they are", () => {
      api.setSonarCooldown(0.75);
      api.setInkCooldown(4);
      api.setMaze(fixture());
      const s = api.snapshot();
      expect(s.sonar.cooldown).toBe(0.75);
      expect(s.ink.cooldown).toBe(4);
    });

    it("leaves the revealed-tile memory as it stands", () => {
      api.setForagerTile(17, 15);
      api.advance(1);
      const before = api.snapshot().visibility;
      expect(before.join("")).toMatch(/[rl]/);
      api.setMaze(fixture());
      expect(api.snapshot().visibility).toEqual(before);
    });

    it("leaves every body on the tile it stands on", () => {
      api.setForagerTile(17, 15);
      const predators = api.snapshot().predators.map((p) => [p.tx, p.ty]);
      api.setMaze(fixture());
      const s = api.snapshot();
      expect([s.forager.tx, s.forager.ty]).toEqual([17, 15]);
      expect(s.predators.map((p) => [p.tx, p.ty])).toEqual(predators);
    });

    it("leaves the plankton standing, less what the new rock closed over", () => {
      const before = api.snapshot();
      api.setMaze(fixture());
      const s = api.snapshot();
      let kept = 0;
      for (let ty = 0; ty < GRID_ROWS; ty += 1) {
        for (let tx = 0; tx < GRID_COLS; tx += 1) {
          const open = s.tiles[ty][tx] === ".";
          const stood = before.plankton[ty][tx] === "*";
          expect(s.plankton[ty][tx]).toBe(open && stood ? "*" : "-");
          if (open && stood) kept += 1;
        }
      }
      expect(s.planktonRemaining).toBe(kept);
      expect(kept).toBeGreaterThan(0);
    });

    it("holds a body the layout closed over on the tile it stands on", () => {
      api.setForagerTile(17, 15);
      api.setMaze(fixture());
      h.hold("right");
      api.advance(TICK_HZ);
      const s = api.snapshot();
      expect([s.forager.tx, s.forager.ty]).toEqual([17, 15]);
      expect(s.forager.moving).toBe(false);
    });

    it("runs on a fixture that breaks every rule of a laid-out maze", () => {
      const dead = board(["....", "#..#"], 5, 5);
      expect(() => api.setMaze(dead)).not.toThrow();
      api.advance(TICK_HZ);
      expect(api.snapshot().tiles).toEqual(dead);
      expect(api.snapshot().screen).toBe("playing");
    });

    it("holds a denned predator out of play on a board with no den", () => {
      api.setMaze(board([".".repeat(10)], 8, 3));
      api.advance(ticks(DEN_RELEASE_GAP * 3));
      for (const p of api.snapshot().predators) {
        expect(p.state).toBe("den");
        expect(p.lit).toBe(false);
      }
      expect(api.snapshot().lives).toBe(START_LIVES);
    });

    it("admits no drifter on a board with no den gate", () => {
      api.setMaze(board([".".repeat(30)], 8, 3));
      api.advance(ticks(DEN_RELEASE_GAP * 3));
      expect(api.snapshot().drifters).toHaveLength(0);
    });

    it("holds until the next reset", () => {
      api.setMaze(fixture());
      api.reset();
      expect(api.snapshot().tiles).not.toEqual(fixture());
    });

    it("refuses a layout of the wrong size or alphabet", () => {
      expect(() => api.setMaze(["###"])).toThrow();
      expect(() =>
        api.setMaze(
          Array.from({ length: GRID_ROWS }, () => "x".repeat(GRID_COLS)),
        ),
      ).toThrow();
      expect(() => api.setMaze("nope" as unknown as string[])).toThrow();
      expect(() => api.setMaze([1] as unknown as string[])).toThrow();
    });

    it("refuses a layout carrying a den with more than one gate", () => {
      expect(() => api.setMaze(stamp(fixture(), ["g"], 4, 4))).toThrow();
    });
  });

  describe("the plankton operations", () => {
    beforeEach(playOnFixture);

    it("puts a plankton on a tile and takes one off, adjusting the count", () => {
      const before = api.snapshot().planktonRemaining;
      api.setPlankton(20, 8, false);
      expect(api.snapshot().planktonRemaining).toBe(before - 1);
      expect(api.snapshot().plankton[8][20]).toBe("-");
      expect(h.state.plankton[tileKey(20, 8)]).toBe(false);
      api.setPlankton(20, 8, true);
      expect(api.snapshot().planktonRemaining).toBe(before);
      expect(api.snapshot().plankton[8][20]).toBe("*");
    });

    it("scores nothing and clears no maze when it takes one off", () => {
      const score = api.snapshot().score;
      for (const tile of h.state.maze.corridorTiles()) {
        api.setPlankton(tile.col, tile.row, false);
      }
      api.advance(1);
      expect(api.snapshot().score).toBe(score);
      expect(api.snapshot().screen).toBe("playing");
    });

    it("takes every plankton off at once, leaving the maze in live play", () => {
      api.clearPlankton();
      expect(api.snapshot().planktonRemaining).toBe(0);
      expect(api.snapshot().plankton.join("")).toMatch(/^-+$/);
      api.advance(TICK_HZ);
      expect(api.snapshot().screen).toBe("playing");
    });

    it("admits no drifter while the maze holds no plankton", () => {
      api.clearPlankton();
      api.clearDrifters();
      api.advance(ticks(DEN_RELEASE_GAP * 3));
      expect(api.snapshot().drifters).toHaveLength(0);
    });

    it("refuses a tile that is not open corridor", () => {
      expect(() => api.setPlankton(0, 0, true)).toThrow(RangeError);
    });
  });

  describe("clearFog", () => {
    it("puts every tile back to unrevealed", () => {
      playOnFixture();
      api.advance(TICK_HZ);
      expect(api.snapshot().visibility.join("")).toMatch(/[rl]/);
      api.clearFog();
      expect(api.snapshot().visibility.join("")).toMatch(/^u+$/);
    });

    it("moves nothing", () => {
      playOnFixture();
      api.setForagerTile(12, 8);
      api.clearFog();
      const s = api.snapshot();
      expect([s.forager.tx, s.forager.ty]).toEqual([12, 8]);
    });
  });

  describe("posing the forager", () => {
    beforeEach(playOnFixture);

    it("moves it to a tile's center and leaves it at rest", () => {
      api.setForagerDir("up");
      api.setForagerTile(12, 8);
      const s = api.snapshot();
      expect([s.forager.tx, s.forager.ty]).toEqual([12, 8]);
      expect(s.forager.x).toBe(Maze.centerX(12));
      expect(s.forager.y).toBe(Maze.centerY(8));
      expect(s.forager.moving).toBe(false);
      expect(s.forager.dir).toBe("up");
    });

    it("sets its facing without moving it", () => {
      api.setForagerTile(12, 8);
      api.setForagerDir("left");
      const s = api.snapshot();
      expect(s.forager.dir).toBe("left");
      expect([s.forager.tx, s.forager.ty]).toEqual([12, 8]);
      expect(s.forager.moving).toBe(false);
    });

    it("refuses a tile that is not open corridor", () => {
      expect(() => api.setForagerTile(0, 0)).toThrow(RangeError);
      expect(() => api.setForagerTile(17, 2)).toThrow(RangeError);
      expect(() => api.setForagerTile(-1, 8)).toThrow(RangeError);
      expect(() => api.setForagerTile(GRID_COLS, 8)).toThrow(RangeError);
    });

    it("refuses a direction that is not cardinal", () => {
      expect(() => api.setForagerDir("sideways" as "up")).toThrow(RangeError);
    });
  });

  describe("the brightness operations", () => {
    it("recomputes everything derived from the brightness", () => {
      api.setBrightness(0);
      expect(api.snapshot().visionRadius).toBe(VISION_MIN);
      expect(api.snapshot().windowRadius).toBe(KINDLE_VISION_MIN);
      expect(api.snapshot().predators[0].detectRange).toBe(LANTERN_RANGE_BASE);
      api.setBrightness(1);
      expect(api.snapshot().visionRadius).toBe(160);
      expect(api.snapshot().windowRadius).toBe(320);
      expect(api.snapshot().predators[0].detectRange).toBe(320);
    });

    it("leaves the hold exactly as it stands", () => {
      api.setBrightHold(0.25);
      api.setBrightness(0.5);
      expect(api.snapshot().brightHold).toBe(0.25);
    });

    it("holds the brightness steady for as long as the hold has left", () => {
      playOnFixture();
      api.setForagerTile(20, 8);
      api.setPlankton(20, 8, false);
      api.setBrightness(0.5);
      api.setBrightHold(BRIGHT_HOLD);
      api.advance(ticks(BRIGHT_HOLD) - 2);
      expect(api.snapshot().brightness).toBeCloseTo(0.5, 6);
      api.advance(TICK_HZ);
      expect(api.snapshot().brightness).toBeLessThan(0.5);
    });

    it("decays at once from a brightness posed with no hold left", () => {
      playOnFixture();
      api.setForagerTile(20, 8);
      api.setPlankton(20, 8, false);
      api.setBrightHold(0);
      api.setBrightness(0.5);
      api.advance(1);
      expect(api.snapshot().brightness).toBeLessThan(0.5);
    });

    it("runs the hold down as the simulation advances", () => {
      playOnFixture();
      api.setForagerTile(20, 8);
      api.setPlankton(20, 8, false);
      api.setBrightHold(BRIGHT_HOLD);
      api.advance(ticks(0.5));
      expect(api.snapshot().brightHold).toBeCloseTo(BRIGHT_HOLD - 0.5, 6);
    });

    it("refuses a brightness or a hold outside its range", () => {
      expect(() => api.setBrightness(-0.1)).toThrow(RangeError);
      expect(() => api.setBrightness(1.1)).toThrow(RangeError);
      expect(() => api.setBrightness(Number.NaN)).toThrow(RangeError);
      expect(() => api.setBrightHold(-0.1)).toThrow(RangeError);
      expect(() => api.setBrightHold(BRIGHT_HOLD + 0.1)).toThrow(RangeError);
    });
  });

  describe("clearPredators and addPredator", () => {
    beforeEach(playOnFixture);

    it("takes every predator off the board at once", () => {
      api.clearPredators();
      expect(api.snapshot().predators).toEqual([]);
      api.advance(ticks(DEN_RELEASE_GAP * 3));
      expect(api.snapshot().predators).toEqual([]);
      expect(api.snapshot().lives).toBe(START_LIVES);
    });

    it("gives the depth its roster back on the next setDepth", () => {
      api.clearPredators();
      api.setDepth(1);
      expect(api.snapshot().predators).toHaveLength(3);
    });

    it("adds one loose and patrolling at the end of the roster", () => {
      api.clearPredators();
      api.addPredator("flarefish", 20, 8);
      api.addPredator("gloamfin", 24, 8);
      const s = api.snapshot();
      expect(s.predators.map((p) => p.kind)).toEqual(["flarefish", "gloamfin"]);
      expect(s.predators[0]).toMatchObject({
        x: Maze.centerX(20),
        y: Maze.centerY(8),
        tx: 20,
        ty: 8,
        dir: "up",
        state: "wander",
        released: true,
        mind: true,
        travel: true,
      });
    });

    it("hunts, chases and makes contact exactly as a released one does", () => {
      api.clearPredators();
      api.setForagerTile(20, 8);
      api.setBrightness(1);
      api.setBrightHold(BRIGHT_HOLD);
      api.addPredator("lanternjaw", 24, 8);
      api.advance(ticks(0.5));
      expect(api.snapshot().predators[0].state).toBe("chase");
      expect(api.snapshot().predators[0].tx).toBeLessThan(24);
    });

    it("refuses a kind the game does not carry, or a tile off the corridor", () => {
      expect(() => api.addPredator("kraken" as "gloamfin", 20, 8)).toThrow(
        RangeError,
      );
      expect(() => api.addPredator("gloamfin", 17, 2)).toThrow(RangeError);
    });
  });

  describe("posing a predator", () => {
    beforeEach(() => {
      playOnFixture();
      denRoster();
    });

    it("addresses a predator by its index in the snapshot's list", () => {
      api.setPredatorTile(1, 20, 8);
      api.setPredatorState(1, "wander");
      const s = api.snapshot();
      expect(s.predators[1].kind).toBe("gloamfin");
      expect([s.predators[1].tx, s.predators[1].ty]).toEqual([20, 8]);
      expect(s.predators[0].state).toBe("den");
    });

    it("moves one without touching its facing, state, flag or faculties", () => {
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorDir(0, "left");
      api.setPredatorReleased(0, false);
      api.setPredatorMind(0, false);
      api.setPredatorTravel(0, false);
      api.setPredatorTile(0, 24, 8);
      const s = api.snapshot();
      expect([s.predators[0].tx, s.predators[0].ty]).toEqual([24, 8]);
      expect(s.predators[0].dir).toBe("left");
      expect(s.predators[0].state).toBe("wander");
      expect(s.predators[0].released).toBe(false);
      expect(s.predators[0].mind).toBe(false);
      expect(s.predators[0].travel).toBe(false);
    });

    it("poses a predator loose with no fix", () => {
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      const p = api.snapshot().predators[0];
      expect(p.state).toBe("wander");
      expect([p.tx, p.ty]).toEqual([20, 8]);
    });

    it("poses a chase, which the predator then pursues on its own", () => {
      api.setForagerTile(5, 8);
      api.setPredatorTile(1, 20, 8);
      api.setPredatorState(1, "chase");
      expect(api.snapshot().predators[1].state).toBe("chase");
      const before = api.snapshot().predators[1].tx;
      api.advance(TICK_HZ);
      expect(api.snapshot().predators[1].tx).toBeLessThan(before);
    });

    it("poses a state where the predator stands, moving it nowhere", () => {
      api.setPredatorTile(0, 17, 2);
      api.setPredatorState(0, "den");
      const p = api.snapshot().predators[0];
      expect(p.state).toBe("den");
      expect([p.tx, p.ty]).toEqual([17, 2]);
      expect(p.lit).toBe(false);
    });

    it("leaves the release flag alone when it poses a state", () => {
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorReleased(0, false);
      api.setPredatorState(0, "chase");
      expect(api.snapshot().predators[0].released).toBe(false);
    });

    it("sets the release flag without moving it or changing its state", () => {
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorReleased(0, false);
      const s = api.snapshot();
      expect(s.predators[0].released).toBe(false);
      expect(s.predators[0].state).toBe("wander");
      expect([s.predators[0].tx, s.predators[0].ty]).toEqual([20, 8]);
    });

    it("holds one whose mind is off exactly where it stands", () => {
      api.setForagerTile(3, 8);
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorMind(0, false);
      api.setPredatorTile(1, 24, 8);
      api.setPredatorState(1, "wander");
      api.advance(TICK_HZ * 2);
      const s = api.snapshot();
      expect([s.predators[0].tx, s.predators[0].ty]).toEqual([20, 8]);
      expect(s.predators[0].state).toBe("wander");
      expect(s.predators[0].mind).toBe(false);
      // Its neighbor's mind is untouched, so that one has patrolled away.
      expect(s.predators[1].tx).not.toBe(24);
    });

    it("costs a life on contact with one whose mind is off", () => {
      api.setPlankton(20, 8, false);
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorMind(0, false);
      api.setForagerTile(20, 8);
      api.advance(1);
      expect(api.snapshot().lives).toBe(START_LIVES - 1);
    });

    it("holds the body of one whose travel is off on the tile it stands on", () => {
      api.setForagerTile(3, 8);
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorTravel(0, false);
      api.setPredatorTile(1, 24, 8);
      api.setPredatorState(1, "wander");
      api.advance(TICK_HZ * 2);
      const s = api.snapshot();
      expect([s.predators[0].tx, s.predators[0].ty]).toEqual([20, 8]);
      expect(s.predators[0].x).toBe(Maze.centerX(20));
      expect(s.predators[0].travel).toBe(false);
      // Its neighbor's travel is untouched, so that one has patrolled away.
      expect(s.predators[1].tx).not.toBe(24);
    });

    it("runs the mind of one whose travel is off through the real code", () => {
      api.setPlankton(20, 8, false);
      api.setForagerTile(20, 8);
      api.setPredatorTile(1, 21, 8);
      api.setPredatorState(1, "wander");
      api.setPredatorTravel(1, false);
      api.advance(1);
      const s = api.snapshot();
      // It heard, took a fresh fix, fired its alert and opened the chase at the
      // speed a chase carries — all of it while its body held its tile.
      expect(s.predators[1].hearingLock).toBe(true);
      expect(s.predators[1].state).toBe("chase");
      expect(s.predators[1].alert).toBe(true);
      expect(s.predators[1].speed).toBe(GLOAMFIN_CHASE_SPEED);
      expect([s.predators[1].tx, s.predators[1].ty]).toEqual([21, 8]);
    });

    it("lapses the fix of one whose travel is off, as an unheld one does", () => {
      api.setForagerTile(20, 8);
      api.setPredatorTile(0, 21, 8);
      api.setPredatorState(0, "chase");
      api.setPredatorTravel(0, false);
      api.setForagerTile(3, 8);
      api.setBrightness(0);
      api.advance(ticks(LINGER_TIME) + TICK_HZ);
      const s = api.snapshot();
      expect(s.predators[0].state).toBe("wander");
      expect([s.predators[0].tx, s.predators[0].ty]).toEqual([21, 8]);
    });

    it("turns the release flag of one whose travel is off over on schedule", () => {
      // A den that opens onto the corridor, so a predator whose travel is on
      // does leave it and the contrast is the switch and nothing else.
      api.setMaze(stamp(board([".".repeat(30)], 8, 3), SEALED_DEN, 9, 16));
      api.setDepth(1);
      const slot = api.snapshot().predators[1];
      api.setPredatorTravel(1, false);
      api.advance(ticks(DEN_RELEASE_GAP) + TICK_HZ);
      const s = api.snapshot();
      // Its slot came, so its flag turned over; crossing the chamber to the gate
      // is travel, so it holds in the den from there.
      expect(s.predators[1].released).toBe(true);
      expect(s.predators[1].state).toBe("den");
      expect([s.predators[1].tx, s.predators[1].ty]).toEqual([
        slot.tx,
        slot.ty,
      ]);
      // Its neighbor's travel is untouched, so that one is out of the chamber.
      expect(s.predators[0].state).not.toBe("den");
    });

    it("costs a life on contact with one whose travel is off", () => {
      api.setPlankton(20, 8, false);
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorTravel(0, false);
      api.setForagerTile(20, 8);
      api.advance(1);
      expect(api.snapshot().lives).toBe(START_LIVES - 1);
    });

    it("refuses a tile no predator may stand on", () => {
      expect(() => api.setPredatorTile(0, 0, 0)).toThrow(RangeError);
    });

    it("accepts a den tile and the gate", () => {
      expect(() => api.setPredatorTile(0, 17, 2)).not.toThrow();
      expect(() => api.setPredatorTile(0, 17, 1)).not.toThrow();
    });

    it("refuses an index outside the roster", () => {
      expect(() => api.setPredatorTile(9, 20, 8)).toThrow(RangeError);
      expect(() => api.setPredatorDir(9, "up")).toThrow(RangeError);
      expect(() => api.setPredatorState(9, "wander")).toThrow(RangeError);
      expect(() => api.setPredatorReleased(9, true)).toThrow(RangeError);
      expect(() => api.setPredatorMind(9, false)).toThrow(RangeError);
      expect(() => api.setPredatorTravel(9, false)).toThrow(RangeError);
    });

    it("refuses a state that is not posable", () => {
      expect(() => api.setPredatorState(0, "search")).toThrow(RangeError);
    });

    it("refuses a state the predator's own tile does not allow", () => {
      api.setPredatorTile(0, 20, 8);
      expect(() => api.setPredatorState(0, "den")).toThrow(RangeError);
      api.setPredatorTile(0, 17, 2);
      expect(() => api.setPredatorState(0, "wander")).toThrow(RangeError);
      expect(() => api.setPredatorState(0, "chase")).toThrow(RangeError);
    });
  });

  describe("the drifter operations", () => {
    beforeEach(playOnFixture);

    it("adds a drifter at a tile's center, past the ordinary ceiling", () => {
      api.spawnDrifter(10, 8);
      api.spawnDrifter(12, 8);
      api.spawnDrifter(14, 8);
      const s = api.snapshot();
      expect(s.drifters).toHaveLength(3);
      expect(s.drifters[0]).toEqual({
        x: Maze.centerX(10),
        y: Maze.centerY(8),
        tx: 10,
        ty: 8,
        // Spawned out of the forager's light pocket, so its body is undrawn.
        lit: false,
        mind: true,
        travel: true,
      });
    });

    it("lets it wander through the ordinary drifter code", () => {
      api.setForagerTile(3, 8);
      api.spawnDrifter(20, 8);
      api.advance(TICK_HZ);
      expect(api.snapshot().drifters[0].x).not.toBe(Maze.centerX(20));
    });

    it("takes every drifter off the maze at once, scoring nothing", () => {
      api.spawnDrifter(10, 8);
      api.spawnDrifter(12, 8);
      const score = api.snapshot().score;
      api.clearDrifters();
      expect(api.snapshot().drifters).toEqual([]);
      expect(api.snapshot().score).toBe(score);
    });

    it("holds one whose mind is off exactly where it stands", () => {
      api.setForagerTile(3, 8);
      api.spawnDrifter(20, 8);
      api.spawnDrifter(24, 8);
      api.setDrifterMind(0, false);
      api.advance(TICK_HZ);
      const s = api.snapshot();
      expect([s.drifters[0].tx, s.drifters[0].ty]).toEqual([20, 8]);
      expect(s.drifters[0].mind).toBe(false);
      expect(s.drifters[1].x).not.toBe(Maze.centerX(24));
    });

    it("still eats one whose mind is off, for the ordinary bonus", () => {
      api.setForagerTile(20, 8);
      api.setPlankton(20, 8, false);
      api.spawnDrifter(20, 8);
      api.setDrifterMind(0, false);
      const score = api.snapshot().score;
      api.advance(1);
      expect(api.snapshot().drifters).toEqual([]);
      expect(api.snapshot().score).toBeGreaterThan(score);
    });

    it("holds one whose travel is off exactly where it stands", () => {
      api.setForagerTile(3, 8);
      api.spawnDrifter(20, 8);
      api.spawnDrifter(24, 8);
      api.setDrifterTravel(0, false);
      api.advance(TICK_HZ);
      const s = api.snapshot();
      expect([s.drifters[0].tx, s.drifters[0].ty]).toEqual([20, 8]);
      expect(s.drifters[0].x).toBe(Maze.centerX(20));
      expect(s.drifters[0].travel).toBe(false);
      expect(s.drifters[1].x).not.toBe(Maze.centerX(24));
    });

    it("still eats one whose travel is off, for the ordinary bonus", () => {
      api.setForagerTile(20, 8);
      api.setPlankton(20, 8, false);
      api.spawnDrifter(20, 8);
      api.setDrifterTravel(0, false);
      const score = api.snapshot().score;
      api.advance(1);
      expect(api.snapshot().drifters).toEqual([]);
      expect(api.snapshot().score).toBeGreaterThan(score);
    });

    it("refuses a tile that is not open corridor, or an index it has not", () => {
      expect(() => api.spawnDrifter(17, 2)).toThrow(RangeError);
      expect(() => api.setDrifterMind(0, false)).toThrow(RangeError);
      expect(() => api.setDrifterTravel(0, false)).toThrow(RangeError);
    });
  });

  describe("the cooldown operations", () => {
    it("poses the sonar cooldown, which then runs down as it ordinarily does", () => {
      api.setScreen("playing");
      api.setSonarCooldown(1);
      expect(api.snapshot().sonar).toMatchObject({ ready: false, cooldown: 1 });
      api.advance(TICK_HZ / 2);
      expect(api.snapshot().sonar.cooldown).toBeCloseTo(0.5, 6);
      api.advance(TICK_HZ);
      expect(api.snapshot().sonar.ready).toBe(true);
    });

    it("poses ink's cooldown", () => {
      api.setScreen("playing");
      api.setInkCooldown(2);
      expect(api.snapshot().ink).toMatchObject({ ready: false, cooldown: 2 });
      api.setInkCooldown(0);
      expect(api.snapshot().ink.ready).toBe(true);
    });

    it("refuses a negative cooldown", () => {
      expect(() => api.setSonarCooldown(-1)).toThrow(RangeError);
      expect(() => api.setInkCooldown(-1)).toThrow(RangeError);
    });
  });

  describe("the snapshot", () => {
    it("reports the tile grid's own frame", () => {
      expect(api.snapshot().grid).toEqual({
        cols: GRID_COLS,
        rows: GRID_ROWS,
        tile: TILE,
        originX: GRID_ORIGIN_X,
        originY: GRID_ORIGIN_Y,
      });
    });

    it("reports the layout, the plankton and the visibility in one shape", () => {
      const s = api.snapshot();
      expect(s.tiles).toHaveLength(GRID_ROWS);
      expect(s.plankton).toHaveLength(GRID_ROWS);
      expect(s.visibility).toHaveLength(GRID_ROWS);
      for (const row of s.tiles) expect(row).toMatch(/^[#.gd]{36}$/);
      for (const row of s.plankton) expect(row).toMatch(/^[*-]{36}$/);
      for (const row of s.visibility) expect(row).toMatch(/^[url]{36}$/);
    });

    it("counts the plankton the layer carries", () => {
      playOnFixture();
      api.setPlankton(20, 8, false);
      const s = api.snapshot();
      const carried = s.plankton.join("").split("*").length - 1;
      expect(s.planktonRemaining).toBe(carried);
    });

    it("reports each kind's own fields and nulls the rest", () => {
      api.setDepth(1);
      const [lantern, gloam, flare] = api.snapshot().predators;
      expect(lantern.hearingRange).toBeNull();
      expect(lantern.hearingLock).toBeNull();
      expect(lantern.flaring).toBeNull();
      expect(lantern.flareRadius).toBeNull();
      expect(lantern.alert).toBe(false);
      expect(gloam.detectRange).toBeNull();
      expect(gloam.hearingRange).toBe(GLOAMFIN_HEAR);
      expect(gloam.hearingLock).toBe(false);
      expect(gloam.flareCharging).toBeNull();
      expect(flare.hearingRange).toBeNull();
      expect(flare.flareCharging).toBe(false);
      expect(flare.flaring).toBe(false);
      expect(flare.flareRadius).toBe(0);
    });

    it("reports every wavefront in flight and every ink cloud standing", () => {
      playOnFixture();
      api.setForagerTile(10, 8);
      h.press("a");
      h.press("b");
      api.advance(Math.round(TICK_HZ * 0.2));
      const s = api.snapshot();
      expect(s.pulses).toEqual([
        {
          source: "forager",
          tint: "cyan",
          ox: 10,
          oy: 8,
          front: s.pulses[0].front,
          range: 9,
        },
      ]);
      expect(s.pulses[0].front).toBeGreaterThan(0);
      expect(s.inkClouds).toHaveLength(1);
      expect(s.inkClouds[0]).toMatchObject({
        x: Maze.centerX(10),
        y: Maze.centerY(8),
        radius: INK_RADIUS,
      });
      expect(s.inkClouds[0].remaining).toBeLessThan(INK_LIFE);
    });

    it("is a pure read that changes nothing", () => {
      api.setScreen("playing");
      api.advance(30);
      const first = JSON.stringify(api.snapshot());
      api.snapshot();
      expect(JSON.stringify(api.snapshot())).toBe(first);
    });

    it("serializes to JSON as it stands", () => {
      api.setScreen("playing");
      api.advance(30);
      expect(() => JSON.stringify(api.snapshot())).not.toThrow();
    });
  });
});
