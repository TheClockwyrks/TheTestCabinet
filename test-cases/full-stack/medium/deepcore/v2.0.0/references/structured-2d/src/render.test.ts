// The drawing covers every screen, panel, and overlay without throwing
// (specs/ui.md, specs/overview.md).
//
// It runs against a real 2D context from `@napi-rs/canvas` rather than a
// browser, so what is checked is that every drawing path is reachable, that the
// controls the pointer routes through come back for each of them, and that the
// mine, the miner, and the camp are drawn where the camera says. Nothing about
// the palette or the layout is asserted: those belong to the build.
//
// `paint` below stands in for the engine's pipeline: it composes the five layers
// `src/mine.ts` and `src/prospector.ts` attach, in the order their layer numbers
// put them, under the same world-to-logical transform the camera the game
// positioned gives them (src/camera.ts). Posing a state and painting it is what
// lets one check cover every screen, every panel, and every animation frame
// without a frame of simulation in between changing what is being drawn.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  GEMSTONE_IDS,
  HUD_H,
  MINER_STATES,
  ORE_IDS,
  PANELS,
  SCREENS,
  STAGE_H,
  STAGE_W,
  SURFACE_Y,
  TILE,
} from "./constants";
import type { MinerState, PanelId, ScreenName } from "./constants";
import { controlsFor } from "./controls";
import type { DeepcoreState } from "./game";
import { drawEffects } from "./effects";
import {
  closeView,
  openView,
  renderHud,
  renderMiner,
  renderTerrain,
  renderWorldOverlays,
  showsMine,
} from "./render";
import { BAND_FILL, PALETTE } from "./theme";
import { writeTile } from "./state";
import { bareState, posing, posedAt } from "./test-support";
import { makeMaterialTile, makeOreTile, makeTile } from "./world";

function context(): CanvasRenderingContext2D {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  return canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
}

/**
 * Draw one state's whole picture, exactly as the engine's pipeline draws it.
 *
 * The camera the game asks for puts `(camX, camY)` at the mine viewport's
 * top-left, which at a zoom of `1` is the world-to-logical translate below; the
 * HUD layer takes that translate back out and draws in logical units.
 */
function paint(state: DeepcoreState, ctx: CanvasRenderingContext2D): void {
  const corner = { x: state.camX, y: state.camY };
  ctx.setTransform(1, 0, 0, 1, -corner.x, -corner.y + HUD_H);
  if (showsMine(state)) {
    openView(ctx, state, corner);
    renderTerrain(ctx, state, corner);
    closeView(ctx);
    openView(ctx, state, corner);
    renderMiner(ctx, state);
    closeView(ctx);
    openView(ctx, state, corner);
    drawEffects(ctx);
    closeView(ctx);
    openView(ctx, state, corner);
    renderWorldOverlays(ctx, state, corner);
    closeView(ctx);
  }
  ctx.save();
  ctx.translate(corner.x, corner.y - HUD_H);
  renderHud(ctx, state);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** A state on one screen, with the pointer resting over the menu column. */
function onScreen(screen: ScreenName): DeepcoreState {
  return posing(bareState(), (d) => {
    d.screen = screen;
    d.pointer = { x: 640, y: 360, down: false };
    d.simTime = 3.5;
    if (screen === "victory" || screen === "game-over") {
      d.summary = {
        deepestDepthMeters: 1200,
        creditsEarned: 5400,
        elapsedSeconds: 640,
        mode: "standard",
        componentsInstalled: 3,
        deathCause: screen === "game-over" ? "hull-destroyed" : null,
      };
    }
  });
}

describe("the drawing", () => {
  it("draws every screen and lists what can be clicked", () => {
    const ctx = context();
    for (const screen of SCREENS) {
      const state = onScreen(screen);
      expect(() => paint(state, ctx)).not.toThrow();
      const controls = controlsFor(state);
      if (screen === "in-mine") continue;
      expect(controls.length).toBeGreaterThan(0);
    }
  });

  it("draws every building panel", () => {
    const ctx = context();
    for (const panel of PANELS as readonly PanelId[]) {
      const state = posing(onScreen("in-mine"), (d) => {
        d.panel = panel;
        d.credits = 9000;
        d.cargo.ferron = 3;
        d.cargo.aurite = 1;
        d.items.dynamite = 2;
        d.satchel.resonite = 1;
        d.satchel.coreSample = true;
        d.coreTimer = 45;
        d.installed = ["hull-frame", "fuel-cells"];
      });
      expect(() => paint(state, ctx)).not.toThrow();
      // Every panel carries at least its own CLOSE control.
      expect(controlsFor(state).some((c) => c.action === "panel:close")).toBe(
        true,
      );
    }
  });

  it("draws the mine with every kind of cell, a haul, and a live Sample", () => {
    const ctx = context();
    const state = posing(onScreen("in-mine"), (d) => {
      posedAt(d, 8 * TILE, 200 * TILE);
      d.camX = 4 * TILE;
      d.camY = 197 * TILE;
      let row = 199;
      for (const kind of [
        "rock",
        "gas",
        "lava",
        "stone",
        "bedrock",
        "tunnel",
        "core",
      ] as const) {
        d.grid = writeTile(d.grid, 6, row, makeTile(kind, "deepstone"));
        row += 1;
      }
      for (const [index, id] of [...ORE_IDS, ...GEMSTONE_IDS].entries()) {
        d.grid = writeTile(
          d.grid,
          8 + (index % 4),
          199 + Math.floor(index / 4),
          makeOreTile("deepstone", id),
        );
      }
      d.grid = writeTile(
        d.grid,
        12,
        200,
        makeMaterialTile("deepstone", "resonite"),
      );
      // A partly cut cell, so the crack overlay is drawn.
      d.grid = writeTile(d.grid, 13, 200, {
        ...makeTile("rock", "deepstone"),
        health: 4,
      });
      d.groundItems.push({ kind: "core-sample", col: 9, row: 201 });
      d.coreTimer = 20;
      d.shakeT = 0.2;
      d.shakeAmp = 8;
      d.scan = {
        locked: true,
        target: "resonite",
        dirX: 0.6,
        dirY: 0.8,
        distanceTiles: 7,
      };
      d.notes = [{ text: "CARGO FULL — ORE LOST", t: 1 }];
      d.notice = { hazard: "lava", shown: true, t: 4 };
    });
    expect(() => paint(state, ctx)).not.toThrow();
    expect(controlsFor(state).some((c) => c.action === "notice:dismiss")).toBe(
      true,
    );
  });

  it("draws the miner in every animation state and both facings", () => {
    const ctx = context();
    for (const pose of MINER_STATES as readonly MinerState[]) {
      for (const facing of ["east", "west"] as const) {
        const state = posing(onScreen("in-mine"), (d) => {
          d.miner.state = pose;
          d.miner.facing = facing;
          d.hurtT = 0.2;
        });
        expect(() => paint(state, ctx)).not.toThrow();
      }
    }
  });

  it("draws the camp, the rocket at each stage, and the launch", () => {
    const ctx = context();
    for (let installed = 0; installed <= 5; installed += 1) {
      const state = posing(onScreen("in-mine"), (d) => {
        d.installed = [
          "hull-frame",
          "fuel-cells",
          "guidance",
          "thruster",
          "ignition",
        ].slice(0, installed) as DeepcoreState["installed"][number][];
        posedAt(d, 4 * TILE, SURFACE_Y - 72);
        d.camY = -TILE;
      });
      expect(() => paint(state, ctx)).not.toThrow();
    }
    const launching = posing(onScreen("in-mine"), (d) => {
      d.launchAnim = 1.2;
      d.camY = -TILE;
    });
    expect(() => paint(launching, ctx)).not.toThrow();
  });

  it("draws a carved cell inset, with the band's dirt keeping its corners", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    const col = 8;
    const row = 200;
    const state = posing(onScreen("in-mine"), (d) => {
      // One open cell in a solid band, with the camera on it.
      for (let r = row - 1; r <= row + 1; r += 1) {
        for (let c = col - 1; c <= col + 1; c += 1) {
          d.grid = writeTile(d.grid, c, r, makeTile("rock", "rockbed"));
        }
      }
      d.grid = writeTile(d.grid, col, row, makeTile("tunnel", "rockbed"));
      posedAt(d, col * TILE, (row - 4) * TILE);
      d.camX = (col - 6) * TILE;
      d.camY = (row - 4) * TILE;
    });
    paint(state, ctx);
    const at = (wx: number, wy: number): [number, number, number] => {
      const x = Math.round(wx - state.camX);
      const y = Math.round(wy - state.camY + HUD_H);
      const { data } = canvas.getContext("2d").getImageData(x, y, 1, 1);
      return [data[0], data[1], data[2]];
    };
    const hex = (rgb: [number, number, number]): string =>
      `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    // The middle of the cell is the carved interior.
    expect(hex(at(col * TILE + TILE / 2, row * TILE + TILE / 2))).toBe(
      PALETTE.tunnel,
    );
    // Its corners, inside the lip, are still the band's rock: a hole in solid
    // rock is inset on every side and rounded at every corner.
    expect(hex(at(col * TILE + 2, row * TILE + 2))).toBe(BAND_FILL.rockbed);
    expect(hex(at(col * TILE + TILE - 2, row * TILE + TILE - 2))).toBe(
      BAND_FILL.rockbed,
    );
  });

  it("paints the whole stage, letterbox background included", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    paint(onScreen("title"), ctx);
    const corners: [number, number][] = [
      [1, 1],
      [STAGE_W - 2, 1],
      [1, STAGE_H - 2],
      [STAGE_W - 2, STAGE_H - 2],
    ];
    for (const [x, y] of corners) {
      expect(canvas.getContext("2d").getImageData(x, y, 1, 1).data[3]).toBe(
        255,
      );
    }
  });
});
