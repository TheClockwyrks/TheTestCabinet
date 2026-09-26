import { createCanvas } from "@napi-rs/canvas";
import { beforeEach, describe, expect, it } from "vitest";
import { clearSprites } from "../assets";
import {
  ALMANAC_TABS,
  HURT_FLASH,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  WALK_FRAME_TIME,
} from "../constants";
import { entriesOf } from "../almanac";
import { menuRects, tabRects } from "../menus";
import { COLORS } from "./theme";
import { freshRun, initialState, type Draft } from "../state";
import { spawnEnemy } from "../sim/enemies";
import { renderGame } from "./render";
import { toStage } from "./world";

type Context = CanvasRenderingContext2D;

function frame(state: Draft): Context {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d") as unknown as Context;
  renderGame(ctx, state);
  return ctx;
}

function pixel(ctx: Context, x: number, y: number): number[] {
  return [...ctx.getImageData(x, y, 1, 1).data];
}

function playingState(): Draft {
  const state = initialState();
  state.run = freshRun();
  state.screen = "playing";
  return state;
}

beforeEach(() => {
  clearSprites();
});

describe("rendering", () => {
  it("draws every screen without a produced asset", () => {
    const state = playingState();
    const { run } = state;
    spawnEnemy(run, "moth", 100, 50);
    spawnEnemy(run, "owl", -200, 0);
    spawnEnemy(run, "dark", 0, 200);
    run.gems.push({
      id: 10,
      tier: "small",
      x: 40,
      y: 40,
      attracted: false,
      bornTick: 0,
    });
    run.pickups.push(
      { id: 11, kind: "chest", x: -40, y: 40 },
      { id: 12, kind: "bread", x: -80, y: 40 },
      { id: 13, kind: "draft", x: -120, y: 40 },
    );
    run.projectiles.push({
      id: 14,
      weapon: "ember",
      x: 60,
      y: -60,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      radius: 8,
      damage: 10,
      ttl: 1,
      pierce: 0,
      hits: [],
      bornTick: 0,
    });
    run.zones.push(
      {
        id: 15,
        weapon: "taper",
        kind: "slash",
        x: 60,
        y: 0,
        radius: 0,
        width: 120,
        height: 40,
        damage: 10,
        ttl: 0.1,
        hits: [],
        bornTick: 0,
      },
      {
        id: 16,
        weapon: "halo",
        kind: "aura",
        x: 0,
        y: 0,
        radius: 80,
        damage: 3,
        ttl: null,
        hits: [],
        bornTick: 0,
      },
    );
    run.puffs.push({ x: 30, y: -30, bornTick: 0 });
    run.weapons.push({ id: "halo", level: 3, cooldown: 0.5, cooldownSet: 1 });
    run.passives.push({ id: "lure", level: 2 });
    run.moving = true;
    run.player.facing = "left";
    for (const screen of [
      "title",
      "howto",
      "almanac",
      "playing",
      "levelup",
      "chest",
      "paused",
      "fallen",
      "dawn",
    ] as const) {
      state.screen = screen;
      if (screen === "levelup") run.offers = ["ember", "lure", "lamp-oil"];
      if (screen === "chest")
        run.chestResult = { kind: "evolve", weapon: "pyre" };
      expect(() => frame(state)).not.toThrow();
    }
    run.chestResult = { kind: "level", item: "lure", level: 3 };
    expect(() => frame(state)).not.toThrow();
    run.chestResult = { kind: "heal" };
    expect(() => frame(state)).not.toThrow();
    run.chestResult = null;
    expect(() => frame(state)).not.toThrow();
  });

  it("draws every tab of the almanac and every entry of one", () => {
    const state = initialState();
    state.screen = "almanac";
    for (let tab = 0; tab < ALMANAC_TABS.length; tab += 1) {
      state.almanacTab = tab;
      state.almanacScroll = 0;
      for (let i = 0; i < entriesOf(tab).length; i += 1) {
        state.menuIndex = i;
        state.almanacScroll = Math.max(0, i - 9);
        expect(() => frame(state)).not.toThrow();
      }
    }
  });

  it("draws each menu's highlight over the rectangle the pointer answers", () => {
    const state = playingState();
    state.run.offers = ["ember", "lure", "lamp-oil"];
    const highlight = [255, 207, 92, 255];
    expect(COLORS.highlight).toBe("#ffcf5c");
    for (const screen of [
      "title",
      "almanac",
      "levelup",
      "paused",
      "fallen",
    ] as const) {
      state.screen = screen;
      state.menuIndex = 0;
      const rects = menuRects(state);
      expect(rects.length).toBeGreaterThan(1);
      rects.forEach((_, index) => {
        state.menuIndex = index;
        const ctx = frame(state);
        rects.forEach((rect, i) => {
          const drawn = pixel(ctx, rect.x + 3, rect.y + 3);
          if (i === index) expect(drawn).toEqual(highlight);
          else expect(drawn).not.toEqual(highlight);
        });
      });
    }
  });

  it("draws the almanac's tab bar over the rectangles it reports", () => {
    const state = initialState();
    state.screen = "almanac";
    const rects = tabRects(state);
    rects.forEach((_, index) => {
      state.almanacTab = index;
      const ctx = frame(state);
      rects.forEach((rect, i) => {
        const drawn = pixel(ctx, rect.x + 4, rect.y + 4);
        if (i === index) expect(drawn).toEqual([255, 207, 92, 255]);
        else expect(drawn).not.toEqual([255, 207, 92, 255]);
      });
    });
  });

  it("names what the highlighted level-up offer does, and follows the highlight", () => {
    const state = playingState();
    state.screen = "levelup";
    state.run.offers = ["ember", "lure", "lamp-oil"];
    const lines = menuRects(state);
    const below = lines[lines.length - 1];
    const box = [below.x, below.y + below.height, below.width, 60] as const;
    const first = frame(state).getImageData(...box).data;
    state.menuIndex = 1;
    const second = frame(state).getImageData(...box).data;
    expect([...second]).not.toEqual([...first]);
  });

  it("casts the hurt flash over the view while it runs", () => {
    const state = playingState();
    const quiet = frame(state);
    state.run.hurtFlash = HURT_FLASH;
    const hurt = frame(state);
    expect(pixel(hurt, 8, 8)).not.toEqual(pixel(quiet, 8, 8));
    state.run.hurtFlash = 0;
    expect(pixel(frame(state), 8, 8)).toEqual(pixel(quiet, 8, 8));
  });

  it("holds the almanac's picture still until simTime moves on", () => {
    const state = initialState();
    state.screen = "almanac";
    state.almanacTab = 2;
    const box = [512, 260, 672, 180] as const;
    const first = frame(state).getImageData(...box).data;
    state.simTime = WALK_FRAME_TIME / 4;
    expect([...frame(state).getImageData(...box).data]).toEqual([...first]);
  });

  it("puts a world point where the camera formula says", () => {
    const state = playingState();
    state.run.player.x = 123;
    state.run.player.y = -45;
    expect(toStage(state.run, 123, -45)).toEqual([STAGE_CX, STAGE_CY]);
    expect(toStage(state.run, 223, 5)).toEqual([STAGE_CX + 100, STAGE_CY + 50]);
  });

  it("scrolls the ground under a moving lamplighter", () => {
    const state = playingState();
    const before = pixel(frame(state), 12, 12);
    state.run.player.x = 64;
    expect(pixel(frame(state), 12, 12)).toEqual(before);
    state.run.player.x = 32;
    expect(pixel(frame(state), 12, 12)).not.toEqual(before);
  });

  it("draws the lamplighter at the stage center on both facings", () => {
    const state = playingState();
    const right = pixel(frame(state), STAGE_CX, STAGE_CY);
    expect(right[3]).toBe(255);
    const lampOnRight = pixel(frame(state), STAGE_CX + 16, STAGE_CY - 6);
    state.run.player.facing = "left";
    const lampOnLeft = pixel(frame(state), STAGE_CX - 16, STAGE_CY - 6);
    expect(lampOnLeft).toEqual(lampOnRight);
  });

  it("fills the health bar in proportion to hp", () => {
    const state = playingState();
    const full = frame(state);
    state.run.player.hp = 25;
    const quarter = frame(state);
    expect(pixel(full, 24 + 200, 24 + 9)).not.toEqual(
      pixel(quarter, 24 + 200, 24 + 9),
    );
    expect(pixel(full, 24 + 50, 24 + 9)).toEqual(
      pixel(quarter, 24 + 50, 24 + 9),
    );
  });
});
