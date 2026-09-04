import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReplayResources } from "./drawFrame";
import { ReplayCanvas } from "./ReplayPlayer";
import { RECORDING_FORMAT, type Recording } from "./format";

/**
 * What a canvas says about the picture beside it.
 *
 * A replay is evidence a reviewer writes a verdict against, so the gap between what
 * the build drew and what they are looking at has to be on screen, named, and
 * counted honestly. That gap is not only the frame's own operations: a style
 * property the frame inherited, or a step of the clip or the path it opened with,
 * costs the reviewer the same thing and is counted the same way, so the sentence
 * under the canvas cannot call the count a count of operations.
 *
 * jsdom has no canvas backend — `src/test/setup.ts` answers `getContext` with
 * `null` — so the context is stubbed here. What it draws is not under test; the
 * drawing has its own tests next door.
 */

/** How `getContext` answers where a test has not given the canvas a backend. */
const NO_CANVAS = HTMLCanvasElement.prototype.getContext;

/**
 * Give every canvas a context that accepts whatever a frame issues at it.
 *
 * The style properties are on the target rather than synthesised by the `get`
 * trap, because the player refuses an assignment to a name the subject does not
 * carry as a writable property of its own — that is what keeps a recorded
 * `ctx.__proto__ = null` from destroying a reviewer's context. A stub standing in
 * for a context has to carry the names a real one does, or every inherited
 * property would be reported as a property this context has not got instead of
 * being assigned.
 */
function stubCanvas(): void {
  const ctx = new Proxy(
    {
      canvas: { width: 800, height: 600 },
      fillStyle: "#000000" as unknown,
      strokeStyle: "#000000" as unknown,
      font: "10px sans-serif",
      lineWidth: 1,
    },
    {
      get: (target, property) =>
        property in target
          ? Reflect.get(target, property)
          : () => {
              /* every drawing call is accepted and none is asserted on */
            },
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as typeof NO_CANVAS;
}

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = NO_CANVAS;
});

/**
 * A one-frame recording drawing `ops` operations, under inherited state `state`.
 *
 * State 0 carries nothing; state 1 inherits a fill the recorder could not carry,
 * which is a loss that belongs to no operation of the frame.
 */
function recording(ops: number, state = 0): Recording {
  return {
    format: RECORDING_FORMAT,
    width: 800,
    height: 600,
    background: null,
    images: [],
    resources: [],
    ops: [
      { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
      {
        op: "call",
        method: "drawImage",
        args: [{ $opaque: "ImageBitmap" }, 0, 0],
      },
    ],
    states: [
      { properties: {}, transform: null, lineDash: null, clip: [], path: [] },
      {
        properties: { fillStyle: { $opaque: "CanvasPattern" } },
        transform: null,
        lineDash: null,
        clip: [],
        path: [],
      },
    ],
    frames: [
      {
        count: 0,
        timeMs: 16,
        deltaMs: 16,
        surface: { width: 800, height: 600 },
        state,
        stack: [],
        ops: ops === 1 ? [0] : [0, 1],
      },
    ],
  };
}

/** The decoded image table of a recording that draws none. */
function resources(): ReplayResources {
  return { images: [] };
}

describe("what a replay canvas reports", () => {
  it("says nothing under a frame it reproduced whole", () => {
    stubCanvas();
    render(
      <ReplayCanvas
        recording={recording(1)}
        resources={resources()}
        frame={0}
        label="This run"
      />,
    );
    expect(screen.queryByText(/could not/i)).not.toBeInTheDocument();
  });

  it("names what this frame lost, and counts it as a part rather than an operation", () => {
    stubCanvas();
    render(
      <ReplayCanvas
        recording={recording(2)}
        resources={resources()}
        frame={0}
        label="This run"
      />,
    );
    const note = screen.getByText(/ImageBitmap/);
    expect(note).toHaveTextContent(
      "1 part of this frame could not be reproduced",
    );
    expect(note).not.toHaveTextContent("operation");
  });

  it("counts a lost part of the state the frame inherited, not only its operations", () => {
    // The pattern this frame inherited as its fill is not one of its operations,
    // and it is the whole difference between the picture the build drew and the
    // picture on screen. A count that named only operations would report this
    // frame as having lost nothing while it draws under the wrong fill.
    stubCanvas();
    render(
      <ReplayCanvas
        recording={recording(1, 1)}
        resources={resources()}
        frame={0}
        label="This run"
      />,
    );
    const note = screen.getByText(/CanvasPattern/);
    expect(note).toHaveTextContent(
      "1 part of this frame could not be reproduced",
    );
  });
});
