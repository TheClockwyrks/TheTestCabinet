// WHAT A FRAME INHERITS, as `lastInherited()` reports it beside `last()`.
//
// A frame's operation list holds what that frame issued and nothing it began
// under. Three pieces of context state are ordinary to set once and rely on ever
// after: the font a build chooses at start-up, the letterbox fit an engineless
// build issues as a `setTransform` on load and on `resize`, and the
// `imageSmoothingEnabled` it turns off when it builds its context. A walk over the
// frame's own operations that started from the canvas's defaults would measure
// that build's text in `10px sans-serif`, place every one of its blits at the
// logical position of the draw rather than where the fit put it, and report every
// one of them as smoothed. So the recorder reads the live context as each frame
// opens, and a check's walk starts there.
//
// THE RESET IS THE CASE THAT DECIDES WHEN THE READ HAPPENS. A build that sizes
// its canvas inside the frame resets the context, and the recorder drops the
// operations before the resize because the wipe erased what they drew. What
// survives was issued under the state the reset left, so the inherited state has
// to be taken again there — a read off the context before the frame would report
// the previous frame's fit, and a walk from it would apply that fit twice over a
// build that scales relative to the identity every frame.
//
// DRIVEN ENTIRELY INSIDE ONE `page.evaluate`, ON A CANVAS OF THIS SUITE'S OWN,
// for the reason the sibling recorder suites are: no animation frame can
// interrupt a synchronous evaluation, so what each frame holds is stated by the
// scenario alone. The canvas is created larger than the fixture's own so the
// recorder's search starts at it.

import { afterEach, expect, it } from "vitest";
import type { RecordedOp } from "../src/index";

import { createHarness, type Harness } from "./fixture";

/** How the scenario moves the context between and inside frames. */
type Shape =
  /** The fit, the font and the flag are set once, before any frame. */
  | "set-once"
  /** The same, and the frame then re-issues the fit itself. */
  | "re-issued"
  /** The same, and the frame resizes the canvas before it draws. */
  | "resized-inside"
  /** The same, and the frame calls `reset()` before it draws. */
  | "reset-inside";

/** What the recorder reported for the last frame. */
interface Read {
  inherited: {
    font?: unknown;
    textAlign?: unknown;
    transform?: unknown;
    imageSmoothingEnabled?: unknown;
  } | null;
  lastOps: RecordedOp[];
}

/** The fit the scenario sets: a scale of two, offset to centre a narrower stage. */
const FIT = [2, 0, 0, 2, 40, 10] as const;

const open: Harness[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.dispose()));
});

async function record(shape: Shape): Promise<Read> {
  const h = await createHarness();
  open.push(h);
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
            lastInherited(): unknown;
            disarm(): unknown;
          };
        }
      ).__tcabRec;

      const shown = document.querySelector("canvas");
      const width = (shown === null ? 0 : shown.width) + 64;
      const height = (shown === null ? 0 : shown.height) + 64;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.style.position = "absolute";
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");

      if (!rec.arm({ width, height, background: "#101820" })) {
        throw new Error("the recorder bound to nothing");
      }

      // Set once, outside any frame: the shape every scenario shares.
      ctx.setTransform(...spec.fit);
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.imageSmoothingEnabled = false;

      const frame = () => {
        if (spec.shape === "resized-inside") {
          ctx.fillRect(0, 0, 1, 1);
          canvas.width = width;
        }
        if (spec.shape === "reset-inside") ctx.reset();
        if (spec.shape === "re-issued") ctx.setTransform(...spec.fit);
        ctx.fillStyle = "#ffcc00";
        ctx.fillRect(10, 10, 20, 20);
        ctx.fillText("hi", 30, 30);
      };
      // Two frames, so the read is of a frame that inherited what the one before
      // it left rather than the state set up by hand.
      for (let at = 0; at < 2; at += 1) {
        rec.begin();
        frame();
        rec.end(16);
      }
      const lastOps = rec.last();
      const inherited = rec.lastInherited();
      rec.disarm();
      return { inherited, lastOps } as Read;
    },
    { shape, fit: FIT },
  );
}

/** The methods the last frame issued, in order. */
function methods(read: Read): string[] {
  return read.lastOps
    .filter((op) => (op as { op: string }).op === "call")
    .map((op) => (op as { method: string }).method);
}

it("reports the fit, the font and the smoothing flag a frame inherited from outside every frame", async () => {
  const read = await record("set-once");
  expect(methods(read)).toEqual(["fillRect", "fillText"]);
  expect(read.inherited).toMatchObject({
    font: "20px monospace",
    textAlign: "center",
    transform: [...FIT],
    imageSmoothingEnabled: false,
  });
});

it("reports the same when the frame re-issues the fit itself", async () => {
  const read = await record("re-issued");
  expect(methods(read)).toEqual(["setTransform", "fillRect", "fillText"]);
  expect(read.inherited).toMatchObject({ transform: [...FIT] });
});

it("reads the inherited state again after a resize inside the frame", async () => {
  const read = await record("resized-inside");
  // The draw before the resize was wiped with the pixels it painted.
  expect(methods(read)).toEqual(["fillRect", "fillText"]);
  expect(read.inherited).toMatchObject({
    font: "10px sans-serif",
    textAlign: "start",
    transform: [1, 0, 0, 1, 0, 0],
    imageSmoothingEnabled: true,
  });
});

it("reads the inherited state again after a reset inside the frame", async () => {
  const read = await record("reset-inside");
  expect(methods(read)).toEqual(["reset", "fillRect", "fillText"]);
  expect(read.inherited).toMatchObject({
    transform: [1, 0, 0, 1, 0, 0],
    imageSmoothingEnabled: true,
  });
});
