import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { createStateOps } from "./debug";
import { installSprites, NO_SPRITES, type Sprites } from "./images";
import { render } from "./render";
import { Session } from "./session";

/** A real 2D context at the stage's logical size, from `@napi-rs/canvas`. */
function stage(): {
  ctx: CanvasRenderingContext2D;
  painted: () => number;
} {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    painted: () => {
      const data = ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
      let lit = 0;
      // The sky is the darkest thing on the stage, so anything appreciably
      // brighter than it is something the frame drew.
      for (let at = 0; at < data.length; at += 4) {
        if (data[at] + data[at + 1] + data[at + 2] > 120) lit += 1;
      }
      return lit;
    },
  };
}

/**
 * A sprite store that answers every path with one small painted canvas, so the
 * draw path that uses the produced sprites is exercised where the produced
 * files themselves cannot be decoded — a test runs in Node, which has no
 * `Image`.
 */
function stubSprites(): Sprites {
  const tile = createCanvas(48, 48);
  const ctx = tile.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(4, 4, 40, 40);
  return { get: () => tile as unknown as CanvasImageSource };
}

describe("the frame (specs/ui.md)", () => {
  it("draws the title screen", () => {
    const { ctx, painted } = stage();
    render(ctx, new Session().state);
    expect(painted()).toBeGreaterThan(1000);
  });

  it("draws every how-to page", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.setScreen("howto");
    for (let page = 0; page < 5; page += 1) {
      const { ctx, painted } = stage();
      api.setHowtoPage(page);
      render(ctx, game.state);
      expect(painted()).toBeGreaterThan(1000);
    }
  });

  it("draws both select screens", () => {
    for (const mode of ["campaign", "extras"] as const) {
      const game = new Session();
      const api = createStateOps(game);
      api.setMode(mode);
      api.setScreen("select");
      const { ctx, painted } = stage();
      render(ctx, game.state);
      expect(painted()).toBeGreaterThan(1000);
    }
  });

  it("draws the editor over a challenge, its machine, and its run", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placeRise(0, -2, 0, 0);
    api.placeSet(0, 2, 0, 0);
    api.placePart("arm", 0, 0, 3);
    const arm = game.state.editor.parts[2].id;
    api.setTapeCell(arm, 0, "grab");
    api.setTapeCell(arm, 1, "rotate-cw");
    api.setSelected(arm);
    const editing = stage();
    render(editing.ctx, game.state);
    expect(editing.painted()).toBeGreaterThan(5000);

    api.startRun();
    game.update(0.2);
    const running = stage();
    render(running.ctx, game.state);
    expect(running.painted()).toBeGreaterThan(5000);
  });

  it("draws the fault display over a halted run", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placePart("wheel", 0, 0, 0);
    const wheel = game.state.editor.parts[0].id;
    api.setTapeCell(wheel, 0, "grab");
    api.startRun();
    game.update(1);
    expect(game.state.sim?.status).toBe("faulted");
    const { ctx, painted } = stage();
    render(ctx, game.state);
    expect(painted()).toBeGreaterThan(1000);
  });

  it("draws the solved panel over a completed run", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.update(1);
    expect(game.state.sim?.status).toBe("complete");
    const { ctx, painted } = stage();
    render(ctx, game.state);
    expect(painted()).toBeGreaterThan(1000);
  });

  it("draws every produced sprite the field and the tape panel call for", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("campaign", 10);
    api.placeRise(0, -4, 2, 0);
    api.placeSet(0, 3, 0, 0);
    api.placePart("wheel", -2, -1, 0);
    api.placePart("triune", 1, 2, 0);
    api.placePart("manifold", -1, -3, 0);
    api.placePart("arm", 0, 0, 0);
    const arm = game.state.editor.parts[5].id;
    ["grab", "rotate-cw", "pivot-cw", "drop", "advance", "extend"].forEach(
      (instruction, col) => {
        api.setTapeCell(arm, col, instruction as "grab");
      },
    );
    api.setCursor(arm, 3);
    api.startRun();
    api.spawnMote(0, 2, "nova");
    api.spawnMote(1, 2, "nova");
    const motes = game.state.sim?.motes ?? [];
    api.linkMotes(motes[motes.length - 2].id, motes[motes.length - 1].id, 3);
    game.update(0.05);

    const plain = stage();
    render(plain.ctx, game.state);
    const painted = stage();
    installSprites(stubSprites());
    render(painted.ctx, game.state);
    installSprites(NO_SPRITES);
    // Every sprite is a bright tile, so a frame drawn with them is far
    // brighter than the same frame drawn on its code-drawn fallbacks alone.
    expect(painted.painted()).toBeGreaterThan(plain.painted());
  });

  it("scrolls the tape panel to the cursor's row", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    for (let index = 0; index < 7; index += 1) {
      api.placePart("arm", index - 3, 0, 0);
    }
    const last = game.state.editor.parts[6].id;
    api.setCursor(last, 60);
    const { ctx, painted } = stage();
    render(ctx, game.state);
    expect(painted()).toBeGreaterThan(1000);
  });

  it("draws a repeating product's chain and a collision's marked motes", () => {
    const game = new Session();
    const api = createStateOps(game);
    // Extras 10 is the one challenge whose product repeats, so its set draws
    // the pattern and the copy one repeat vector along.
    api.openChallenge("extras", 9);
    api.placeSet(0, -1, 0, 0);
    api.placePart("arm", 0, 2, 0);
    const arm = game.state.editor.parts[1].id;
    api.setTapeCell(arm, 0, "rotate-cw");
    api.startRun();
    api.clearMotes();
    api.spawnMote(1, 2, "luna");
    api.setGrip(arm, 0, game.state.sim?.motes[0].id ?? 0);
    api.spawnMote(1, 3, "luna");
    game.update(1);
    expect(game.state.sim?.fault?.kind).toBe("collision");
    const { ctx, painted } = stage();
    render(ctx, game.state);
    expect(painted()).toBeGreaterThan(1000);
  });

  it("draws a move drag's ghost as the release would leave the part", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.placePart("arm", 0, 0, 0);
    api.pointerDown(616, 304);
    api.pointerMove(616 + 48, 304);
    expect(game.state.editor.drag?.kind).toBe("move");
    const { ctx, painted } = stage();
    render(ctx, game.state);
    expect(painted()).toBeGreaterThan(1000);
    api.pointerUp();
  });

  it("draws a live drag's ghost", () => {
    const game = new Session();
    const api = createStateOps(game);
    api.openChallenge("extras", 0);
    api.pointerDown(20, 60);
    api.pointerMove(616, 304);
    expect(game.state.editor.drag).not.toBeNull();
    const { ctx, painted } = stage();
    render(ctx, game.state);
    expect(painted()).toBeGreaterThan(1000);
    api.pointerUp();
  });
});
