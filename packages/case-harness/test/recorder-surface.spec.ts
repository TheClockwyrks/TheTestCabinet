// WHICH SURFACE A RECORDING IS ABOUT, and what it costs to capture it.
//
// The injected recorder binds one recording to ONE canvas, and for a long time
// that canvas was simply "the largest one attached to the document" — on the
// assumption, written into the rule, that a build's own surfaces are "smaller and
// unattached". The ordinary letterboxed pattern breaks the assumption exactly
// backwards: a build renders the whole game into a design-sized canvas it NEVER
// attaches, and blits that one canvas onto the visible one each frame. Bound to
// the visible canvas, every frame the recorder holds is a background fill and one
// `drawImage`, so `frameCalls()` reports no text, no sprites and no shapes however
// correct the game is — and every check that reads the operation list fails while
// the pixel checks in the same suite pass. That split is the signature, and it
// cost one measured run some thirty false failures.
//
// The rule now FOLLOWS THE PASS-THROUGH BLIT, one hop: when the last painting call
// of the attached canvas's last closed frame copied another tracked surface over
// the whole of it, that frame drew nothing of its own that survived, and the
// recording binds to the surface on the other side of the blit.
//
// WHAT THESE CHECKS ARE FOR IS THE CASES THE RULE MUST NOT MOVE, as much as the
// one it must. A build that draws straight onto its canvas, and a build that draws
// its own game and composites several small busy offscreen surfaces over it — the
// shape a particle field takes, and the shape any op-count-based rule would have
// bound to — must both be recorded exactly as they were before the rule existed.
//
// DRIVEN ENTIRELY INSIDE ONE `page.evaluate`, ON CANVASES OF THIS SUITE'S OWN, for
// the same reason `recorder-carry.spec.ts` is: no animation frame can interrupt a
// synchronous evaluation, so what each frame contains is stated by the scenario
// alone. The canvases are created larger than the fixture's own so the recorder's
// search starts at one of them.

import { afterEach, expect, it } from "vitest";
import type { RecordedOp } from "../src/index";

import { createHarness, type Harness } from "./fixture";

/** What the build under each scenario does with its surfaces. */
type Shape =
  /** Draws the game straight onto the attached canvas. The common case. */
  | "direct"
  /** Renders into an unattached stage and blits it over the whole canvas. */
  | "letterbox"
  /** The same, with real bars: the blit leaves a margin of the canvas showing. */
  | "letterbox-bars"
  /** Blits a stage that has never drawn anything at all. */
  | "idle-stage"
  /** Blits a stage that was painted once at load and has been static since. */
  | "static-stage"
  /** Draws its game, then composites a translucent full-surface overlay over it. */
  | "overlay-alpha"
  /** The same, at full alpha but under a `lighter` composite. */
  | "overlay-lighter"
  /** Draws its game, then blits a whole surface into a small clipped inset. */
  | "clipped-inset"
  /** Draws its own game and composites small busy offscreen surfaces onto it. */
  | "composited";

/** What one scenario's recording turned out to be. */
interface Recorded {
  /** Every operation the kept frames issued, in order. */
  ops: RecordedOp[];
  /** Every operation the last driven frame issued, as `frameCalls()` reads them. */
  lastOps: RecordedOp[];
  frames: number;
  images: number;
}

const open: Harness[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.dispose()));
});

/** A page of this suite's own, disposed when the check finishes. */
async function fresh(): Promise<Harness> {
  const h = await createHarness();
  open.push(h);
  return h;
}

/** The calls among a list of operations, with the assignments dropped. */
function calls(ops: RecordedOp[]): { method: string; args: unknown[] }[] {
  return ops.flatMap((op) => (op.op === "call" ? [op] : []));
}

/** The first argument of every `fillText`: which surface's marker was drawn. */
function texts(ops: RecordedOp[]): string[] {
  return calls(ops)
    .filter((op) => op.method === "fillText")
    .map((op) => String(op.args[0]));
}

/** Whether any operation blitted anything. */
function blitted(ops: RecordedOp[]): boolean {
  return calls(ops).some((op) => op.method === "drawImage");
}

/**
 * Drive one scenario and hand back what the recorder bound to.
 *
 * NOTHING RUNS BEFORE THE ARM, which is the sequence a real check produces: a
 * check poses its scene through the debug surface and arms its capture without
 * ever bracketing a recorder frame. These scenarios used to close one warm-up
 * frame first, on the ground that the rule reads the last CLOSED frame and the
 * evidence therefore has to exist before the decision — and that warm-up is
 * exactly why fourteen passing checks certified a rule that missed half of one
 * measured run's recordings. The evidence does not exist at `arm()`, so the
 * binding is decided at the close of the recording's first frame instead; see
 * `recorder-cold-arm.spec.ts`, which is that gap under test.
 */
function record(h: Harness, shape: Shape, frames = 3): Promise<Recorded> {
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

      // Larger than the build's own canvas, so the recorder's search starts here.
      // Out of the flow, so the page it is added to lays out exactly as it did.
      const shown = document.querySelector("canvas");
      const width = (shown === null ? 0 : shown.width) + 64;
      const height = (shown === null ? 0 : shown.height) + 64;

      const visible = document.createElement("canvas");
      visible.width = width;
      visible.height = height;
      visible.style.position = "absolute";
      visible.style.left = "-99999px";
      document.body.appendChild(visible);
      const view = visible.getContext("2d");

      // NEVER attached: the surface the whole defect is about.
      const stage = document.createElement("canvas");
      stage.width = width;
      stage.height = height;
      const scene = stage.getContext("2d");

      // Several small, busy, unattached surfaces composited onto the visible one.
      // The shape a particle field takes, and the one an op-count rule binds to.
      const fields: {
        canvas: HTMLCanvasElement;
        ctx: CanvasRenderingContext2D;
      }[] = [];
      for (let at = 0; at < 4; at += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("no 2d context");
        fields.push({ canvas, ctx });
      }
      if (view === null || scene === null) throw new Error("no 2d context");

      const paintStage = () => {
        scene.setTransform(1, 0, 0, 1, 0, 0);
        scene.fillStyle = "#101820";
        scene.fillRect(0, 0, width, height);
        scene.fillStyle = "#ffcc00";
        scene.font = "12px sans-serif";
        scene.fillText("stage", 10, 20);
        scene.fillRect(4, 30, 12, 12);
      };

      // A full-surface layer of its own: transparent but for a few scanlines, the
      // shape a rain, lighting, vignette or CRT pass takes. Repainted each frame so
      // only its compositing — not its liveness — is what refuses the hop.
      const overlay = document.createElement("canvas");
      overlay.width = width;
      overlay.height = height;
      const wash = overlay.getContext("2d");
      if (wash === null) throw new Error("no 2d context");
      const paintOverlay = () => {
        wash.clearRect(0, 0, width, height);
        wash.fillStyle = "rgba(255,255,255,0.25)";
        for (let y = 0; y < height; y += 4) wash.fillRect(0, y, width, 1);
      };

      const paintFields = () => {
        for (const field of fields) {
          field.ctx.fillStyle = "#88ccff";
          field.ctx.fillRect(0, 0, 32, 32);
          field.ctx.font = "8px sans-serif";
          field.ctx.fillText("burst", 1, 8);
        }
      };

      const frame = () => {
        if (spec.shape === "direct") {
          view.setTransform(1, 0, 0, 1, 0, 0);
          view.fillStyle = "#101820";
          view.fillRect(0, 0, width, height);
          view.fillStyle = "#ffcc00";
          view.font = "12px sans-serif";
          view.fillText("visible", 10, 20);
          return;
        }
        if (spec.shape === "composited") {
          paintFields();
          view.setTransform(1, 0, 0, 1, 0, 0);
          view.fillStyle = "#101820";
          view.fillRect(0, 0, width, height);
          view.fillStyle = "#ffcc00";
          view.font = "12px sans-serif";
          view.fillText("visible", 10, 20);
          // Composited LAST, and each covering a fraction of the surface: the
          // hardest case for the rule, because the frame's final painting call is a
          // `drawImage` from a tracked canvas and only the coverage test refuses it.
          fields.forEach((field, at) => {
            view.drawImage(field.canvas, at * 8, 40, 32, 32);
          });
          return;
        }
        if (
          spec.shape === "overlay-alpha" ||
          spec.shape === "overlay-lighter" ||
          spec.shape === "clipped-inset"
        ) {
          if (spec.shape === "clipped-inset") {
            // Repainted every frame, so liveness holds and the clip is the only
            // thing left that can refuse the hop.
            paintStage();
          } else {
            paintOverlay();
          }
          view.setTransform(1, 0, 0, 1, 0, 0);
          view.globalAlpha = 1;
          view.globalCompositeOperation = "source-over";
          view.fillStyle = "#101820";
          view.fillRect(0, 0, width, height);
          view.fillStyle = "#ffcc00";
          view.font = "12px sans-serif";
          view.fillText("visible", 10, 20);
          if (spec.shape === "clipped-inset") {
            // The ordinary minimap: a whole surface scaled into a small box. The
            // destination rectangle covers the canvas; the clip means about one
            // part in seventy of it is actually touched.
            view.save();
            view.beginPath();
            view.rect(4, 4, 40, 30);
            view.clip();
            view.drawImage(stage, 0, 0, width, height);
            view.restore();
            return;
          }
          if (spec.shape === "overlay-alpha") {
            view.globalAlpha = 0.4;
          } else {
            view.globalCompositeOperation = "lighter";
          }
          view.drawImage(overlay, 0, 0, width, height);
          view.globalAlpha = 1;
          view.globalCompositeOperation = "source-over";
          return;
        }
        if (spec.shape !== "idle-stage" && spec.shape !== "static-stage") {
          paintStage();
        }
        view.setTransform(1, 0, 0, 1, 0, 0);
        view.fillStyle = "#000000";
        view.fillRect(0, 0, width, height);
        view.imageSmoothingEnabled = false;
        if (spec.shape === "letterbox-bars") {
          view.drawImage(stage, 8, 4, width - 16, height - 8);
        } else {
          view.drawImage(stage, 0, 0, width, height);
        }
      };

      // A layer painted ONCE, before any frame, and never touched again: a sprite
      // atlas, a pre-rendered background, a static overlay. Every other condition
      // of the rule holds for a blit of it, and only its liveness refuses one.
      if (spec.shape === "static-stage") paintStage();

      if (!rec.arm({ width, height, background: "#101820" })) {
        throw new Error("the recorder bound to nothing");
      }
      for (let at = 0; at < spec.frames; at += 1) {
        rec.begin();
        frame();
        rec.end(16);
      }
      const lastOps = rec.last();
      const recording = rec.disarm();
      if (recording === null) throw new Error("no recording");
      return {
        // Resolved in the page. A recording's own image table is megabytes of
        // base64 and nothing here reads it; only how many entries it holds.
        ops: recording.frames.flatMap((held) =>
          held.ops.map((at) => recording.ops[at]),
        ) as RecordedOp[],
        lastOps: lastOps as RecordedOp[],
        frames: recording.frames.length,
        images: recording.images.length,
      };
    },
    { shape, frames },
  );
}

it("follows a pass-through blit to the surface the game is drawn on", async () => {
  const h = await fresh();
  const recorded = await record(h, "letterbox");

  // The stage's own drawing, which the visible canvas's frame does not contain a
  // single operation of.
  expect(texts(recorded.ops)).toContain("stage");
  expect(blitted(recorded.ops)).toBe(false);
  expect(recorded.frames).toBe(3);

  // AND THE SAME FOR WHAT A CHECK READS. `frameCalls()` runs outside any capture
  // and reads the primary surface, so the false failures the defect caused were
  // never about the recording — they were about this.
  expect(texts(recorded.lastOps)).toContain("stage");
});

it("charges the followed recording nothing for the surface it hopped from", async () => {
  const h = await fresh();
  const recorded = await record(h, "letterbox");

  // A frame is opened and closed on the attached canvas as well, so it goes on
  // observing and the decision can be taken again. Those frames must be pure
  // observation: the recording holds exactly the frames that were driven, and not
  // one of the visible canvas's pass-through blits — which, being a blit of a
  // canvas, would have been re-rasterized to a PNG at every use.
  expect(recorded.frames).toBe(3);
  expect(recorded.images).toBe(0);
});

it("leaves a build that draws straight onto its canvas where it was", async () => {
  const h = await fresh();
  const recorded = await record(h, "direct");

  expect(texts(recorded.ops)).toContain("visible");
  expect(blitted(recorded.ops)).toBe(false);
});

it("does not follow a small busy surface composited over the game", async () => {
  const h = await fresh();
  const recorded = await record(h, "composited");

  // The build's own drawing, with the burst blits among it — not one of the four
  // busy 32x32 fields, each of which drew as much as the game did.
  expect(texts(recorded.ops)).toContain("visible");
  expect(texts(recorded.ops)).not.toContain("burst");
  expect(blitted(recorded.ops)).toBe(true);
});

it("does not follow a blit onto a surface that has drawn nothing", async () => {
  const h = await fresh();
  const recorded = await record(h, "idle-stage");

  // Full coverage, from a tracked canvas, last in the frame — every condition but
  // the one that asks whether there is anything on the other side. Binding here
  // would record the game as nothing at all.
  expect(blitted(recorded.ops)).toBe(true);
  expect(texts(recorded.ops)).not.toContain("stage");
});

it("does not follow a blit onto a surface that has gone static", async () => {
  const h = await fresh();
  const recorded = await record(h, "static-stage");

  // A pre-rendered layer — an atlas, a background, a fixed overlay — is painted
  // once at load and satisfies "has ever drawn something" for the rest of the
  // page. Following one records the game as nothing at all, which is the very
  // outcome the liveness condition exists to prevent, so the question asked is
  // whether the source painted during THIS frame.
  expect(blitted(recorded.ops)).toBe(true);
  expect(texts(recorded.ops)).not.toContain("stage");
  expect(texts(recorded.lastOps)).not.toContain("stage");
});

it("does not follow a translucent full-surface overlay", async () => {
  const h = await fresh();
  const recorded = await record(h, "overlay-alpha");

  // A canvas is RGBA, so a full-rect blit of one at less than full alpha does NOT
  // overpaint what the frame drew before it — the game's text is still on the
  // screen under it. Following it would take the recording to a canvas holding
  // nothing but scanlines, which is the same class of false failure this whole
  // rule exists to remove.
  expect(texts(recorded.ops)).toContain("visible");
  expect(texts(recorded.lastOps)).toContain("visible");
});

it("does not follow a full-surface overlay under a composite operation", async () => {
  const h = await fresh();
  const recorded = await record(h, "overlay-lighter");

  // The same, at full alpha: `lighter` adds to the destination rather than
  // replacing it. The idiom is in this repository's own reference builds.
  expect(texts(recorded.ops)).toContain("visible");
  expect(texts(recorded.lastOps)).toContain("visible");
});

it("does not follow a whole-surface blit made into a clipped inset", async () => {
  const h = await fresh();
  const recorded = await record(h, "clipped-inset");

  // The destination rectangle covers the backing store and the source is a live,
  // tracked surface — every condition the coverage test can see. What it cannot
  // see is the clip, which is why the clip is asked about separately: a minimap
  // is drawn exactly this way, and binding to the world it shows would answer
  // `frameCalls()` with a surface the player never looked at.
  expect(texts(recorded.ops)).toContain("visible");
  expect(texts(recorded.lastOps)).toContain("visible");
});

it("declines a blit that leaves a bar of the surface showing", async () => {
  const h = await fresh();
  const recorded = await record(h, "letterbox-bars");

  // THE DELIBERATE FAILURE DIRECTION, pinned here so it is a decision rather than
  // a surprise. A build that genuinely letterboxes is recorded exactly as badly as
  // it was before the rule existed. Coverage is demanded without slack because
  // every relaxation that admits this also admits a build that renders a static
  // background offscreen, blits it, and draws its whole game on top — and that
  // build would be bound to its background.
  expect(texts(recorded.ops)).not.toContain("stage");
  expect(blitted(recorded.ops)).toBe(true);
});

it("goes back to the attached surface when a build stops compositing", async () => {
  const h = await fresh();
  const answers = await h.page.evaluate(() => {
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
          disarm(): {
            images: unknown[];
            ops: unknown[];
            frames: { ops: number[] }[];
          } | null;
        };
      }
    ).__tcabRec;

    const shown = document.querySelector("canvas");
    const width = (shown === null ? 0 : shown.width) + 64;
    const height = (shown === null ? 0 : shown.height) + 64;

    const visible = document.createElement("canvas");
    visible.width = width;
    visible.height = height;
    visible.style.position = "absolute";
    visible.style.left = "-99999px";
    document.body.appendChild(visible);
    const view = visible.getContext("2d");

    const stage = document.createElement("canvas");
    stage.width = width;
    stage.height = height;
    const scene = stage.getContext("2d");
    if (view === null || scene === null) throw new Error("no 2d context");

    const composited = () => {
      scene.setTransform(1, 0, 0, 1, 0, 0);
      scene.fillStyle = "#ffcc00";
      scene.font = "12px sans-serif";
      scene.fillText("stage", 10, 20);
      view.setTransform(1, 0, 0, 1, 0, 0);
      view.fillStyle = "#000000";
      view.fillRect(0, 0, width, height);
      view.drawImage(stage, 0, 0, width, height);
    };

    const straight = () => {
      view.setTransform(1, 0, 0, 1, 0, 0);
      view.fillStyle = "#101820";
      view.fillRect(0, 0, width, height);
      view.fillStyle = "#ffcc00";
      view.font = "12px sans-serif";
      view.fillText("visible", 10, 20);
    };

    const take = (paint: () => void) => {
      const design = { width, height, background: "#101820" };
      if (!rec.arm(design)) throw new Error("the recorder bound to nothing");
      rec.begin();
      paint();
      rec.end(16);
      const recording = rec.disarm();
      if (recording === null) throw new Error("no recording");
      return recording.frames.flatMap((held) =>
        held.ops.map((at) => recording.ops[at]),
      ) as RecordedOp[];
    };

    rec.begin();
    composited();
    rec.end(16);
    const followed = take(composited);

    // The build stops compositing. The attached surface is still being driven —
    // that is what the pair is for — so it observes this frame and answers again
    // on the next decision. Without it the hop would have latched on one frame's
    // evidence for the rest of the page.
    rec.begin();
    straight();
    rec.end(16);
    const back = take(straight);

    return { followed, back };
  });

  expect(texts(answers.followed)).toContain("stage");
  expect(texts(answers.back)).toContain("visible");
});

/* ------------------------------------------------------------------------ */
/* The capture budgets                                                      */
/* ------------------------------------------------------------------------ */
//
// A budget refuses a NEW entry rather than the capture, so a source already
// pooled goes on resolving past a ceiling and what a refusal degrades to is the
// opaque marker the format already defines. Three things about that are pinned
// here, and every one of them was a defect:
//
//   - Two ceilings, not one. The per-recording budget is emptied at each arm, so
//     it said nothing at all about a suite file that drives forty recordings —
//     which is how 166 individually-bounded recordings came to 1.75 GB between
//     them.
//   - Past a ceiling, a MUTABLE source is refused before it is encoded. It is the
//     one kind least likely to be already pooled, and encoding it to find out is
//     the most expensive operation the recorder has.
//   - Past a ceiling, a FIXED source refused once is remembered as refused. Asking
//     again could only encode the same bytes to reach the same no, once per blit
//     for the rest of the section.
//
// AN `ImageData` IS WHAT DRIVES THEM. It is charged its own RGBA bytes as base64
// and never touches a PNG encoder, so a ceiling stated in megabytes is reached in
// one operation rather than in a minute of rasterizing.

/** A 2048x2048 pixel buffer: 22 MB of payload, past the per-recording ceiling. */
const OVER_BUDGET = 2048;

it("degrades to a marker past the recording's own ceiling", async () => {
  const h = await fresh();
  const answer = await h.page.evaluate((size) => {
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
          disarm(): {
            images: unknown[];
            ops: unknown[];
            frames: { ops: number[] }[];
          } | null;
        };
      }
    ).__tcabRec;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");

    const pixels = new ImageData(size, size);
    if (!rec.arm({ width: 320, height: 240, background: "#101820" })) {
      throw new Error("the recorder bound to nothing");
    }
    rec.begin();
    ctx.putImageData(pixels, 0, 0);
    rec.end(16);
    rec.begin();
    // Different bytes, so this is a different entry rather than the pooled one
    // resolving again — which is the case the ceiling has nothing to say about.
    pixels.data[0] = 255;
    ctx.putImageData(pixels, 0, 0);
    rec.end(16);
    const recording = rec.disarm();
    if (recording === null) throw new Error("no recording");

    return {
      images: recording.images.length,
      // Per frame, and resolved in the page: a recording's image table is
      // megabytes of base64 and nothing here reads it.
      frames: recording.frames.map(
        (held) => held.ops.map((at) => recording.ops[at]) as RecordedOp[],
      ),
    };
  }, OVER_BUDGET);

  const put = answer.frames.map(
    (ops) => calls(ops).find((op) => op.method === "putImageData")?.args[0],
  );
  expect(answer.images).toBe(1);
  expect(put[0]).toEqual({ $img: 0 });
  // Still an operation, still in the frame, and reported as a picture the
  // recording could not carry rather than dropped.
  expect(put[1]).toEqual({ $opaque: "ImageData" });
});

it("bounds what one page captures across every recording it drives", async () => {
  const h = await fresh();
  const held = await h.page.evaluate((size) => {
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
          disarm(): { images: unknown[] } | null;
        };
      }
    ).__tcabRec;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");

    const pixels = new ImageData(size, size);
    const counts: number[] = [];
    // Each of these is INSIDE the per-recording ceiling: one entry, and the arm
    // that follows empties what the last one charged. Only the page-lifetime
    // total sees them add up.
    for (let at = 0; at < 4; at += 1) {
      if (!rec.arm({ width: 320, height: 240, background: "#101820" })) {
        throw new Error("the recorder bound to nothing");
      }
      rec.begin();
      ctx.putImageData(pixels, 0, 0);
      rec.end(16);
      const recording = rec.disarm();
      if (recording === null) throw new Error("no recording");
      counts.push(recording.images.length);
    }
    return counts;
  }, OVER_BUDGET);

  expect(held).toEqual([1, 1, 1, 0]);
});

it("does not encode a source a ceiling has already refused", async () => {
  const h = await fresh();
  const answer = await h.page.evaluate(async (size) => {
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
          disarm(): {
            images: unknown[];
            ops: unknown[];
            frames: { ops: number[] }[];
          } | null;
        };
      }
    ).__tcabRec;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");

    // A MUTABLE source: a canvas of the page's own, which is re-captured at every
    // use because a repainted one looks exactly like one that was left alone.
    const sprite = document.createElement("canvas");
    sprite.width = 16;
    sprite.height = 16;
    const paint = sprite.getContext("2d");
    if (paint === null) throw new Error("no 2d context");
    paint.fillStyle = "#ffcc00";
    paint.fillRect(0, 0, 16, 16);

    // A FIXED source: an `<img>`, captured once under the identity of the file it
    // points at however many frames blit it.
    const fixed = new Image();
    fixed.src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await fixed.decode();

    // Counted only from here, so nothing the page did while the image loaded is
    // in the total. Every capture of a bitmap goes through the recorder's scratch
    // canvas and ends in exactly one of these.
    const encodes = { count: 0 };
    const nativeToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      encodes.count += 1;
      return nativeToDataURL.apply(this, args);
    };

    try {
      const pixels = new ImageData(size, size);
      if (!rec.arm({ width: 320, height: 240, background: "#101820" })) {
        throw new Error("the recorder bound to nothing");
      }
      // Spends the ceiling, and costs no PNG encode of its own: a pixel buffer
      // travels as its own bytes.
      rec.begin();
      ctx.putImageData(pixels, 0, 0);
      rec.end(16);

      for (let at = 0; at < 3; at += 1) {
        rec.begin();
        // Partial coverage, so neither of these is a pass-through blit.
        ctx.drawImage(sprite, 4, 4, 8, 8);
        ctx.drawImage(fixed, 20, 4, 8, 8);
        rec.end(16);
      }
      const recording = rec.disarm();
      if (recording === null) throw new Error("no recording");

      return {
        encodes: encodes.count,
        ops: recording.frames.flatMap((held) =>
          held.ops.map((at) => recording.ops[at]),
        ) as RecordedOp[],
      };
    } finally {
      HTMLCanvasElement.prototype.toDataURL = nativeToDataURL;
    }
  }, OVER_BUDGET);

  // ONE. The mutable canvas is refused before it is encoded at all — three times
  // over — and the fixed image is encoded once, refused, and remembered as
  // refused. Before this the same six draws cost six full PNG encodes, every one
  // of them thrown away.
  const markers = calls(answer.ops)
    .filter((op) => op.method === "drawImage")
    .map((op) => op.args[0]);
  expect(answer.encodes).toBe(1);
  expect(markers).toHaveLength(6);
  for (const marker of markers) {
    expect(marker).toHaveProperty("$opaque");
  }
});
