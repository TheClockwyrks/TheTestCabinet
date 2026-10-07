// presentation/pixel-art-sampled-nearest — every sprite is blitted with image
// smoothing off.
//
// THE REQUIREMENT. `specs/assets.md` — "The sprites": "Every sprite is pixel art
// drawn at one unit per pixel ... and the game draws it with image smoothing off
// so it stays crisp at the stage's fit." A canvas smooths by default, so a build
// that never turns it off blurs every sprite the moment the stage is fitted to
// anything but its own size.
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. The value of
// `imageSmoothingEnabled` in force at each `drawImage` the frame made. That
// property is canvas state rather than an argument, so the reading walks the
// frame's operations carrying it: the value the context held when the frame
// opened, then every assignment the frame made, with `save` and `restore`
// pushing and popping it as the canvas does. A build that sets it once at
// start-up and one that sets it inside every frame both read as off, which is
// right — the specification fixes the effect, not where the line lives.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with a moth and a gem placed
// on it, so the frame blits produced sprites of three different sizes and the
// reading is not taken over a frame that drew nothing. The gem stands `200` units
// out, beyond `pickupRadius` (`48` with no Lure held), so it is not attracted
// away before the frame is read.
//
// WHY A SEPARATE FRAME IS READ FIRST. The value in force when a frame opens is
// the value the frame before it left, so it is read off the context between the
// two, and the frame under the reading is the one driven after that. There is no
// tolerance: smoothing is on or off at each blit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  type DrawCall,
  type Harness,
} from "../harness";

/** Whether the canvas the build draws the game on is smoothing right now. */
async function smoothingNow(h: Harness): Promise<boolean> {
  return (await h.page.evaluate(() => {
    let best: HTMLCanvasElement | null = null;
    for (const canvas of Array.from(document.querySelectorAll("canvas"))) {
      if (!canvas.isConnected) continue;
      const area = canvas.width * canvas.height;
      if (best === null || area > best.width * best.height) best = canvas;
    }
    if (best === null) return true;
    const ctx = best.getContext("2d");
    return ctx === null ? true : ctx.imageSmoothingEnabled;
  })) as boolean;
}

/** The value in force at each `drawImage` of the frame, in draw order. */
function smoothingAtBlits(
  calls: readonly DrawCall[],
  opening: boolean,
): boolean[] {
  const stack: boolean[] = [];
  let smoothing = opening;
  const seen: boolean[] = [];
  for (const call of calls) {
    if (call.kind === "set" && call.property === "imageSmoothingEnabled") {
      smoothing = call.value !== false;
      continue;
    }
    if (call.kind !== "call") continue;
    if (call.method === "save") {
      stack.push(smoothing);
    } else if (call.method === "restore") {
      smoothing = stack.pop() ?? smoothing;
    } else if (call.method === "reset") {
      smoothing = true;
    } else if (call.method === "drawImage") {
      seen.push(smoothing);
    }
  }
  return seen;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("blits every sprite with image smoothing disabled", async () => {
  const posed = await isolate(h);
  const at = posed.run.player;
  await h.debug.spawnEnemy("moth", at.x + 200, at.y - 100);
  await h.debug.spawnGem("large", at.x - 200, at.y + 100);
  await h.step(1);

  const opening = await smoothingNow(h);
  await h.step(1);
  const blits = smoothingAtBlits(await h.lastCalls(), opening);
  await captureStill(h, "crisp");

  assertGreaterThan(
    blits.length,
    0,
    "produced sprites blitted onto the frame at all, so there is something " +
      "for the smoothing rule to hold over (specs/assets.md)",
  );
  assertEqual(
    blits.filter((on) => on).length,
    0,
    `the blits of the frame's ${blits.length} sprite draws made with image ` +
      "smoothing still enabled, which is none of them (specs/assets.md)",
  );
});
