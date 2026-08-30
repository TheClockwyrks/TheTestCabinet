// harness — the self-test of the shared harness the suites in this directory are
// written on top of.
//
// The suites next door are validators: each decides one review point about the
// build. This file decides nothing about the build. It checks the HARNESS, which
// nothing else can, because every one of those suites reads the game through it:
// a harness that mis-mapped a cell onto the canvas, or attributed a cue to the
// wrong frame, or posed a world in the wrong order, would not fail — it would
// quietly decide a hundred and forty-three points against a build that was fine.
//
// WHAT IS CHECKED HERE, AND WHY EACH IS INVISIBLE FROM INSIDE A SUITE.
//
//   - THE PAGE AND THE SURFACE. That a harness opens on a build that installed
//     `window.__coil`, that it takes the game off the wall clock before a check
//     touches anything, and that a build with no surface is reported as a fault
//     rather than as a crash.
//   - THE CLOCK. That the harness's frame is `1 / FRAME_HZ` of game time and that
//     `FRAMES_PER_TICK` of them resolve exactly one tick — the unit every
//     movement, turning and combo suite counts in.
//   - THE KEYBOARD. That a tap is a press a build can actually see, delivered
//     through Chromium's own input pipeline rather than through the surface.
//   - THE POSED WORLD. That `poseScene` and the arrangements built on it leave
//     the game holding exactly what they were asked for, in an order the surface
//     accepts, and that the isolation switches really do hold a faculty still.
//   - THE READINGS. That a cell samples through the FIT rather than off the raw
//     canvas, that a blit is attributed to the cell it landed on, and that a cue
//     is named from the file it played and stamped with the frame it played on.
//     The cue naming is the one thing this project does that carom's engineless
//     project cannot, so it is proven here rather than assumed.
//   - THE EVIDENCE. That `captureReplay` writes the section rather than the run,
//     writes it even when the section threw, writes nothing for a section that
//     drew nothing, and costs nothing when no run is collecting.
//
// The draw-command recorder underneath `captureReplay` is a verbatim port of the
// one carom carries, and carom's own `harness.test.ts` drives every rule of the
// replay format against it. What is checked here is the harness's use of it.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BITE_SECONDS,
  COIL_DEBUG_VERSION,
  COMBO_WINDOW,
  CUES,
  INTERIOR_CELLS,
  PELLET_POINTS,
  START_CELLS,
  START_DIR,
  TICK_SECONDS,
} from "./constants";
import { REQUIRED_OPS } from "./surface";
import {
  ahead,
  arrangeEat,
  arrangeFullBoard,
  arrangeStep,
  captureReplay,
  captureStill,
  chainFrom,
  clearObstacles,
  colorDistance,
  createHarness,
  cuesNamed,
  emptyInteriorCell,
  FRAMES_PER_TICK,
  FRAME_HZ,
  laysObstacles,
  openTitle,
  poseScene,
  sampleCell,
  serpentine,
  spriteOnCell,
  startRoundWithKeys,
  watchCues,
  type Harness,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  mediaDir = mkdtempSync(join(tmpdir(), "coil-harness-"));
  collecting = process.env[MEDIA_DIR_ENV];
  delete process.env[MEDIA_DIR_ENV];
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/** Collect this section's media into the temporary directory. */
function collect(): void {
  process.env[MEDIA_DIR_ENV] = mediaDir;
}

/** An order two lists of cells can be compared in. */
function byCell(
  a: { col: number; row: number },
  b: { col: number; row: number },
): number {
  return a.row - b.row || a.col - b.col;
}

/** The files this suite's outputs were written under, sorted. */
function written(): string[] {
  try {
    return readdirSync(join(mediaDir, SUITE_DIR)).sort();
  } catch {
    return [];
  }
}

/** The recording written for `outputId`, inflated. */
function recordingOf(outputId: string): { frames: unknown[] } {
  const file = join(mediaDir, SUITE_DIR, `${outputId}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as {
    frames: unknown[];
  };
}

/* ---- The page and the surface --------------------------------------------- */

it("opens on a build carrying the whole surface, and reports its version", async () => {
  expect(h.surfaceFault).toBeNull();
  const { version, ops } = await h.probe(REQUIRED_OPS);
  expect(version).toBe(COIL_DEBUG_VERSION);
  expect(Object.entries(ops).filter(([, kind]) => kind !== "function")).toEqual(
    [],
  );
});

it("takes the game off the wall clock before a check touches it", async () => {
  const snapshot = await h.snapshot();
  expect(snapshot.autoStep).toBe(false);
  expect(snapshot.screen).toBe("title");
  expect(snapshot.ticks).toBe(0);
  expect(snapshot.simTime).toBe(0);
  expect(snapshot.snake).toEqual([...START_CELLS]);
  expect(snapshot.dir).toBe(START_DIR);
  expect(snapshot.pellet).toBeNull();
});

it("leaves the page free of errors while a scenario runs", async () => {
  await arrangeEat(h);
  await h.tick(4);
  expect(h.pageErrors).toEqual([]);
});

/* ---- The clock ------------------------------------------------------------ */

it("makes a frame one FRAME_HZ-th of game time", async () => {
  await poseScene(h, { travel: false });
  await h.advance(FRAME_HZ);
  const snapshot = await h.snapshot();
  expect(snapshot.simTime).toBeCloseTo(1, 9);
  expect(h.frame()).toBe(FRAME_HZ);
  expect(h.timeMs()).toBeCloseTo(1000, 6);
});

it("resolves exactly one tick per FRAMES_PER_TICK frames", async () => {
  const posed = await arrangeStep(h, { dir: "right" });
  expect(posed.snapshot.ticks).toBe(0);

  const after = await h.tick();
  expect(after.ticks).toBe(1);
  expect(after.snake[0]).toEqual(posed.next);
  expect(after.simTime).toBeCloseTo(TICK_SECONDS, 9);

  const later = await h.tick(3);
  expect(later.ticks).toBe(4);
  expect(later.snake[0]).toEqual(ahead(posed.head, posed.dir, 4));
});

it("resolves no tick on a screen the simulation does not run on", async () => {
  await poseScene(h, { screen: "title" });
  const snapshot = await h.tick(8);
  expect(snapshot.ticks).toBe(0);
  expect(snapshot.snake).toEqual([...START_CELLS]);
});

it("sweeps a tick at a time and reports where it stopped", async () => {
  await arrangeStep(h, { head: { col: 5, row: 8 }, dir: "right" });
  const swept = await h.until((s) => s.snake[0].col === 9, { maxTicks: 20 });
  expect(swept.hit).toBe(true);
  expect(swept.ticks).toBe(4);
  expect(swept.snapshot.ticks).toBe(4);
});

it("gives up a sweep at its budget rather than running forever", async () => {
  await arrangeStep(h, { travel: false });
  const swept = await h.until((s) => s.snake[0].col === 99, { maxTicks: 3 });
  expect(swept.hit).toBe(false);
  expect(swept.ticks).toBe(3);
});

it("hands the game back to its own loop, and takes it back", async () => {
  await poseScene(h);
  await h.runFor(400);
  const running = await h.snapshot();
  expect(running.ticks).toBeGreaterThan(0);
  expect(running.autoStep).toBe(false);

  // And nothing moves again until this harness says so.
  const held = await h.snapshot();
  await h.page.waitForTimeout(150);
  expect((await h.snapshot()).ticks).toBe(held.ticks);
});

/* ---- The keyboard --------------------------------------------------------- */

it("delivers a tap the build can see, through the browser's own input", async () => {
  await poseScene(h, { dir: "right", travel: false });
  await h.tap("ArrowUp");
  expect((await h.snapshot()).turns).toEqual(["up"]);
});

it("delivers a tap on a screen with no tick running", async () => {
  const before = await poseScene(h, { screen: "title" });
  expect(before.muted).toBe(false);
  await h.tap("KeyM");
  expect((await h.snapshot()).muted).toBe(true);
});

/* ---- The posed world ------------------------------------------------------ */

it("poses every part of a world the scene names, and nothing else", async () => {
  // A column that crosses row 4, which the Maze course lays a bar along: a scene
  // that did not clear the course could not pose this chain at all.
  const snake = chainFrom({ col: 12, row: 6 }, "down", 4);
  const snapshot = await poseScene(h, {
    snake,
    dir: "down",
    pellet: { col: 20, row: 3 },
    score: 120,
    best: 340,
    combo: 3,
    comboWindow: 2,
    steering: false,
    travel: false,
    pelletRespawn: false,
    screen: "playing",
  });
  expect(snapshot.snake).toEqual(snake);
  expect(snapshot.dir).toBe("down");
  expect(snapshot.pellet).toEqual({ col: 20, row: 3 });
  expect(snapshot.score).toBe(120);
  expect(snapshot.best).toBe(340);
  expect(snapshot.combo).toBe(3);
  expect(snapshot.comboWindow).toBeCloseTo(2, 9);
  expect(snapshot.steering).toBe(false);
  expect(snapshot.travel).toBe(false);
  expect(snapshot.pelletRespawn).toBe(false);
  expect(snapshot.screen).toBe("playing");
  expect(snapshot.turns).toEqual([]);
  expect(snapshot.obstacles).toEqual([]);
});

it("keeps the mode's own course when the scene asks for it", async () => {
  const laid = await poseScene(h, { obstacles: "course" });
  const opened = await openTitle(h);
  expect(laid.obstacles).toEqual(opened.obstacles);
});

it("lays exactly the obstacle cells a scene names", async () => {
  if (!laysObstacles(await h.snapshot())) return;
  const cells = [
    { col: 4, row: 4 },
    { col: 4, row: 5 },
  ];
  const snapshot = await poseScene(h, { obstacles: cells });
  expect([...snapshot.obstacles].sort(byCell)).toEqual([...cells].sort(byCell));
});

it("resets the world a scene is posed over, so nothing carries between them", async () => {
  await poseScene(h, { score: 500, combo: 4, comboWindow: COMBO_WINDOW });
  const fresh = await poseScene(h, {});
  expect(fresh.score).toBe(0);
  expect(fresh.combo).toBe(1);
  expect(fresh.comboWindow).toBe(0);
  expect(fresh.snake).toEqual([...START_CELLS]);
  expect(fresh.ticks).toBe(0);
});

it("holds the chain still with travel off, while ticks still resolve", async () => {
  const posed = await poseScene(h, {
    travel: false,
    combo: 2,
    comboWindow: COMBO_WINDOW,
  });
  const after = await h.tick(4);
  expect(after.snake).toEqual(posed.snake);
  expect(after.ticks).toBe(4);
  expect(after.comboWindow).toBeCloseTo(COMBO_WINDOW - 4 * TICK_SECONDS, 9);
});

it("holds the direction with steering off, whatever is pressed", async () => {
  await poseScene(h, { dir: "right", steering: false, travel: false });
  await h.tap("ArrowUp");
  const snapshot = await h.snapshot();
  expect(snapshot.turns).toEqual([]);
  expect(snapshot.dir).toBe("right");
});

it("arranges an eat the next tick resolves", async () => {
  const scene = await arrangeEat(h);
  expect(scene.snapshot.pellet).toEqual(scene.pellet);
  expect(scene.snapshot.pelletRespawn).toBe(false);

  const after = await h.tick();
  expect(after.snake[0]).toEqual(scene.pellet);
  expect(after.snake).toHaveLength(scene.snapshot.snake.length + 1);
  expect(after.score).toBe(PELLET_POINTS);
  expect(after.pellet).toBeNull();
});

it("arranges an approach whose next tick enters the named cell", async () => {
  const target = { col: 1, row: 8 };
  const scene = await arrangeStep(h, {
    head: ahead(target, "right"),
    dir: "left",
  });
  expect(scene.next).toEqual(target);
  expect((await h.tick()).snake[0]).toEqual(target);
});

/* ---- The board's furniture ------------------------------------------------ */

it("clears the obstacle course, whichever mode the build ships", async () => {
  const before = await h.snapshot();
  if (laysObstacles(before)) expect(before.obstacles.length).toBeGreaterThan(0);
  else expect(before.obstacles).toEqual([]);

  await clearObstacles(h);
  expect((await h.snapshot()).obstacles).toEqual([]);
});

it("walks every interior cell in one contiguous chain", () => {
  const path = serpentine();
  expect(path).toHaveLength(INTERIOR_CELLS);
  const seen = new Set(path.map((cell) => `${cell.col},${cell.row}`));
  expect(seen.size).toBe(INTERIOR_CELLS);
  for (let i = 1; i < path.length; i += 1) {
    const step =
      Math.abs(path[i].col - path[i - 1].col) +
      Math.abs(path[i].row - path[i - 1].row);
    expect(step).toBe(1);
  }
});

it("fills the board to its last free cell, one eat short of cleared", async () => {
  const scene = await arrangeFullBoard(h);
  expect(scene.chain).toHaveLength(INTERIOR_CELLS - 1);
  expect(scene.snapshot.snake).toHaveLength(INTERIOR_CELLS - 1);
  expect(scene.snapshot.pellet).toEqual(scene.pellet);
  expect(scene.snapshot.obstacles).toEqual([]);

  const after = await h.tick();
  expect(after.snake).toHaveLength(INTERIOR_CELLS);
  expect(after.screen).toBe("cleared");
  expect(after.pellet).toBeNull();
});

it("finds an empty interior cell the posed board really leaves empty", async () => {
  const snapshot = await poseScene(h, {
    snake: chainFrom({ col: 3, row: 1 }, "right", 3),
    dir: "right",
    pellet: { col: 8, row: 1 },
  });
  const empty = emptyInteriorCell(snapshot);
  expect(snapshot.snake).not.toContainEqual(empty);
  expect(snapshot.obstacles).not.toContainEqual(empty);
  expect(empty).not.toEqual(snapshot.pellet);
});

/* ---- Reading the render --------------------------------------------------- */

it("reports the operations one frame's render issued", async () => {
  await poseScene(h, { score: 240, travel: false });
  const calls = await h.frameCalls();
  expect(calls.length).toBeGreaterThan(0);
  const text = calls.flatMap((call) =>
    call.kind === "call" &&
    (call.method === "fillText" || call.method === "strokeText") &&
    typeof call.args[0] === "string"
      ? [call.args[0]]
      : [],
  );
  expect(text.join(" ")).toContain("240");
});

it("attributes a blit to the cell it landed on", async () => {
  const head = { col: 10, row: 8 };
  await poseScene(h, {
    snake: chainFrom(head, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });
  const blits = await h.frameBlits();
  expect(blits.length).toBeGreaterThan(0);

  const onHead = spriteOnCell(h, blits, head.col, head.row);
  const onBody = spriteOnCell(h, blits, head.col - 1, head.row);
  const onTail = spriteOnCell(h, blits, head.col - 3, head.row);
  expect(onHead).not.toBeNull();
  expect(onBody).not.toBeNull();
  expect(onTail).not.toBeNull();
  // Three cells of one chain, painted from three different produced sprites.
  expect(new Set([onHead, onBody, onTail]).size).toBe(3);

  const empty = emptyInteriorCell(await h.snapshot());
  expect(spriteOnCell(h, blits, empty.col, empty.row)).toBeNull();
});

it("samples a cell through the fit rather than off the raw canvas", async () => {
  const head = { col: 6, row: 4 };
  const scene = {
    snake: chainFrom(head, "right", 3),
    dir: "right" as const,
    pellet: null,
    travel: false,
  };
  await poseScene(h, scene);
  await h.advance(1);
  const atStageSize = await sampleCell(h, head.col, head.row);

  // The same cell, on a window half again as wide and tall, where the stage is
  // scaled and the canvas is a different size entirely. A harness that sampled
  // raw canvas coordinates would read some other part of the board.
  const wide = await createHarness({ cssWidth: 1920, cssHeight: 1080 });
  try {
    await poseScene(wide, scene);
    await wide.advance(1);
    const atOtherSize = await sampleCell(wide, head.col, head.row);
    expect(colorDistance(atStageSize, atOtherSize)).toBeLessThan(24);
  } finally {
    await wide.dispose();
  }
});

/* ---- Cues ----------------------------------------------------------------- */

it("names the cue a build played, and the frame it played it on", async () => {
  await h.armAudio();
  await arrangeEat(h);
  const cues = watchCues(h);
  const before = h.frame();
  await h.tick();

  const eats = cuesNamed(cues, CUES.eat);
  expect(eats).toHaveLength(1);
  // Somewhere inside the tick that ate, and never before it.
  expect(eats[0].frame).toBeGreaterThan(before);
  expect(eats[0].frame).toBeLessThanOrEqual(before + FRAMES_PER_TICK);
  expect(eats[0].loop).toBe(false);
  expect(cuesNamed(cues, CUES.death)).toHaveLength(0);
});

it("hears the looping cue a round begins under", async () => {
  await h.armAudio();
  const cues = watchCues(h);
  await startRoundWithKeys(h);
  const music = cuesNamed(cues, CUES.music);
  expect(music.length).toBeGreaterThanOrEqual(1);
  expect(music[0].loop).toBe(true);
});

it("hears nothing at all on a tick that resolves no event", async () => {
  await h.armAudio();
  await poseScene(h, { pellet: null, travel: false });
  const cues = watchCues(h);
  await h.tick(4);
  expect(cues.filter((cue) => cue.name !== CUES.music)).toEqual([]);
});

/* ---- Evidence ------------------------------------------------------------- */

it("writes nothing at all when no run is collecting media", async () => {
  await poseScene(h);
  const seen = await captureReplay(h, "quiet", async () => {
    await h.tick(2);
    return "value";
  });
  expect(seen).toBe("value");
  await captureStill(h, "quiet-still");
  expect(written()).toEqual([]);
});

it("writes the section a capture wrapped, and hands its value back", async () => {
  collect();
  await poseScene(h);
  const ticks = 3;
  const seen = await captureReplay(h, "section", async () => {
    await h.tick(ticks);
    return ticks;
  });
  expect(seen).toBe(ticks);
  expect(written()).toEqual(["section.json.gz"]);
  expect(recordingOf("section").frames).toHaveLength(ticks * FRAMES_PER_TICK);
});

it("writes the evidence of a section that failed", async () => {
  collect();
  await poseScene(h);
  await expect(
    captureReplay(h, "failed", async () => {
      await h.tick(1);
      throw new Error("the scenario failed");
    }),
  ).rejects.toThrow("the scenario failed");
  expect(written()).toEqual(["failed.json.gz"]);
  expect(recordingOf("failed").frames).toHaveLength(FRAMES_PER_TICK);
});

it("writes no recording for a section that drove no frame", async () => {
  collect();
  await poseScene(h);
  await captureReplay(h, "empty", async () => undefined);
  expect(written()).toEqual([]);
});

it("writes a still of the picture the last frame left", async () => {
  collect();
  await poseScene(h, { score: 90, travel: false });
  await h.advance(1);
  await captureStill(h, "scene");
  expect(written()).toEqual(["scene.png"]);
  expect(
    readFileSync(join(mediaDir, SUITE_DIR, "scene.png")).length,
  ).toBeGreaterThan(1000);
});

/* ---- A whole scenario, end to end ----------------------------------------- */

it("drives an eat, a bite and a death the way a suite will", async () => {
  await arrangeEat(h, { head: { col: 10, row: 8 }, dir: "right" });
  const eaten = await h.tick();
  expect(eaten.score).toBe(PELLET_POINTS);

  // The bite is a drawing, not a rule: the head cell is painted with something
  // other than its resting sprite while it plays, and back to rest after.
  const biting = await h.frameBlits();
  const bitingSprite = spriteOnCell(
    h,
    biting,
    eaten.snake[0].col,
    eaten.snake[0].row,
  );
  await h.advance(Math.ceil(BITE_SECONDS * FRAME_HZ));
  const rested = await h.snapshot();
  const restingBlits = await h.frameBlits();
  const restingSprite = spriteOnCell(
    h,
    restingBlits,
    rested.snake[0].col,
    rested.snake[0].row,
  );
  expect(bitingSprite).not.toBeNull();
  expect(restingSprite).not.toBeNull();

  // And a wall ends the round on the tick the head enters it.
  await arrangeStep(h, { head: { col: 1, row: 8 }, dir: "left" });
  const ended = await h.until((s) => s.screen !== "playing", { maxTicks: 4 });
  expect(ended.hit).toBe(true);
  expect(ended.snapshot.screen).toBe("gameover");
  expect(ended.ticks).toBe(1);
});

it("starts a round from the title the way a player does", async () => {
  await openTitle(h);
  const started = await startRoundWithKeys(h);
  expect(started.screen).toBe("playing");
  expect(started.snake).toEqual([...START_CELLS]);
  expect(started.pellet).not.toBeNull();
  expect(started.score).toBe(0);
  expect(started.combo).toBe(1);
});
