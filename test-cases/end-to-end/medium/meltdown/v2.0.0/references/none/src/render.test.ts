// The renderer, driven over a real 2D context.
//
// A drawing is not a value, so what is measured here is the two things that CAN
// be: that every state the game can reach is drawable — every screen, every
// phase, every mode, every tower at every level, tripped and not, every surge
// type, a held preview valid and invalid, an open inspector, a hovered entry,
// shots in flight — and that the picture is laid out where `specs/floor.md` and
// `specs/hud.md` put it, read back off the canvas a pixel at a time.
//
// What each readout SAYS is measured through the panel's own geometry in
// `src/panel.test.ts` and through the snapshot in `src/debug.test.ts`.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  PANEL_X,
  STAGE_H,
  STAGE_W,
  SURGE_TYPES,
  TOWER_TYPES,
} from "./constants";
import { previewTypeLabel, renderGame } from "./render";
import { addTower, arm, movePreviewTo } from "./build";
import { addUnit } from "./sim";
import { createState, startRun, type MeltdownState } from "./state";
import { centreOf } from "./towers";
import type { DifficultyId, ModeId, Screen } from "./types";

/** A canvas at the logical stage size, drawn through with no transform. */
function surface(): {
  ctx: CanvasRenderingContext2D;
  draw: (state: MeltdownState) => void;
  pixel: (x: number, y: number) => [number, number, number, number];
} {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const raw = canvas.getContext("2d");
  const ctx = raw as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    draw: (state) => renderGame(state, ctx),
    pixel: (x, y) => {
      const { data } = (raw as SKRSContext2D).getImageData(x, y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
  };
}

/** A run in live play, in its wave phase. */
function playing(mode: ModeId = "containment"): MeltdownState {
  const state = createState();
  state.mode = mode;
  startRun(state);
  state.screen = "playing";
  state.phase = "wave";
  return state;
}

describe("every reachable state is drawable", () => {
  it("draws every screen in every phase", () => {
    const s = surface();
    const state = playing();
    addTower(state, "arc", 24, 17, 0);
    addUnit(state, "mote", "left");
    const screens: Screen[] = [
      "title",
      "modeselect",
      "difficultyselect",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ];
    for (const screen of screens) {
      state.screen = screen;
      for (const phase of ["opening", "building", "wave"] as const) {
        state.phase = phase;
        expect(() => s.draw(state)).not.toThrow();
      }
    }
  });

  it("draws every mode and difficulty, zone and all", () => {
    const s = surface();
    const modes: ModeId[] = [
      "containment",
      "hundred",
      "deeppockets",
      "bottleneck",
      "suddendeath",
    ];
    const difficulties: DifficultyId[] = ["easy", "medium", "hard"];
    for (const mode of modes) {
      for (const difficulty of difficulties) {
        const state = playing(mode);
        state.difficulty = difficulty;
        state.phase = "building";
        expect(() => s.draw(state)).not.toThrow();
      }
    }
  });

  it("draws every tower at every level, tripped and running", () => {
    const s = surface();
    const state = playing();
    let col = 2;
    for (const type of TOWER_TYPES) {
      for (const level of [1, 2, 3] as const) {
        const tower = addTower(state, type, col, 2, 0);
        tower.level = level;
        tower.heat = level * 25;
        tower.tripped = level === 3;
        tower.tripTimer = level === 3 ? 2 : 0;
        col += 5;
      }
    }
    expect(() => s.draw(state)).not.toThrow();
  });

  it("draws every surge type, slowed and at part health", () => {
    const s = surface();
    const state = playing();
    for (const type of SURGE_TYPES) {
      const unit = addUnit(state, type, "left");
      unit.hp = unit.maxHp * 0.4;
      unit.slowFactor = 0.5;
      unit.slowTimer = 1;
    }
    expect(() => s.draw(state)).not.toThrow();
  });

  it("draws a shot in flight, with and without splash", () => {
    const s = surface();
    const state = playing();
    state.shots.push(
      {
        x1: 100,
        y1: 100,
        x2: 300,
        y2: 300,
        splash: 0,
        life: 0.05,
        color: "#8ff",
      },
      {
        x1: 300,
        y1: 100,
        x2: 500,
        y2: 300,
        splash: 40,
        life: 0.02,
        color: "#fa0",
      },
    );
    expect(() => s.draw(state)).not.toThrow();
  });

  it("draws a held preview, on a valid footprint and on an invalid one", () => {
    const s = surface();
    const state = playing();
    for (const type of TOWER_TYPES) {
      arm(state, type);
      movePreviewTo(state, 400, 300);
      expect(() => s.draw(state)).not.toThrow();
      // Straight onto a tower already standing: the same preview, refused.
      addTower(state, "arc", 40, 30, 0);
      movePreviewTo(state, ...tileCentre(40, 30));
      expect(() => s.draw(state)).not.toThrow();
    }
  });

  it("draws an open inspector for every tower, and a hovered shop entry", () => {
    const s = surface();
    for (const type of TOWER_TYPES) {
      const state = playing();
      const tower = addTower(state, type, 10, 10, 1);
      tower.heat = 60;
      tower.kills = 4;
      tower.damageDealt = 812.5;
      state.selected = tower.id;
      expect(() => s.draw(state)).not.toThrow();

      state.selected = null;
      state.hoverShop = type;
      expect(() => s.draw(state)).not.toThrow();
    }
  });

  it("draws a tower at every rotation, so its radiator faces turn", () => {
    const s = surface();
    for (const rotation of [0, 1, 2, 3] as const) {
      const state = playing();
      addTower(state, "rime", 10, 10, rotation);
      expect(() => s.draw(state)).not.toThrow();
    }
  });
});

describe("the coming wave", () => {
  it("names the wave's own type off The Hundred, and reads mixed on it", () => {
    const state = playing();
    expect(previewTypeLabel(state, "hulk")).toBe("HULK");
    state.mode = "hundred";
    expect(previewTypeLabel(state, "hulk")).toBe("MIXED");
  });
});

describe("where the picture goes", () => {
  it("keeps play inside the reactor and the panel inside its strip", () => {
    const s = surface();
    const state = playing();
    s.draw(state);
    const reactor = s.pixel(PANEL_X - 4, STAGE_H / 2);
    const panel = s.pixel(PANEL_X + 4, STAGE_H / 2);
    expect(panel).not.toEqual(reactor);
    // Both sides are painted: neither region is left as bare canvas.
    expect(reactor[3]).toBe(255);
    expect(panel[3]).toBe(255);
  });

  it("paints a tower's footprint where the floor puts it", () => {
    const s = surface();
    const state = playing();
    s.draw(state);
    const before = s.pixel(...tileCentre(24, 17));

    addTower(state, "lance", 23, 16, 0);
    s.draw(state);
    const after = s.pixel(...tileCentre(24, 17));
    expect(after).not.toEqual(before);
  });

  it("draws no tower outside its own footprint", () => {
    const s = surface();
    const state = playing();
    s.draw(state);
    const bare = s.pixel(...tileCentre(4, 30));

    addTower(state, "arc", 24, 17, 0);
    s.draw(state);
    expect(s.pixel(...tileCentre(4, 30))).toEqual(bare);
  });

  it("rings a tower's range only while it is the selected one", () => {
    const s = surface();
    const state = playing();
    const tower = addTower(state, "lance", 23, 16, 0);
    const at = centreOf(tower);
    // A point on the range ring itself: the Lance reaches 12 tiles.
    const onRing: [number, number] = [
      Math.round(at.x + 12 * 19),
      Math.round(at.y),
    ];
    s.draw(state);
    const unselected = s.pixel(...onRing);

    state.selected = tower.id;
    s.draw(state);
    expect(s.pixel(...onRing)).not.toEqual(unselected);
  });

  it("draws the same picture twice from the same state", () => {
    const a = surface();
    const b = surface();
    const state = playing();
    addTower(state, "bloom", 20, 20, 2);
    addUnit(state, "drift", "top");
    a.draw(state);
    b.draw(state);
    for (const [x, y] of [
      [100, 100],
      [493, 360],
      [PANEL_X + 60, 200],
      [640, 690],
    ] as const) {
      expect(a.pixel(x, y)).toEqual(b.pixel(x, y));
    }
  });

  it("changes nothing it draws", () => {
    const s = surface();
    const state = playing();
    addTower(state, "stutter", 12, 12, 0);
    addUnit(state, "sprint", "left");
    const before = JSON.stringify(state);
    s.draw(state);
    s.draw(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

/** The stage centre of a tile, which is where a floor read is taken. */
function tileCentre(c: number, r: number): [number, number] {
  return [18 + 19 * c + 9, 18 + 19 * r + 9];
}
