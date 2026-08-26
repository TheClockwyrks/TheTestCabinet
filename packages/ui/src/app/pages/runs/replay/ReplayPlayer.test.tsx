import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayResources } from "./drawFrame";
import type { Replay3dResources } from "./drawFrame3d";
import { ReplayCanvas, ReplayPlayer } from "./ReplayPlayer";
import { RECORDING_FORMAT, type Recording } from "./format";
import type { Recording3d } from "./format3d";

// The 3D pane is stubbed rather than driven: it is `React.lazy`-loaded and
// draws through WebGL, and jsdom has neither a chunk loader worth exercising
// nor a GPU. What is under test here is the DISPATCH — that a document stating
// `"3d"` reaches the 3D pane, that one stating no space reaches the 2D canvas,
// and that a document stating a space this player does not draw reaches
// neither. What the 3D pane then draws has its own tests next door, against a
// scene stub.
vi.mock("./Replay3dCanvas", () => ({
  default: ({ label }: { label: string }) => <p>the 3D pane drawing {label}</p>,
}));

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

/** The fetch a test that serves its own replay stands in for. */
const REAL_FETCH = globalThis.fetch;

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
  globalThis.fetch = REAL_FETCH;
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

/** A one-frame 3D recording that draws one line. */
function recording3d(): Recording3d {
  return {
    format: RECORDING_FORMAT,
    space: "3d",
    width: 800,
    height: 600,
    background: null,
    assets: [],
    resources: [],
    ops: [
      {
        op: "call",
        method: "drawLine",
        args: [
          [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          "#ffffff",
        ],
      },
    ],
    states: [
      {
        camera: {
          position: { x: 0, y: 0, z: 10 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          fovY: 1,
          near: 0.1,
          far: 1000,
        },
        lights: [],
        mode: "standard",
      },
    ],
    frames: [
      {
        count: 0,
        timeMs: 16,
        deltaMs: 16,
        surface: { width: 800, height: 600 },
        state: 0,
        ops: [0],
      },
    ],
  };
}

/** The decoded asset table of a 3D recording that draws none. */
function assets(): Replay3dResources {
  return { assets: [] };
}

describe("which drawer a recording reaches", () => {
  it("draws a document that states no space on the 2D canvas", () => {
    stubCanvas();
    render(
      <ReplayCanvas
        recording={recording(1)}
        resources={resources()}
        frame={0}
        label="This run"
      />,
    );
    expect(screen.getByRole("img", { name: "This run" }).tagName).toBe(
      "CANVAS",
    );
    expect(screen.queryByText(/3D pane/)).not.toBeInTheDocument();
  });

  it("hands a document that states 3D to the scene drawer's pane", async () => {
    render(
      <ReplayCanvas
        recording={recording3d()}
        resources={assets()}
        frame={0}
        label="This run"
      />,
    );
    expect(
      await screen.findByText("the 3D pane drawing This run"),
    ).toBeInTheDocument();
  });

  it("says so rather than drawing when the decoded values are of the other space", () => {
    // Unreachable through the loader, which builds both halves from one
    // document — and a pane that drew a 3D recording against a 2D table would
    // resolve every asset to the wrong picture and report itself clean.
    stubCanvas();
    render(
      <ReplayCanvas
        recording={recording3d()}
        resources={resources()}
        frame={0}
        label="This run"
      />,
    );
    expect(
      screen.getByText(/drawing space other than the one it states/),
    ).toBeInTheDocument();
  });
});

describe("a document this player cannot draw", () => {
  /** Serve `body` as the replay at every URL. */
  function serve(body: unknown): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  }

  it("names the drawing space it states rather than drawing it as 2D", async () => {
    serve({ format: RECORDING_FORMAT, space: "4d", frames: [] });
    render(<ReplayPlayer url="/replay.json.gz" label="This run" />);
    const message = await screen.findByText(/drawing space "4d"/);
    expect(message).toHaveTextContent("This replay cannot be played.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("names a format it does not know", async () => {
    serve({ format: 99, frames: [] });
    render(<ReplayPlayer url="/replay.json.gz" label="This run" />);
    expect(await screen.findByText(/format 99/)).toBeInTheDocument();
  });
});
