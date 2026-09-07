// A CAPTURE ARMED BEFORE ANY FRAME HAS CLOSED, which is most of them.
//
// `recorder-surface.spec.ts` says which surface a recording binds to. This file
// says WHEN that question can be answered, because for a long time the rule
// assumed an answer existed at `arm()` and for about half of one measured run's
// recordings it did not.
//
// The rule follows a pass-through blit, and the blit it reads is the one the last
// CLOSED frame was left making. The old rule was pinned at `arm()` regardless, on
// the stated ground that "frames run between the arming gesture and the opening
// reset, long before any check reaches a capture". Nothing on that path brackets a
// recorder frame: the recorder is in "manual" mode from installation so the
// build's own animation frames close nothing, and the surface probe, the
// `setAutoStep`, the arming gesture's settle step and the opening `reset` all go
// through the debug surface. A check that poses its scene with debug calls alone —
// `openScene`, `layFloor`, `standOn`, then `captureReplay` — therefore armed with
// no evidence whatever, bound to the visible canvas, and recorded its whole
// section as the pass-through: five operations a frame, and a full-viewport PNG of
// every one of them. Which checks hopped came down to whether the check happened
// to drive a frame first.
//
// THE SHAPE DRIVEN HERE IS A PRODUCED BUILD'S, transcribed from the `src/main.ts`
// of the run that motivated the change: an attached canvas sized from the viewport
// by a `fit()`, an unattached design-sized stage the renderer paints, and a blit of
// the stage over the whole of the visible canvas each frame. THE SEQUENCE DRIVEN
// IS A MOVEMENT CHECK'S: arm cold, then frames — where each frame is exactly what
// `drive()` in `harness.ts` emits, `rec.begin(); step; rec.end(dt)`.
//
// DRIVEN ENTIRELY INSIDE ONE `page.evaluate`, for the same reason the sibling
// suites are: no animation frame can interrupt a synchronous evaluation, so what
// each frame contains — and how many have closed — is stated by the scenario alone
// rather than by whatever the page did while Playwright was crossing.

import { afterEach, expect, it } from "vitest";
import type { RecordedOp } from "../src/index";

import { createHarness, type Harness } from "./fixture";

/** The produced build's design field, and the viewport its checks run at. */
const DESIGN = { width: 1280, height: 720 } as const;

/** What one recording of the build turned out to be. */
interface Recorded {
  /** Every operation the kept frames issued, in order. */
  ops: RecordedOp[];
  /** What `frameCalls()` reads: the last closed frame, off the primary surface. */
  lastOps: RecordedOp[];
  frames: number;
  images: number;
}

/** The same build recorded twice: armed cold, then armed with a frame behind it. */
interface Pair {
  cold: Recorded;
  warm: Recorded;
  /** The visible canvas's backing store, and the blit's destination rectangle. */
  fit: {
    canvasWidth: number;
    canvasHeight: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
  };
}

const open: Harness[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.dispose()));
});

async function fresh(): Promise<Harness> {
  const h = await createHarness();
  open.push(h);
  return h;
}

/** The calls among a list of operations, with the assignments dropped. */
function calls(ops: RecordedOp[]): { method: string; args: unknown[] }[] {
  return ops.flatMap((op) => (op.op === "call" ? [op] : []));
}

/** Which surface's marker the frames drew: the stage's, or the visible one's. */
function texts(ops: RecordedOp[]): string[] {
  return calls(ops)
    .filter((op) => op.method === "fillText")
    .map((op) => String(op.args[0]));
}

/** Whether any operation blitted anything — the pass-through's signature. */
function blitted(ops: RecordedOp[]): boolean {
  return calls(ops).some((op) => op.method === "drawImage");
}

/**
 * Record the produced build twice on one page: cold, then warmed.
 *
 * `cssWidth`/`cssHeight` are the viewport the visible canvas is sized from, so a
 * caller can ask what a window that is NOT the design aspect does to the same
 * drive. Both recordings run in one evaluation against the same canvases and the
 * same renderer, so the only thing that differs between them is how many frames
 * had closed when `arm` was called — which is the variable this file is about.
 */
function driveBuild(
  h: Harness,
  options: { cssWidth?: number; cssHeight?: number; frames?: number } = {},
): Promise<Pair> {
  return h.page.evaluate(
    (spec) => {
      const rec = (
        window as unknown as {
          __tcabRec: {
            arm(design: {
              width: number;
              height: number;
              background: string;
            }): boolean;
            begin(): void;
            end(deltaMs: number): void;
            last(): unknown[];
            disarm(): {
              images: unknown[];
              ops: unknown[];
              frames: { ops: number[] }[];
            } | null;
          };
        }
      ).__tcabRec;

      // ---- The produced build, transcribed from its `src/main.ts` ------------
      //
      // The fixture page's own canvas is smaller than either of these, so the
      // recorder's search starts on the visible one below. Out of the flow, so the
      // page it is added to lays out exactly as it did.

      const canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.left = "-99999px";
      document.body.appendChild(canvas);
      const context = canvas.getContext("2d");

      // NEVER attached — the surface the whole rule is about.
      const stage = document.createElement("canvas");
      stage.width = spec.design.width;
      stage.height = spec.design.height;
      const scene = stage.getContext("2d");
      if (context === null || scene === null) throw new Error("no 2d context");

      let scale = 1;
      let offsetX = 0;
      let offsetY = 0;
      const fit = () => {
        const width = spec.cssWidth;
        const height = spec.cssHeight;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        scale = Math.min(
          canvas.width / spec.design.width,
          canvas.height / spec.design.height,
        );
        offsetX = (canvas.width - spec.design.width * scale) / 2;
        offsetY = (canvas.height - spec.design.height * scale) / 2;
      };
      fit();

      /** The renderer, which paints the offscreen stage — and only it. */
      let beat = 0;
      const render = () => {
        beat += 1;
        scene.setTransform(1, 0, 0, 1, 0, 0);
        scene.fillStyle = "#101820";
        scene.fillRect(0, 0, spec.design.width, spec.design.height);
        scene.fillStyle = "#ffcc00";
        scene.font = "12px sans-serif";
        scene.fillText("stage", 10 + (beat % 3), 20);
        scene.fillRect(4, 30, 12, 12);
      };

      /** `draw(dt)`: render the stage, then blit it over the visible canvas. */
      const draw = () => {
        render();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = "#0c1821";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(
          stage,
          offsetX,
          offsetY,
          spec.design.width * scale,
          spec.design.height * scale,
        );
      };

      /** What `drive()` in `harness.ts` emits per frame, exactly. */
      const frames = (count: number) => {
        for (let at = 0; at < count; at += 1) {
          rec.begin();
          draw();
          rec.end(16);
        }
      };

      const take = (): Recorded => {
        const lastOps = rec.last();
        const recording = rec.disarm();
        if (recording === null) throw new Error("no recording");
        return {
          // Resolved in the page: a recording's image table is megabytes of
          // base64 and nothing here reads it, only how many entries it holds.
          ops: recording.frames.flatMap((held) =>
            held.ops.map((at) => recording.ops[at]),
          ) as RecordedOp[],
          lastOps: lastOps as RecordedOp[],
          frames: recording.frames.length,
          images: recording.images.length,
        };
      };

      // COLD. The scene is posed through the debug surface, which drives no frame,
      // and the capture is armed straight onto it: the sequence
      // `openScene / layFloor / standOn / captureReplay` produces.
      if (!rec.arm({ ...spec.design, background: "#0c1821" })) {
        throw new Error("the recorder bound to nothing");
      }
      frames(spec.frames);
      const cold = take();

      // WARM. The identical arm and the identical drive, with the cold section's
      // frames now behind it. The two must agree.
      if (!rec.arm({ ...spec.design, background: "#0c1821" })) {
        throw new Error("the recorder bound to nothing");
      }
      frames(spec.frames);
      const warm = take();

      return {
        cold,
        warm,
        fit: {
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          dx: offsetX,
          dy: offsetY,
          dw: spec.design.width * scale,
          dh: spec.design.height * scale,
        },
      };
    },
    {
      design: DESIGN,
      cssWidth: options.cssWidth ?? DESIGN.width,
      cssHeight: options.cssHeight ?? DESIGN.height,
      frames: options.frames ?? 3,
    },
  ) as Promise<Pair>;
}

it("records the offscreen stage of a capture armed before any frame has closed", async () => {
  const h = await fresh();
  const pair = await driveBuild(h);

  // The fit is EXACT — the viewport IS the design field — so the blit covers the
  // whole backing store and every condition of the rule holds for this build.
  // Nothing but the absence of a closed frame was ever refusing the hop.
  expect(pair.fit).toEqual({
    canvasWidth: 1280,
    canvasHeight: 720,
    dx: 0,
    dy: 0,
    dw: 1280,
    dh: 720,
  });

  // THE REGRESSION. The stage's own drawing, which the visible canvas's frames do
  // not contain a single operation of, from a capture armed with no evidence.
  expect(texts(pair.cold.ops)).toContain("stage");
  expect(blitted(pair.cold.ops)).toBe(false);

  // And the same for what a check reads back — `frameCalls()` is the half of the
  // defect the false failures were actually about.
  expect(texts(pair.cold.lastOps)).toContain("stage");

  // A capture armed with a closed frame behind it already worked. It still does,
  // and the two now agree — which is the whole point: a check that happens to
  // drive a frame before it arms must not be recorded differently from one that
  // does not.
  expect(texts(pair.warm.ops)).toContain("stage");
  expect(blitted(pair.warm.ops)).toBe(false);
  expect(pair.cold.frames).toBe(pair.warm.frames);
});

it("keeps every frame of a capture whose first frame decided the binding", async () => {
  const h = await fresh();
  const pair = await driveBuild(h, { frames: 1 });

  // THE FRAME THE DECISION WAS MADE ON IS IN THE RECORDING. The binding cannot be
  // decided before a frame closes, so the alternative — decide at that close and
  // start recording afterwards — would hand back NOTHING at all for a capture
  // that drives exactly one frame, and a replay short of its first frame for
  // every other. Instead the recording is started on every surface the answer
  // could name and the loser is abandoned, so the deciding frame is kept by
  // whichever surface wins it.
  expect(pair.cold.frames).toBe(1);
  expect(texts(pair.cold.ops)).toContain("stage");

  // And it is the STAGE'S frame, not a pass-through re-attributed: no blit, and
  // so not one full-viewport PNG of the visible canvas in the image table.
  expect(blitted(pair.cold.ops)).toBe(false);
  expect(pair.cold.images).toBe(0);
});

it("answers a page's very first frameCalls with the surface the game is drawn on", async () => {
  const h = await fresh();

  // `h.frameCalls()` is one driven frame and then a read of the primary surface.
  // Read as the FIRST driven frame of a page it used to answer nothing at all:
  // the frame closed on the attached canvas and set the evidence, the read that
  // followed hopped to the stage, and the stage had never had a frame opened on
  // it. A check asserting the build drew anything failed on a build that drew
  // perfectly well — and one asserting it drew no particular thing passed
  // vacuously, which is worse.
  const read = await h.page.evaluate(() => {
    const rec = (
      window as unknown as {
        __tcabRec: {
          begin(): void;
          end(deltaMs: number): void;
          last(): { op: string; method?: string; args?: unknown[] }[];
        };
      }
    ).__tcabRec;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    document.body.appendChild(canvas);
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    const stage = document.createElement("canvas");
    stage.width = 1280;
    stage.height = 720;
    const scene = stage.getContext("2d");
    if (context === null || scene === null) throw new Error("no 2d context");

    const draw = () => {
      scene.setTransform(1, 0, 0, 1, 0, 0);
      scene.fillStyle = "#101820";
      scene.fillRect(0, 0, 1280, 720);
      scene.fillStyle = "#ffcc00";
      scene.font = "12px sans-serif";
      scene.fillText("stage", 10, 20);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#0c1821";
      context.fillRect(0, 0, 1280, 720);
      context.imageSmoothingEnabled = false;
      context.drawImage(stage, 0, 0, 1280, 720);
    };

    // No capture is armed: this is the read a check makes outside one.
    rec.begin();
    draw();
    rec.end(16);
    const first = rec.last();
    return {
      length: first.length,
      texts: first
        .filter((op) => op.op === "call" && op.method === "fillText")
        .map((op) => String((op.args ?? [])[0])),
    };
  });

  expect(read.length).toBeGreaterThan(0);
  expect(read.texts).toContain("stage");
});

it("closes no recorder frame between the page opening and a check's first arm", async () => {
  const h = await fresh();

  // THE PREMISE OF EVERYTHING ABOVE, taken against the real kit rather than
  // against a scenario of this file's own. Everything a check's `beforeEach` and
  // scene setup do: the harness is built — load, surface probe, `setAutoStep`,
  // `reset`, the recorder-ready wait — and the scene is posed through the debug
  // surface. None of it brackets a frame.
  await h.debug.setAutoStep(false);
  await h.debug.reset({ seed: 1 });
  await h.debug.setX(40);

  const read = () =>
    h.page.evaluate(
      () =>
        (
          window as unknown as { __tcabRec: { last(): unknown[] } }
        ).__tcabRec.last().length,
    );

  // `lastOps` is written by `endFrame` and by nothing else, so an empty list is
  // proof that no frame has CLOSED — which is the state the selection rule has no
  // evidence in, and the state every check that poses its scene with debug calls
  // alone reaches its `captureReplay` in.
  expect(await read()).toBe(0);

  // One driven frame, and the evidence exists.
  await h.advance(1);
  expect(await read()).toBeGreaterThan(0);
});

it("still declines a cold blit that leaves a bar of the surface showing", async () => {
  const h = await fresh();
  // 4:3, so `fit()` puts real bars top and bottom and the blit does not cover the
  // backing store.
  const pair = await driveBuild(h, { cssWidth: 1280, cssHeight: 960 });

  expect(pair.fit.dy).toBeGreaterThan(0);

  // THE DELIBERATE FAILURE DIRECTION, and the point of pinning it HERE as well:
  // deciding the binding one frame later must not have relaxed what is being
  // decided. A genuinely letterboxed build is recorded exactly as badly cold as it
  // is warm, for the reason `recorder-surface.spec.ts` states — every relaxation
  // of the coverage condition also admits a build that blits a static background
  // and draws its whole game on top of it.
  expect(texts(pair.cold.ops)).not.toContain("stage");
  expect(texts(pair.warm.ops)).not.toContain("stage");
});
