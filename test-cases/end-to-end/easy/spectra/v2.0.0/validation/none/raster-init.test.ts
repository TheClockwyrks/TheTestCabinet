// raster-init — self-checks for the frame clear injected into the page.
//
// This file decides nothing about the build. It proves the two properties
// `raster-init.js` is only worth having if it has, both of which are invisible
// from inside a validator and wrong in ways nothing else catches:
//
//   1. IT NEVER CHANGES A PIXEL. Every scene below is drawn twice in the same
//      browser, once in a page the script was injected into and once in a page it
//      was not, and the two are compared as the encoded bytes of a screenshot —
//      the same call `captureStill` makes. A script that cleared a fill which did
//      not really cover the canvas would erase part of the picture every check
//      reads and every still a reviewer looks at.
//   2. IT ACTUALLY MAKES THE CANVAS FORGET. A run of filtered draws over an
//      opaque background costs what one frame costs rather than what every frame
//      ever drawn costs. That is the whole point, and it is a property of the
//      browser rather than of this code, so it is measured.
//
// It is the browser counterpart of the `simple-2d` and `structured-2d` projects'
// `covered-frames.test.ts`, and it carries scenes those two do not: the browser
// implementation deliberately has no save-depth guard, because Chromium truncates
// its recorded history for a clear issued under an open `save` and
// `@napi-rs/canvas` does not. The scene both tables carry under that name, and
// the ones under "the browser's own cases", are what hold that difference to the
// measurement it rests on.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project:
//
//   npx vitest run --config validation/vitest.config.ts
//
// It reaches the browser `globalSetup.ts` started, but not the build: every page
// it opens is a blank document with a canvas of its own, so nothing here depends
// on what a run produced.

import { afterAll, beforeAll, expect, inject, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";

/** The stage the scenes are drawn on, big enough for the filter to cost. */
const W = 640;
const H = 360;

/** How many frames a comparison scene is run for. */
const FRAMES = 24;

/**
 * How many frames the cost is measured over.
 *
 * The scene it is measured on draws twenty sprites a frame, which is the order a
 * live wave draws at, and the bill a canvas defers grows with the frames it has
 * taken as well as with the draws in each.
 */
const COST_FRAMES = 100;

/** This module's directory, which is where `raster-init.js` sits beside it. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The document every scene is drawn into: one canvas, flush with the viewport. */
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0"></body>`;

/** What a scene is handed, so that no scene closes over a module binding. */
interface World {
  /** The backing store's width. */
  readonly w: number;
  /** The backing store's height. */
  readonly h: number;
  /** Draw `count` tinted sprites, as a frame of the game would. */
  sprites(ctx: CanvasRenderingContext2D, frame: number, count: number): void;
}

/** One way a frame can open, drawn once per frame of a run. */
type Scene = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  world: World,
) => void;

/**
 * Run `scene` for `frames` frames on a canvas of its own.
 *
 * Serialized to source and evaluated in the page, so it must close over nothing:
 * every value it uses arrives as an argument or is built here. A canvas of its
 * own per scene is what keeps one scene's clip, save stack and recorded history
 * out of the next one's.
 */
function driveInPage(scene: Scene, frames: number, w: number, h: number): void {
  const previous = document.querySelector("canvas");
  if (previous !== null) previous.remove();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("spectra: the canvas has no 2D context");

  // A small sprite with a transparent corner, so alpha is in play.
  const art = document.createElement("canvas");
  art.width = 32;
  art.height = 32;
  const paint = art.getContext("2d");
  if (paint === null) throw new Error("spectra: the sprite has no 2D context");
  paint.fillStyle = "#7c4a8d";
  paint.fillRect(0, 0, 32, 32);
  paint.fillStyle = "#ffffff";
  paint.fillRect(8, 8, 16, 16);
  paint.clearRect(0, 0, 6, 6);

  // A tint chain of the kind a build colours a seeded sprite with.
  const tint =
    "grayscale(1) brightness(1.100) sepia(1) hue-rotate(290deg) saturate(7)";

  const world: World = {
    w,
    h,
    sprites: (target, frame, count) => {
      target.imageSmoothingEnabled = false;
      for (let i = 0; i < count; i += 1) {
        target.filter = tint;
        target.drawImage(
          art,
          (i * 53 + frame) % (w - 32),
          (frame * 7 + i * 31) % (h - 32),
          21,
          21,
        );
        target.filter = "none";
      }
    },
  };

  for (let frame = 0; frame < frames; frame += 1) scene(ctx, frame, world);
}

/**
 * Every way a frame can open, including the ones the script must leave alone.
 *
 * A scene the script is expected to clear and a scene it is expected to refuse
 * are proved the same way, because the property being proved is the same one: the
 * picture is what the build drew.
 *
 * The first eighteen are the `covered-frames.test.ts` table, scene for scene, so
 * that one rule is held to one set of cases on all three engines. The eighteenth
 * is where the two implementations part: the node wrapper refuses to clear under
 * an open `save` and this script clears anyway, and both tables prove the frame
 * comes out the same either way.
 */
const scenes: Record<string, Scene> = {
  "an opaque background fill": (ctx, frame, world) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 6);
  },
  "an opaque fill under a scaled transform": (ctx, frame, world) => {
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    world.sprites(ctx, frame, 6);
  },
  "a fill that covers all but a strip": (ctx, frame, world) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w - 24, world.h);
    world.sprites(ctx, frame, 6);
  },
  "a translucent fade over the frame before": (ctx, frame, world) => {
    ctx.fillStyle = "rgba(5, 7, 15, 0.25)";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 3);
  },
  "a gradient background": (ctx, frame, world) => {
    const wash = ctx.createLinearGradient(0, 0, 0, world.h);
    wash.addColorStop(0, "#05070f");
    wash.addColorStop(1, "#101830");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 3);
  },
  "a background fill under a reduced alpha": (ctx, frame, world) => {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.globalAlpha = 1;
    world.sprites(ctx, frame, 3);
  },
  "a background fill under a filter": (ctx, frame, world) => {
    ctx.filter = "opacity(0.3)";
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.filter = "none";
    world.sprites(ctx, frame, 3);
  },
  "a background fill under a blending operator": (ctx, frame, world) => {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#8890a0";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.globalCompositeOperation = "source-over";
    world.sprites(ctx, frame, 3);
  },
  "a background fill inside a clip": (ctx, frame, world) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(40, 40, 300, 200);
    ctx.clip();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.restore();
    world.sprites(ctx, frame, 3);
  },
  "a clip left in force at the base of the stack": (ctx, frame, world) => {
    if (frame === 0) {
      ctx.beginPath();
      ctx.rect(0, 0, world.w - 60, world.h - 40);
      ctx.clip();
    }
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 3);
  },
  "a clip taken and given back before the fill": (ctx, frame, world) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 120, 120);
    ctx.clip();
    ctx.restore();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 6);
  },
  "a named colour background": (ctx, frame, world) => {
    ctx.fillStyle = "midnightblue";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 6);
  },
  "a background colour with an alpha channel": (ctx, frame, world) => {
    ctx.fillStyle = "#05070f80";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 3);
  },
  "a frame that clears nothing at all": (ctx, frame, world) => {
    world.sprites(ctx, frame, 2);
  },
  "a frame opened with a clear": (ctx, frame, world) => {
    ctx.clearRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 6);
  },
  "a restore with nothing under it": (ctx, frame, world) => {
    ctx.restore();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 6);
  },
  "a background fill under an open save": (ctx, frame, world) => {
    ctx.save();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 6);
    ctx.restore();
  },
  "text and paths drawn through the tint": (ctx, frame, world) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.filter =
      "grayscale(1) brightness(1.100) sepia(1) hue-rotate(290deg) saturate(7)";
    ctx.fillStyle = "#ffffff";
    ctx.font = "24px sans-serif";
    ctx.fillText(`wave ${String(frame)}`, 24, 40);
    ctx.beginPath();
    ctx.arc(200, 200, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = "none";
    world.sprites(ctx, frame, 3);
  },

  // ---- The browser's own cases ---------------------------------------------

  "a clip opened and then dropped by a reset": (ctx, frame, world) => {
    ctx.beginPath();
    ctx.rect(0, 0, 100, 100);
    ctx.clip();
    ctx.reset();
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 6);
  },
  "a background fill under the copy operator": (ctx, frame, world) => {
    ctx.globalCompositeOperation = "copy";
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.globalCompositeOperation = "source-over";
    world.sprites(ctx, frame, 6);
  },
  "a background fill given as a negative rectangle": (ctx, frame, world) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(world.w, world.h, -world.w, -world.h);
    world.sprites(ctx, frame, 6);
  },
  "a background fill under a half-turn": (ctx, frame, world) => {
    ctx.setTransform(-1, 0, 0, -1, world.w, world.h);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    world.sprites(ctx, frame, 6);
  },
  "a background fill under a rotation": (ctx, frame, world) => {
    ctx.save();
    ctx.translate(world.w / 2, world.h / 2);
    ctx.rotate(Math.PI / 6);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(-world.w, -world.h, world.w * 2, world.h * 2);
    ctx.restore();
    world.sprites(ctx, frame, 6);
  },
  "a background fill casting a shadow": (ctx, frame, world) => {
    ctx.shadowColor = "#ff0000";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    world.sprites(ctx, frame, 6);
  },
  "a canvas resized after a clip was taken": (ctx, frame, world) => {
    if (frame === 0) {
      ctx.beginPath();
      ctx.rect(0, 0, 80, 80);
      ctx.clip();
      ctx.canvas.width = world.w - 40;
      ctx.canvas.height = world.h - 20;
    }
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    world.sprites(ctx, frame, 6);
  },
  "the frame the cost is measured on": (ctx, frame, world) => {
    ctx.fillStyle = "#05070f";
    ctx.fillRect(0, 0, world.w, world.h);
    world.sprites(ctx, frame, 20);
  },
};

/* ---- Driving the two pages ------------------------------------------------ */

let browser: Browser;
let withScript: Page;
let withoutScript: Page;
let blank: Buffer;
const contexts: BrowserContext[] = [];

/** Open a page of the shape every scene is drawn in. */
async function openPage(injected: boolean): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });
  contexts.push(context);
  if (injected) {
    await context.addInitScript(
      readFileSync(join(PROJECT_ROOT, "raster-init.js"), "utf8"),
    );
  }
  const page = await context.newPage();
  await page.setContent(PAGE);
  return page;
}

/** Whether this page's `fillRect` is the browser's own or a wrapper over it. */
async function patched(page: Page): Promise<boolean> {
  return !(await page.evaluate(() =>
    String(CanvasRenderingContext2D.prototype.fillRect).includes(
      "[native code]",
    ),
  ));
}

/**
 * Draw `scene` in `page`, screenshot it, and answer the picture and what the two
 * together cost.
 *
 * The two are timed as ONE figure because the browser decides between them where
 * the deferred bill lands: a canvas the compositor has already rasterised pays
 * during the drive, and one it has not pays at the screenshot. What a validator
 * waits for is the sum, and the sum is what the clear is worth having for.
 */
async function draw(
  page: Page,
  scene: Scene,
  frames: number,
): Promise<{ png: Buffer; costMs: number }> {
  const source = `(${driveInPage.toString()})(${scene.toString()}, ${String(
    frames,
  )}, ${String(W)}, ${String(H)})`;
  const started = performance.now();
  await page.evaluate(source);
  const png = await page.screenshot({ type: "png" });
  return { png, costMs: performance.now() - started };
}

beforeAll(async () => {
  browser = await connectChromium(inject("spectraBrowserWs"));
  withScript = await openPage(true);
  withoutScript = await openPage(false);
  // What a page with a canvas and nothing drawn on it screenshots to, so a scene
  // that quietly stopped drawing is caught rather than compared equal for the
  // wrong reason.
  blank = (await draw(withoutScript, () => undefined, 0)).png;
});

afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => undefined);
  contexts.length = 0;
  await browser?.close().catch(() => undefined);
});

it("is installed in one page and absent from the other", async () => {
  expect(await patched(withScript)).toBe(true);
  expect(await patched(withoutScript)).toBe(false);
});

for (const [name, scene] of Object.entries(scenes)) {
  it(`leaves the same picture for ${name}`, async () => {
    const plain = await draw(withoutScript, scene, FRAMES);
    const injected = await draw(withScript, scene, FRAMES);
    // A scene serialized into the page is exactly the kind of thing that can
    // quietly stop running, and two blank canvases compare equal.
    expect(plain.png.equals(blank)).toBe(false);
    expect(injected.png.equals(plain.png)).toBe(true);
  });
}

it("costs one frame to screenshot rather than every frame ever drawn", async () => {
  const scene = scenes["the frame the cost is measured on"];
  const plain = await draw(withoutScript, scene, COST_FRAMES);
  const injected = await draw(withScript, scene, COST_FRAMES);

  expect(injected.png.equals(plain.png)).toBe(true);
  // Measured here at 5.6 s against 0.13 s, a ratio of forty; the bar is an
  // eighth of that, so the check reports a script that stopped working rather
  // than a machine that was busy.
  expect(plain.costMs).toBeGreaterThan(injected.costMs * 5);
});
