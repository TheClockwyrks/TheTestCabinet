import { beforeEach, describe, expect, it } from "vitest";

import { board, SEALED_DEN, stamp } from "./board.test-support";
import {
  BRIGHT_HOLD,
  DEN_RELEASE_GAP,
  FATHOM_DEBUG_VERSION,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_LIFE,
  INK_RADIUS,
  KINDLE_VISION_MIN,
  START_LIVES,
  TICK_HZ,
  TILE,
  VISION_MIN,
} from "./constants";
import { createDebugApi, type FathomDebugApi } from "./debug";
import { harness, type Harness } from "./harness.test-support";
import { Maze } from "./maze";
import { tileKey } from "./sensing";

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
      api.startDive();
      api.beginPlay();
      api.advance(TICK_HZ);
      api.reset();
      const s = api.snapshot();
      expect(s.screen).toBe("title");
      expect(s.score).toBe(0);
      expect(s.lives).toBe(START_LIVES);
      expect(s.depth).toBe(1);
      expect(s.brightness).toBe(0);
      expect(s.simTime).toBe(0);
      expect(s.creatureAI).toBe(true);
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
      expect(h.state.menu).toBe(0);
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

    it("reseeds the game's randomness, so a run repeats exactly", () => {
      const run = (): number[] => {
        api.reset({ seed: 7 });
        api.startDive();
        api.beginPlay();
        api.advance(TICK_HZ * 6);
        return api.snapshot().predators.flatMap((p) => [p.tx, p.ty]);
      };
      expect(run()).toEqual(run());
    });

    it("takes a different seed to a different run", () => {
      const run = (seed: number): number[] => {
        api.reset({ seed });
        api.startDive();
        api.beginPlay();
        api.advance(TICK_HZ * 8);
        return api.snapshot().predators.flatMap((p) => [p.tx, p.ty]);
      };
      expect(run(1)).not.toEqual(run(99));
    });
  });

  describe("startDive and beginPlay", () => {
    it("opens a dive on the countdown", () => {
      h.state.score = 500;
      h.state.depth = 4;
      api.startDive();
      const s = api.snapshot();
      expect(s.screen).toBe("countdown");
      expect(s.score).toBe(0);
      expect(s.depth).toBe(1);
      expect(s.lives).toBe(START_LIVES);
    });

    it("leaves the accumulated simulation time as it is", () => {
      api.advance(60);
      const before = api.snapshot().simTime;
      api.startDive();
      expect(api.snapshot().simTime).toBe(before);
    });

    it("ends the countdown at once and starts the release schedule", () => {
      api.startDive();
      api.beginPlay();
      expect(api.snapshot().screen).toBe("playing");
      api.advance(1);
      expect(api.snapshot().predators[0].released).toBe(true);
      api.advance(TICK_HZ * DEN_RELEASE_GAP);
      expect(api.snapshot().predators[1].released).toBe(true);
    });

    it("applies on the countdown screen alone", () => {
      api.beginPlay();
      expect(api.snapshot().screen).toBe("title");
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

    it("changes neither the maze nor the screen", () => {
      api.startDive();
      const tiles = api.snapshot().tiles;
      api.setDepth(3);
      expect(api.snapshot().tiles).toEqual(tiles);
      expect(api.snapshot().screen).toBe("countdown");
    });

    it("leaves a posed board's release schedule suspended", () => {
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
      api.setDepth(4);
      api.advance(TICK_HZ * DEN_RELEASE_GAP * 3);
      const predators = api.snapshot().predators;
      expect(predators).toHaveLength(6);
      for (const p of predators) {
        expect(p.released).toBe(false);
        expect(p.state).toBe("den");
      }
    });

    it("refuses a depth below one, or one that is not whole", () => {
      expect(() => api.setDepth(0)).toThrow(RangeError);
      expect(() => api.setDepth(1.5)).toThrow(RangeError);
    });
  });

  describe("setMaze", () => {
    beforeEach(() => {
      api.startDive();
      api.beginPlay();
    });

    it("uses the posed layout exactly as given", () => {
      api.setMaze(fixture());
      expect(api.snapshot().tiles).toEqual(fixture());
    });

    it("rests the forager on the first corridor tile in reading order", () => {
      api.setMaze(fixture());
      const s = api.snapshot();
      expect([s.forager.tx, s.forager.ty]).toEqual([3, 8]);
      expect(s.forager.moving).toBe(false);
    });

    it("puts a plankton on every corridor tile and clears the memory", () => {
      api.setMaze(fixture());
      const s = api.snapshot();
      expect(s.planktonRemaining).toBe(33);
      expect(s.visibility.join("")).toMatch(/^u+$/);
    });

    it("returns every predator to a den tile, unreleased and held there", () => {
      api.setMaze(fixture());
      api.advance(TICK_HZ * DEN_RELEASE_GAP * 3);
      for (const p of api.snapshot().predators) {
        expect(p.state).toBe("den");
        expect(p.released).toBe(false);
      }
    });

    it("leaves the score, the lives, the depth and the screen alone", () => {
      h.state.score = 120;
      h.state.lives = 1;
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

    it("runs on a fixture that breaks every rule of a laid-out maze", () => {
      const dead = board(["....", "#..#"], 5, 5);
      expect(() => api.setMaze(dead)).not.toThrow();
      api.advance(TICK_HZ);
      expect(api.snapshot().tiles).toEqual(dead);
      expect(api.snapshot().screen).toBe("playing");
    });

    it("holds a predator out of play on a board with no den", () => {
      api.setMaze(board([".".repeat(10)], 8, 3));
      api.advance(TICK_HZ * DEN_RELEASE_GAP * 3);
      for (const p of api.snapshot().predators) {
        expect(p.state).toBe("den");
        expect(p.released).toBe(false);
        expect(p.lit).toBe(false);
      }
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

  describe("posing the forager", () => {
    beforeEach(() => {
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
    });

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

  describe("setBrightness", () => {
    it("recomputes everything derived from the brightness", () => {
      api.setBrightness(0);
      expect(api.snapshot().visionRadius).toBe(VISION_MIN);
      expect(api.snapshot().windowRadius).toBe(KINDLE_VISION_MIN);
      expect(api.snapshot().predators[0].detectRange).toBe(128);
      api.setBrightness(1);
      expect(api.snapshot().visionRadius).toBe(160);
      expect(api.snapshot().windowRadius).toBe(320);
      expect(api.snapshot().predators[0].detectRange).toBe(320);
    });

    it("arms the hold in full, so the value it poses is steady", () => {
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
      api.setForagerTile(20, 8);
      api.setPlankton(20, 8, false);
      api.setBrightness(0.5);
      expect(h.state.forager.hold).toBe(BRIGHT_HOLD);
      api.advance(Math.round(BRIGHT_HOLD * TICK_HZ) - 2);
      expect(api.snapshot().brightness).toBeCloseTo(0.5, 6);
      api.advance(TICK_HZ);
      expect(api.snapshot().brightness).toBeLessThan(0.5);
    });

    it("refuses a brightness outside its range", () => {
      expect(() => api.setBrightness(-0.1)).toThrow(RangeError);
      expect(() => api.setBrightness(1.1)).toThrow(RangeError);
      expect(() => api.setBrightness(Number.NaN)).toThrow(RangeError);
    });
  });

  describe("posing a predator", () => {
    beforeEach(() => {
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
    });

    it("addresses a predator by its index in the snapshot's list", () => {
      api.setPredatorState(1, "wander");
      api.setPredatorTile(1, 20, 8);
      const s = api.snapshot();
      expect(s.predators[1].kind).toBe("gloamfin");
      expect([s.predators[1].tx, s.predators[1].ty]).toEqual([20, 8]);
      expect(s.predators[0].state).toBe("den");
    });

    it("leaves the facing, the state and the release flag untouched", () => {
      api.setPredatorState(0, "wander");
      api.setPredatorDir(0, "left");
      api.setPredatorTile(0, 20, 8);
      const s = api.snapshot();
      expect(s.predators[0].dir).toBe("left");
      expect(s.predators[0].state).toBe("wander");
      expect(s.predators[0].released).toBe(true);
    });

    it("poses a predator loose with no fix", () => {
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      const p = api.snapshot().predators[0];
      expect(p.state).toBe("wander");
      expect(p.released).toBe(true);
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

    it("returns a predator to the den and suspends its release time", () => {
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.setPredatorState(0, "den");
      const p = api.snapshot().predators[0];
      expect(p.state).toBe("den");
      expect(p.released).toBe(false);
      expect(h.state.maze.isDen(p.tx, p.ty)).toBe(true);
      api.advance(TICK_HZ * DEN_RELEASE_GAP * 3);
      expect(api.snapshot().predators[0].released).toBe(false);
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
    });

    it("refuses a state that is not posable", () => {
      expect(() => api.setPredatorState(0, "search")).toThrow(RangeError);
    });
  });

  describe("the plankton operations", () => {
    beforeEach(() => {
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
    });

    it("puts a plankton on a tile and takes one off, adjusting the count", () => {
      const before = api.snapshot().planktonRemaining;
      api.setPlankton(20, 8, false);
      expect(api.snapshot().planktonRemaining).toBe(before - 1);
      expect(h.state.plankton[tileKey(20, 8)]).toBe(false);
      api.setPlankton(20, 8, true);
      expect(api.snapshot().planktonRemaining).toBe(before);
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
      api.advance(TICK_HZ);
      expect(api.snapshot().screen).toBe("playing");
    });

    it("refuses a tile that is not open corridor", () => {
      expect(() => api.setPlankton(0, 0, true)).toThrow(RangeError);
    });
  });

  describe("spawnDrifter", () => {
    beforeEach(() => {
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
    });

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
      });
    });

    it("lets it wander through the ordinary drifter code", () => {
      api.setForagerTile(3, 8);
      api.spawnDrifter(20, 8);
      api.advance(TICK_HZ);
      expect(api.snapshot().drifters[0].x).not.toBe(Maze.centerX(20));
    });

    it("refuses a tile that is not open corridor", () => {
      expect(() => api.spawnDrifter(17, 2)).toThrow(RangeError);
    });
  });

  describe("setCreatureAI", () => {
    it("holds every creature where it stands when it is off", () => {
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
      api.setForagerTile(3, 8);
      api.setPredatorTile(0, 20, 8);
      api.setPredatorState(0, "wander");
      api.spawnDrifter(24, 8);
      api.setCreatureAI(false);
      expect(api.snapshot().creatureAI).toBe(false);
      api.advance(TICK_HZ * 2);
      const s = api.snapshot();
      expect([s.predators[0].tx, s.predators[0].ty]).toEqual([20, 8]);
      expect(s.predators[0].state).toBe("wander");
      expect([s.drifters[0].tx, s.drifters[0].ty]).toEqual([24, 8]);
    });
  });

  describe("the cooldown operations", () => {
    it("poses the sonar cooldown, which then runs down as it ordinarily does", () => {
      api.startDive();
      api.beginPlay();
      api.setSonarCooldown(1);
      expect(api.snapshot().sonar).toMatchObject({ ready: false, cooldown: 1 });
      api.advance(TICK_HZ / 2);
      expect(api.snapshot().sonar.cooldown).toBeCloseTo(0.5, 6);
      api.advance(TICK_HZ);
      expect(api.snapshot().sonar.ready).toBe(true);
    });

    it("poses ink's cooldown", () => {
      api.startDive();
      api.beginPlay();
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

    it("reports the layout and the visibility in the same shape", () => {
      const s = api.snapshot();
      expect(s.tiles).toHaveLength(GRID_ROWS);
      expect(s.visibility).toHaveLength(GRID_ROWS);
      for (const row of s.tiles) expect(row).toMatch(/^[#.gd]{36}$/);
      for (const row of s.visibility) expect(row).toMatch(/^[url]{36}$/);
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
      api.startDive();
      api.beginPlay();
      api.setMaze(fixture());
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
      api.startDive();
      api.beginPlay();
      api.advance(30);
      const first = JSON.stringify(api.snapshot());
      api.snapshot();
      expect(JSON.stringify(api.snapshot())).toBe(first);
    });

    it("serializes to JSON as it stands", () => {
      api.startDive();
      api.beginPlay();
      api.advance(30);
      expect(() => JSON.stringify(api.snapshot())).not.toThrow();
    });
  });
});
