// What a driven frame inherits, when the page is still painting behind it.
//
// An engineless build is required to keep rendering while it is off the clock
// (`specs/instrumentation.md`), so its own animation-frame loop goes on drawing
// between two driven frames — and every one of those background renders moves the
// properties, the transform, the current path, the clip and the save stack that a
// frame's inherited state is read from. Whether a present lands in any given gap
// is wall-clock dependent, which made a recorded replay of the same drawing differ
// from one run of a suite to the next.
//
// The rule these checks pin down is that a driven frame inherits WHAT THE PREVIOUS
// DRIVEN FRAME LEFT rather than what the context holds at the moment the frame
// opens. The page's loop is untouched — nothing here gates, defers or cancels an
// animation frame, because three of the four cases depend on that loop running:
// pixel reads await it, review stills are painted by it, and the checks that catch
// a build whose `setAutoStep(false)` did not disconnect let real time pass.
//
// DRIVEN ENTIRELY INSIDE ONE `page.evaluate`, ON A CANVAS OF THIS SUITE'S OWN. No
// animation frame can interrupt a synchronous evaluation, so the "background
// render" here is issued explicitly — a direct context operation outside any
// `begin`/`end` pair, which is exactly what a present that lands in a gap is. The
// canvas is created larger than the fixture's so the recorder binds to it, which
// leaves the scenario reading a context nothing else in the page touches: what a
// frame inherits is then stated by the scenario alone, and two runs of it are
// comparable byte for byte.

import { afterEach, expect, it } from "vitest";
import type { RecordedPathSegment, Recording } from "../src/index";
import { createHarness, type Harness } from "./fixture";

/** What happens between the two driven frames. */
type Background =
  | "none"
  | "draw"
  | "resize"
  | "reset"
  | "resize-then-draw"
  | "reset-then-draw";

/** What the two driven frames are about. */
type Mode = "basic" | "stack" | "path";

interface Scenario {
  background: Background;
  mode: Mode;
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

/**
 * Drive two frames over a canvas of the suite's own and hand back the recording.
 *
 * Every frame boundary and every operation is issued from inside one evaluation,
 * so the only thing that happens between the two frames is what `background`
 * says happens.
 */
function record(h: Harness, scenario: Scenario): Promise<Recording> {
  return h.page.evaluate((spec) => {
    interface Rec {
      arm(design: {
        width: number;
        height: number;
        background: string;
      }): boolean;
      begin(): void;
      end(deltaMs: number): void;
      disarm(): unknown;
    }
    const rec = (window as unknown as { __tcabRec: Rec }).__tcabRec;

    // Larger than the build's own canvas, so the recorder's "largest attached
    // surface" lands here. Out of the flow, so the page it is added to lays out
    // exactly as it did.
    const shown = document.querySelector("canvas");
    const canvas = document.createElement("canvas");
    canvas.width = (shown === null ? 0 : shown.width) + 64;
    canvas.height = (shown === null ? 0 : shown.height) + 64;
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");

    if (!rec.arm({ width: 200, height: 100, background: "#101820" })) {
      throw new Error("the recorder bound to nothing");
    }

    // Frame one: whatever it leaves is what frame two must inherit.
    rec.begin();
    if (spec.mode === "stack") {
      ctx.fillStyle = "#111111";
      ctx.save();
      ctx.fillStyle = "#222222";
      ctx.fillRect(0, 0, 10, 10);
    } else if (spec.mode === "path") {
      ctx.fillStyle = "#3a4370";
      ctx.beginPath();
      ctx.moveTo(1, 2);
      ctx.lineTo(30, 40);
      ctx.lineTo(5, 44);
    } else {
      ctx.fillStyle = "#3a4370";
      ctx.strokeStyle = "#ff00ff";
      ctx.lineWidth = 3;
      ctx.font = "18px serif";
      ctx.textAlign = "left";
      ctx.translate(4, 6);
      ctx.beginPath();
      ctx.rect(2, 2, 8, 8);
      ctx.clip();
      ctx.fillRect(0, 0, 10, 10);
    }
    rec.end(16);

    // Between the frames: the page's own loop, or nothing at all. Every one of
    // these moves something a frame's inherited state is read from.
    if (
      spec.background === "draw" ||
      spec.background === "resize" ||
      spec.background === "resize-then-draw"
    ) {
      ctx.save();
      ctx.strokeStyle = "#3a4370";
      ctx.font = "19px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 9;
      ctx.translate(11, 13);
      ctx.beginPath();
      ctx.moveTo(1004.83276, 338);
      ctx.lineTo(12, 34);
      ctx.rect(0, 0, 4, 4);
      ctx.clip();
      ctx.fillRect(1, 1, 2, 2);
    }
    // A wipe throws away the clip, the path and the save stack, so what was put
    // aside for the next frame describes a context that no longer exists.
    if (
      spec.background === "resize" ||
      spec.background === "resize-then-draw"
    ) {
      canvas.width = canvas.width;
    }
    if (spec.background === "reset" || spec.background === "reset-then-draw") {
      ctx.reset();
    }

    // The render that lands AFTER the wipe. Nothing may be put aside for the next
    // frame from the blank a wipe leaves — no frame ever ran under it — so what
    // this leaves is what the frame after it has to read off the context.
    if (
      spec.background === "resize-then-draw" ||
      spec.background === "reset-then-draw"
    ) {
      ctx.fillStyle = "#5599aa";
      ctx.lineWidth = 7;
      ctx.font = "21px monospace";
      ctx.textAlign = "right";
      ctx.translate(3, 5);
      ctx.beginPath();
      ctx.rect(1, 1, 6, 6);
      ctx.clip();
      ctx.fillRect(0, 0, 3, 3);
    }

    // Frame two: the frame the whole rule is about.
    rec.begin();
    if (spec.mode === "stack") {
      ctx.restore();
      ctx.fillRect(20, 20, 5, 5);
    } else if (spec.mode === "path") {
      ctx.fill();
    } else {
      ctx.fillRect(20, 20, 5, 5);
    }
    rec.end(16);

    return rec.disarm() as Recording;
  }, scenario);
}

/** The state one recorded frame inherited. */
function inherited(recording: Recording, at: number) {
  const frame = recording.frames[at];
  if (frame === undefined) throw new Error(`no frame ${at}`);
  const state = recording.states[frame.state];
  if (state === undefined) throw new Error(`frame ${at} names no state`);
  return state;
}

/** Every path operation one segment list holds, as method names. */
function methods(segments: RecordedPathSegment[]): string[] {
  return segments.flatMap((segment) =>
    segment.ops.map((op) => (op.op === "call" ? op.method : op.property)),
  );
}

it("inherits what the frame before it left, not what a background render left", async () => {
  const recording = await record(await fresh(), {
    background: "draw",
    mode: "basic",
  });

  expect(recording.frames).toHaveLength(2);
  const state = inherited(recording, 1);
  // Everything the render in the gap moved, as the frame before it left it.
  expect(state.properties.fillStyle).toBe("#3a4370");
  expect(state.properties.strokeStyle).toBe("#ff00ff");
  expect(state.properties.font).toBe("18px serif");
  expect(state.properties.textAlign).toBe("left");
  expect(state.properties.lineWidth).toBe(3);
  expect(state.transform).toEqual([1, 0, 0, 1, 4, 6]);
  // The clip frame one cut, and only it: the gap's clip intersected another
  // rectangle in, and the path it left half-built is not this frame's.
  expect(methods(state.clip)).toEqual(["beginPath", "rect", "clip"]);
  expect(methods(state.path)).toEqual(["beginPath", "rect"]);
  // Nothing was saved and not restored while frame one ran, and the `save()` the
  // gap made is not a level this frame can return to.
  expect(recording.frames[1]?.stack).toEqual([]);
});

it("records the same bytes whether or not the page painted between frames", async () => {
  // The determinism claim itself. Two pages rather than two runs in one, because
  // the frame counter and the elapsed clock belong to the page and go on counting.
  const [quiet, busy] = await Promise.all([
    record(await fresh(), { background: "none", mode: "basic" }),
    record(await fresh(), { background: "draw", mode: "basic" }),
  ]);

  expect(JSON.stringify(busy)).toBe(JSON.stringify(quiet));
});

it("falls back to the context after a wipe, carrying none of what it threw away", async () => {
  for (const background of ["resize", "reset"] as const) {
    const recording = await record(await fresh(), {
      background,
      mode: "basic",
    });

    const state = inherited(recording, 1);
    // A wipe returns the properties to their defaults and discards the clip, the
    // current path and the save stack. What was put aside before it — frame one's
    // state, and the render in the gap that followed it — describes none of that.
    expect(state.properties.fillStyle).toBe("#000000");
    expect(state.properties.strokeStyle).toBe("#000000");
    expect(state.properties.lineWidth).toBe(1);
    expect(state.properties.textAlign).toBe("start");
    expect(state.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(state.clip).toEqual([]);
    expect(state.path).toEqual([]);
    expect(recording.frames[1]?.stack).toEqual([]);
  }
});

it("still carries a save across a frame boundary, past a background render", async () => {
  for (const background of ["none", "draw"] as const) {
    const recording = await record(await fresh(), {
      background,
      mode: "stack",
    });

    // The level frame one saved and frame two restores. Without it the replay
    // would run everything after the `restore()` under the state the frame left
    // rather than the state it returned to.
    const stack = recording.frames[1]?.stack ?? [];
    expect(stack).toHaveLength(1);
    expect(recording.states[stack[0] as number]?.properties.fillStyle).toBe(
      "#111111",
    );
    expect(inherited(recording, 1).properties.fillStyle).toBe("#222222");
  }
});

it("still carries an open path across a frame boundary, past a background render", async () => {
  for (const background of ["none", "draw"] as const) {
    const recording = await record(await fresh(), { background, mode: "path" });

    // The path frame one opened, which is what frame two's bare `fill()` fills.
    expect(methods(inherited(recording, 1).path)).toEqual([
      "beginPath",
      "moveTo",
      "lineTo",
      "lineTo",
    ]);
  }
});

it("copies nothing at all when nothing happens between two frames", async () => {
  // Copy-on-write, stated where it is paid for: `beginFrame` and `endFrame` run
  // for every driven frame whether or not anything is recording, and a suite
  // drives tens of thousands of them. The state is put aside by reading it off the
  // context, so counting the reads counts the copies.
  const h = await fresh();
  const copies = await h.page.evaluate(() => {
    interface Rec {
      begin(): void;
      end(deltaMs: number): void;
    }
    const rec = (window as unknown as { __tcabRec: Rec }).__tcabRec;

    const shown = document.querySelector("canvas");
    const canvas = document.createElement("canvas");
    canvas.width = (shown === null ? 0 : shown.width) + 64;
    canvas.height = (shown === null ? 0 : shown.height) + 64;
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");

    // Counted on the prototype, because the recorder reads the state off the raw
    // context rather than through its own wrapper — and counted for THIS canvas
    // alone, so the build's own loop painting its own surface is not in the total.
    const proto = CanvasRenderingContext2D.prototype;
    const property = Object.getOwnPropertyDescriptor(proto, "fillStyle");
    if (property === undefined || property.get === undefined) {
      throw new Error("fillStyle is not an accessor");
    }
    const read = property.get;
    let reads = 0;
    Object.defineProperty(proto, "fillStyle", {
      ...property,
      get(this: CanvasRenderingContext2D) {
        if (this.canvas === canvas) reads += 1;
        return read.call(this);
      },
    });

    const drive = () => {
      rec.begin();
      ctx.fillRect(0, 0, 4, 4);
      rec.end(16);
    };

    try {
      // Idle: two frames back to back, with nothing in between.
      drive();
      drive();
      const quiet = reads;

      // One render in the gap, however many operations long.
      drive();
      ctx.fillRect(1, 1, 2, 2);
      ctx.fillRect(2, 2, 2, 2);
      ctx.translate(1, 1);
      drive();
      const busy = reads - quiet;

      return { quiet, busy };
    } finally {
      Object.defineProperty(proto, "fillStyle", property);
    }
  });

  expect(copies.quiet).toBe(0);
  expect(copies.busy).toBe(1);
});

it("opens on the blank the recorder attached to, not the build's start-up state", async () => {
  // THE ONE FRAME THE CHAIN CANNOT REACH, AND THE TRADE THAT BUYS DETERMINISM.
  // A build that fits its canvas, takes a clip and sets a palette BEFORE the
  // harness drives anything does all of it outside a frame, and there is no frame
  // behind the first one to inherit from. The state put aside is the blank the
  // recorder attached to.
  //
  // Reading the live context there instead would be more faithful, and it is what
  // an earlier draft did — but the context at that moment holds whatever the
  // page's own loop last painted, which is exactly the wall-clock race this whole
  // mechanism exists to remove: it put two of carom's replays back to differing
  // between runs. A build that re-establishes what it paints with at the top of
  // each frame — which all four cases do — is unaffected either way, and the
  // frames after the first inherit correctly regardless.
  const h = await fresh();
  const recording = (await h.page.evaluate(() => {
    interface Rec {
      arm(design: {
        width: number;
        height: number;
        background: string;
      }): boolean;
      begin(): void;
      end(deltaMs: number): void;
      disarm(): unknown;
    }
    const rec = (window as unknown as { __tcabRec: Rec }).__tcabRec;

    const shown = document.querySelector("canvas");
    const canvas = document.createElement("canvas");
    canvas.width = (shown === null ? 0 : shown.width) + 64;
    canvas.height = (shown === null ? 0 : shown.height) + 64;
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");

    // The build's own start-up, before the harness has driven anything.
    ctx.scale(2, 2);
    ctx.fillStyle = "#abcdef";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.rect(0, 0, 50, 50);
    ctx.clip();

    if (!rec.arm({ width: 200, height: 100, background: "#101820" })) {
      throw new Error("the recorder bound to nothing");
    }
    rec.begin();
    ctx.fillRect(0, 0, 4, 4);
    rec.end(16);
    return rec.disarm();
  })) as Recording;

  const state = inherited(recording, 0);
  expect(state.transform).toEqual([1, 0, 0, 1, 0, 0]);
  expect(state.properties.fillStyle).toBe("#000000");
  expect(state.properties.lineWidth).toBe(1);
  expect(methods(state.clip)).toEqual([]);
});

it("records the same bytes after a wipe whatever the page painted over it", async () => {
  // The other moment with no frame behind it, and the one that decides whether a
  // build which fits its canvas mid-run stays reproducible. Carom's does, so a
  // wipe is routine rather than exotic: what the frame after it inherits must not
  // depend on whether the page's loop got a paint in first.
  for (const wipe of ["resize", "reset"] as const) {
    const [quiet, busy] = await Promise.all([
      record(await fresh(), { background: wipe, mode: "basic" }),
      record(await fresh(), {
        background: `${wipe}-then-draw` as const,
        mode: "basic",
      }),
    ]);

    expect(JSON.stringify(busy)).toBe(JSON.stringify(quiet));
  }
});
