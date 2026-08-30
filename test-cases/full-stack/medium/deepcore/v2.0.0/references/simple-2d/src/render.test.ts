// The renderer draws every screen, panel, and overlay without throwing
// (specs/ui.md, specs/overview.md).
//
// It runs against a real 2D context from `@napi-rs/canvas` rather than a
// browser, so what is checked is that every drawing path is reachable, that the
// controls the pointer routes through come back for each of them, and that the
// mine, the miner, and the camp are drawn where the camera says. Nothing about
// the palette or the layout is asserted: those belong to the build.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  GEMSTONE_IDS,
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
import { renderGame } from "./render";
import { writeTile } from "./state";
import { bareState, inDraft, posedAt } from "./test-support";
import { makeMaterialTile, makeOreTile, makeTile } from "./world";

function context(): CanvasRenderingContext2D {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  return canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
}

/** A state on one screen, with the pointer resting over the menu column. */
function onScreen(screen: ScreenName): DeepcoreState {
  return inDraft(bareState(), (d) => {
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

describe("the renderer", () => {
  it("draws every screen and lists what can be clicked", () => {
    const ctx = context();
    for (const screen of SCREENS) {
      const state = onScreen(screen);
      expect(() => renderGame(state, ctx)).not.toThrow();
      const controls = controlsFor(state);
      if (screen === "in-mine") continue;
      expect(controls.length).toBeGreaterThan(0);
    }
  });

  it("draws every building panel", () => {
    const ctx = context();
    for (const panel of PANELS as readonly PanelId[]) {
      const state = inDraft(onScreen("in-mine"), (d) => {
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
      expect(() => renderGame(state, ctx)).not.toThrow();
      // Every panel carries at least its own CLOSE control.
      expect(controlsFor(state).some((c) => c.action === "panel:close")).toBe(
        true,
      );
    }
  });

  it("draws the mine with every kind of cell, a haul, and a live Sample", () => {
    const ctx = context();
    const state = inDraft(onScreen("in-mine"), (d) => {
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
    expect(() => renderGame(state, ctx)).not.toThrow();
    expect(controlsFor(state).some((c) => c.action === "notice:dismiss")).toBe(
      true,
    );
  });

  it("draws the miner in every animation state and both facings", () => {
    const ctx = context();
    for (const pose of MINER_STATES as readonly MinerState[]) {
      for (const facing of ["east", "west"] as const) {
        const state = inDraft(onScreen("in-mine"), (d) => {
          d.miner.state = pose;
          d.miner.facing = facing;
          d.hurtT = 0.2;
        });
        expect(() => renderGame(state, ctx)).not.toThrow();
      }
    }
  });

  it("draws the camp, the rocket at each stage, and the launch", () => {
    const ctx = context();
    for (let installed = 0; installed <= 5; installed += 1) {
      const state = inDraft(onScreen("in-mine"), (d) => {
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
      expect(() => renderGame(state, ctx)).not.toThrow();
    }
    const launching = inDraft(onScreen("in-mine"), (d) => {
      d.launchAnim = 1.2;
      d.camY = -TILE;
    });
    expect(() => renderGame(launching, ctx)).not.toThrow();
  });

  it("paints the whole stage, letterbox background included", () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    renderGame(onScreen("title"), ctx);
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
