import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { Assets } from "../assets";
import {
  ALMANAC_ROWS,
  HURT_FLASH,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { ALMANAC, almanacRowRects, almanacTabRects } from "../layout";
import { freshRun, initialState, type WickState } from "../state";
import { spawnEnemy } from "../sim/enemies";
import { render } from "./render";
import { toStage } from "./world";

type Context = CanvasRenderingContext2D;

function frame(state: WickState): Context {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d") as unknown as Context;
  render(ctx, state, new Assets());
  return ctx;
}

function pixel(ctx: Context, x: number, y: number): number[] {
  return [...ctx.getImageData(x, y, 1, 1).data];
}

/** Whether any pixel in the box differs from the same box of `other`. */
function differs(
  a: Context,
  b: Context,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const da = a.getImageData(x, y, w, h).data;
  const db = b.getImageData(x, y, w, h).data;
  return da.some((v, i) => v !== db[i]);
}

/** A rectangle as the four arguments `differs` takes. */
function rowBox(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): [number, number, number, number] {
  return [rect.x, rect.y, rect.width, rect.height];
}

function almanacState(): WickState {
  const state = initialState(1);
  state.screen = "almanac";
  return state;
}

function playingState(): WickState {
  const state = initialState(1);
  state.run = freshRun();
  state.screen = "playing";
  return state;
}

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

  it("casts the hurt over the view while the flash runs", () => {
    const state = playingState();
    const calm = frame(state);
    state.run.hurtFlash = HURT_FLASH;
    const hurt = frame(state);
    expect(differs(hurt, calm, 0, 0, 200, 200)).toBe(true);
    state.run.hurtFlash = 0;
    expect(differs(frame(state), calm, 0, 0, 200, 200)).toBe(false);
  });

  it("draws the almanac's rows from its scroll and its entry in full", () => {
    const state = almanacState();
    const rows = almanacRowRects(16);
    const list = [
      ALMANAC.listX,
      ALMANAC.listTop,
      ALMANAC.rowWidth,
      ALMANAC_ROWS * ALMANAC.rowPitch,
    ] as const;
    const pane = [
      ALMANAC.paneX,
      ALMANAC.paneY,
      ALMANAC.paneWidth,
      ALMANAC.paneHeight,
    ] as const;
    const first = frame(state);
    state.menuIndex = 1;
    const second = frame(state);
    expect(differs(first, second, ...rowBox(rows[0]))).toBe(true);
    expect(differs(first, second, ...pane)).toBe(true);
    state.menuIndex = 0;
    state.almanacScroll = 3;
    expect(differs(first, frame(state), ...list)).toBe(true);
  });

  it("draws the almanac's tab bar with the shown tab apart", () => {
    const state = almanacState();
    const tabs = almanacTabRects();
    const first = frame(state);
    state.almanacTab = 2;
    const third = frame(state);
    expect(differs(first, third, ...rowBox(tabs[0]))).toBe(true);
    expect(differs(first, third, ...rowBox(tabs[2]))).toBe(true);
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
