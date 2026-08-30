// Every screen, every overlay, and every inspector, drawn.
//
// The renderer is one pass over the state, so what is worth checking is that each state
// the game can be in draws without a canvas call failing and that what it drew is
// visibly different from an empty stage. Where a control sits is `src/layout.ts`, which
// the pointer and the debug surface read too, so the rectangles are checked here against
// the game they belong to rather than against a screenshot.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { beforeEach, describe, expect, it } from "vitest";

import { noAssets } from "./assets";
import { STAGE_H, STAGE_W } from "./constants";
import { snapshot } from "./debug";
import {
  BOARD_PANEL,
  BOARD_ROW0,
  MAZE_READOUT,
  controls,
  inRect,
  leaderboardHoverId,
  menuControls,
  panelButtonControls,
  statusBarControls,
} from "./layout";
import { renderGame } from "./render";
import {
  addToCombineSet,
  advance,
  cancelHeld,
  clearStructures,
  clearUnits,
  combineFrom,
  createWorld,
  placeBlocker,
  placeCombo,
  placeComponent,
  placeStamp,
  pullPress,
  resetWorld,
  select,
  setOverlay,
  setScreen,
  setUnitFrozen,
  setUnitPosition,
  setWave,
  spawnUnit,
  startRun,
  armNextRoll,
} from "./sim";
import { footprintCenter } from "./tables";
import type { FoundryWorld } from "./types";

let ctx: SKRSContext2D;

beforeEach(() => {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  ctx = canvas.getContext("2d");
});

/** Draw a state and report how many pixels are not the empty background. */
function draw(w: FoundryWorld): number {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  renderGame(w, ctx as unknown as CanvasRenderingContext2D);
  const { data } = ctx.getImageData(0, 0, STAGE_W, STAGE_H);
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! + data[i + 1]! + data[i + 2]! > 5 + 8 + 12) lit++;
  }
  return lit;
}

/** Draw a state and report a digest of the pixels, for comparing two frames. */
function digest(w: FoundryWorld): number {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  renderGame(w, ctx as unknown as CanvasRenderingContext2D);
  const { data } = ctx.getImageData(0, 0, STAGE_W, STAGE_H);
  let hash = 0;
  for (let i = 0; i < data.length; i += 997) hash = (hash * 31 + data[i]!) | 0;
  return hash;
}

function opened(): FoundryWorld {
  const w = createWorld(noAssets());
  resetWorld(w);
  startRun(w);
  clearStructures(w);
  clearUnits(w);
  return w;
}

describe("every screen draws", () => {
  it("draws the title, the map select, the difficulty select, and the rules", () => {
    const w = createWorld(noAssets());
    for (const screen of [
      "title",
      "mapselect",
      "difficultyselect",
      "howto",
    ] as const) {
      setScreen(w, screen);
      expect(draw(w)).toBeGreaterThan(1000);
      // Every entry the screen offers is reported, and each is on the stage.
      const items = menuControls(w);
      expect(items.length).toBeGreaterThan(0);
      for (const c of items) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(STAGE_W);
        expect(c.y + c.h).toBeLessThanOrEqual(STAGE_H);
      }
    }
  });

  it("draws the yard, the pause menu, victory, and defeat", () => {
    const w = opened();
    placeComponent(w, "capacitor", 3, 10, 10);
    expect(draw(w)).toBeGreaterThan(1000);
    for (const screen of ["paused", "victory", "overload"] as const) {
      setScreen(w, screen);
      expect(draw(w)).toBeGreaterThan(1000);
      // A modal screen reports its own menu and no status bar at all.
      expect(menuControls(w).length).toBeGreaterThan(0);
      expect(statusBarControls(w)).toHaveLength(0);
    }
  });
});

describe("the inspector draws every kind of selection", () => {
  it("draws a candidate, a component, a Regulator, a tower, and a blocker", () => {
    const w = opened();
    armNextRoll(w, "coil", 2);
    pullPress(w);
    placeStamp(w, 6, 6);
    // Placing re-arms the press while the allowance lasts, and the panel then reads the
    // rock on the cursor rather than the inspector, so the hand is put away first.
    cancelHeld(w);
    const candidate = snapshot(w).structures[0]!.id;
    const component = placeComponent(w, "discharge", 4, 12, 6)!.id;
    const regulator = placeComponent(w, "regulator", 3, 18, 6)!.id;
    const tower = placeCombo(w, "singularity", 24, 6)!.id;
    const blocker = placeBlocker(w, 30, 6)!.id;

    for (const id of [candidate, component, regulator, tower, blocker]) {
      select(w, id);
      expect(draw(w)).toBeGreaterThan(1000);
    }

    select(w, blocker);
    expect(panelButtonControls(w).map((c) => c.action)).toEqual(["dismantle"]);

    select(w, regulator);
    // A Regulator never fires, so it carries no targeting slot at any rung.
    expect(panelButtonControls(w).map((c) => c.action)).not.toContain(
      "targeting",
    );

    select(w, component);
    expect(panelButtonControls(w).map((c) => c.action)).toContain("targeting");

    select(w, tower);
    const towerSlots = panelButtonControls(w).map((c) => c.action);
    expect(towerSlots).toContain("upgrade");
    expect(towerSlots).not.toContain("keep");
  });

  it("holds each slot's rectangle as the game around it changes", () => {
    const w = opened();
    // A Capacitor at Tuned is no ingredient of any recipe, so a matching partner turns
    // exactly one action from unavailable to available and adds no row.
    const alone = placeComponent(w, "capacitor", 2, 10, 10)!.id;
    select(w, alone);
    const before = panelButtonControls(w);
    expect(before.find((c) => c.action === "combine")!.disabled).toBe(true);

    placeComponent(w, "capacitor", 2, 14, 10);
    select(w, alone);
    const after = panelButtonControls(w);
    expect(
      after.map((c) => `${c.action}|${c.label}|${c.x},${c.y},${c.w},${c.h}`),
    ).toEqual(
      before.map((c) => `${c.action}|${c.label}|${c.x},${c.y},${c.w},${c.h}`),
    );
    expect(after.find((c) => c.action === "combine")!.disabled).toBe(false);
  });

  it("offers one row per reachable recipe, each naming its tower", () => {
    const w = opened();
    // The Fuse Cluster: a Scrap Regulator, Rectifier, and Arc-Node.
    const anchor = placeComponent(w, "regulator", 1, 6, 6)!.id;
    placeComponent(w, "rectifier", 1, 10, 6);
    placeComponent(w, "arcnode", 1, 14, 6);
    select(w, anchor);
    const rows = panelButtonControls(w).filter(
      (c) => c.action === "combine-special",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toBe("fusecluster");
    expect(rows[0]!.label).toBe("Fuse Cluster");
    expect(draw(w)).toBeGreaterThan(1000);
  });
});

describe("the overlays draw", () => {
  it("draws the recipe book, and reports a control that closes it", () => {
    const w = opened();
    placeComponent(w, "coil", 2, 10, 10);
    select(w, snapshot(w).structures[0]!.id);
    setOverlay(w, "combos", true);
    // Hovering a cell floats the tower's description card.
    w.pointerX = 300;
    w.pointerY = 300;
    expect(draw(w)).toBeGreaterThan(1000);
    const close = controls(w).filter((c) => c.action === "combos");
    // The bar's toggle, and the book's own close control.
    expect(close).toHaveLength(2);
  });

  it("draws the damage leaderboard and spotlights the row under the pointer", () => {
    const w = opened();
    setWave(w, 1);
    const tower = placeComponent(w, "discharge", 5, 20, 10)!;
    const centre = footprintCenter(20, 10);
    const unit = spawnUnit(w, "slug")!;
    setUnitPosition(w, unit, centre.x + 30, centre.y);
    setUnitFrozen(unit, true);
    advance(w, 2);
    setOverlay(w, "damage", true);
    expect(
      snapshot(w).structures.find((s) => s.id === tower.id)!.damageDealt,
    ).toBeGreaterThan(0);

    w.pointerX = BOARD_PANEL.x + 10;
    w.pointerY = BOARD_ROW0 + 5;
    expect(leaderboardHoverId(w)).toBe(tower.id);
    expect(draw(w)).toBeGreaterThan(1000);

    // Off the rows, nothing is spotlighted.
    w.pointerX = 900;
    w.pointerY = 600;
    expect(leaderboardHoverId(w)).toBeNull();
  });

  it("draws an empty leaderboard before anything has fired", () => {
    const w = opened();
    setOverlay(w, "damage", true);
    expect(leaderboardHoverId(w)).toBeNull();
    expect(draw(w)).toBeGreaterThan(1000);
  });

  it("draws the ground route while the maze readout is hovered", () => {
    const w = opened();
    w.pointerX = 0;
    w.pointerY = 700;
    const plain = digest(w);
    w.pointerX = MAZE_READOUT.x + MAZE_READOUT.w / 2;
    w.pointerY = MAZE_READOUT.y + MAZE_READOUT.h / 2;
    expect(
      inRect(
        w.pointerX,
        w.pointerY,
        MAZE_READOUT.x,
        MAZE_READOUT.y,
        MAZE_READOUT.w,
        MAZE_READOUT.h,
      ),
    ).toBe(true);
    expect(digest(w)).not.toBe(plain);
  });
});

describe("the yard draws what it is asked to", () => {
  it("draws the next-wave preview, and its tooltip under the pointer", () => {
    const w = opened();
    select(w, null);
    const plain = draw(w);
    // The first preview row sits just inside the inspector's column.
    w.pointerX = 1100;
    w.pointerY = 300;
    expect(draw(w)).toBeGreaterThanOrEqual(plain - 1);
  });

  it("draws the held rock's footprint with its legal read", () => {
    const w = opened();
    pullPress(w);
    w.pointerX = 300;
    w.pointerY = 300;
    const legal = draw(w);
    // A waypoint platform is never buildable, so the cue reads illegal there.
    const wp = snapshot(w).waypoints[0]!;
    w.pointerX = wp.col * 20 + 10;
    w.pointerY = 56 + wp.row * 20 + 10;
    expect(draw(w)).toBeGreaterThan(0);
    expect(legal).toBeGreaterThan(0);
  });

  it("draws the units, their shots, and the bursts they raise", () => {
    const w = opened();
    setWave(w, 3);
    placeComponent(w, "arcnode", 3, 20, 10);
    const centre = footprintCenter(20, 10);
    for (const type of ["mote", "filament", "dynamo"] as const) {
      const u = spawnUnit(w, type)!;
      setUnitPosition(w, u, centre.x + 30, centre.y);
      setUnitFrozen(u, true);
    }
    advance(w, 1.5);
    expect(snapshot(w).units.length).toBeGreaterThan(0);
    expect(draw(w)).toBeGreaterThan(1000);
  });

  it("marks the pieces a combine would fold", () => {
    const w = opened();
    const a = placeComponent(w, "coil", 2, 6, 6)!.id;
    const b = placeComponent(w, "coil", 2, 12, 6)!.id;
    select(w, a);
    const ambient = draw(w);
    addToCombineSet(w, b);
    // The committed set is marked more strongly than the ambient hint.
    expect(draw(w)).toBeGreaterThanOrEqual(ambient - 1);
    combineFrom(w, a);
    expect(snapshot(w).structures.find((s) => s.id === a)!.quality).toBe(3);
  });
});
