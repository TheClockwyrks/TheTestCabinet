import { describe, expect, it, vi } from "vitest";
import { drawFrame3d, prepareRecording3d } from "./drawFrame3d";
import type { Asset3dDecoder, Replay3dResources } from "./drawFrame3d";
import { RECORDING_FORMAT } from "./format";
import type {
  CameraState,
  CapturedAsset,
  DrawOp3d,
  DrawValue3d,
  LightState,
  RecordedFrame3d,
  Recording3d,
  RenderState3d,
  Resource3d,
} from "./format3d";
import type {
  DecodedMesh,
  DecodedTexture,
  SceneDrawer3d,
} from "./sceneDrawer3d";

/**
 * Replaying one frame of a 3D recording against a hand-written scene.
 *
 * The scene is a stub rather than a renderer because what a player has to get
 * right is not the pixels — a renderer draws those — but WHICH draws reach the
 * scene, in what order, and with what values. In 3D the order is half the
 * picture: the state setters and the depth clear divide a frame into runs,
 * translucent draws follow their own run's opaque ones farthest-first, and the
 * HUD composites last across the whole frame. A stub answers all of that
 * exactly; a rendered bitmap answers it by inference, and only on a machine
 * with a GPU.
 *
 * The property under test throughout is the one the whole format exists for: a
 * frame is drawn from itself, completely. Landing on frame 900 must issue frame
 * 900's operations and nobody else's, under the camera, lights and mode frame
 * 900 inherited.
 */

/** One call the scene received, with the arguments it received. */
interface SceneCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

interface Stub {
  readonly scene: SceneDrawer3d;
  /** Every call, in the order the scene saw them. */
  readonly calls: SceneCall[];
  /** The same calls as `method` names, which is what an order assertion reads. */
  readonly log: string[];
}

/**
 * A scene that records what actually reached it.
 *
 * The six producers answer a tagged plain object rather than a geometry: the
 * drawer treats a produced value as opaque and only ever hands it back, so what
 * it is made of is exactly what a test can assert on. `refuse` names verbs that
 * should throw, which is how a renderer reports a draw it cannot make.
 */
function sceneStub(
  options: {
    readonly refuse?: readonly string[];
    readonly produceNothing?: boolean;
  } = {},
): Stub {
  const calls: SceneCall[] = [];
  const log: string[] = [];
  const refuse = new Set(options.refuse ?? []);
  const note = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
    log.push(method);
    if (refuse.has(method)) throw new Error(`the scene refuses ${method}`);
  };
  const produce = (method: string, ...args: unknown[]): unknown => {
    note(method, ...args);
    return options.produceNothing === true ? null : { made: method, args };
  };
  const scene: SceneDrawer3d = {
    blank: (surface, design, background) =>
      note("blank", surface, design, background),
    setCamera: (camera) => note("setCamera", camera),
    setLights: (lights) => note("setLights", lights),
    setMode: (mode) => note("setMode", mode),
    clearDepth: () => note("clearDepth"),
    drawMesh: (mesh, transform, opts) =>
      note("drawMesh", mesh, transform, opts),
    drawGeometry: (geometry, material, transform) =>
      note("drawGeometry", geometry, material, transform),
    drawBillboard: (texture, position, size) =>
      note("drawBillboard", texture, position, size),
    drawLine: (points, color) => note("drawLine", points, color),
    drawHudText: (text, position, opts) =>
      note("drawHudText", text, position, opts),
    drawHudRect: (position, size, color) =>
      note("drawHudRect", position, size, color),
    createBox: (size) => produce("createBox", size),
    createSphere: (radius) => produce("createSphere", radius),
    createCylinder: (radius, height) =>
      produce("createCylinder", radius, height),
    createCapsule: (radius, height) => produce("createCapsule", radius, height),
    createPlane: (width, depth) => produce("createPlane", width, depth),
    createMaterial: (material) => produce("createMaterial", material),
    render: () => note("render"),
  };
  return { scene, calls, log };
}

/** The identity placement, which most draws in these tests use. */
const HERE = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/** A placement at a world point. */
function at(x: number, y: number, z: number) {
  return { ...HERE, position: { x, y, z } };
}

/** A camera sitting at the origin, looking down −Z. */
const CAMERA: CameraState = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  fovY: Math.PI / 3,
  near: 0.1,
  far: 1000,
};

/** The state a fresh engine holds. */
const STATE: RenderState3d = { camera: CAMERA, lights: [], mode: "standard" };

/** One frame naming every operation of the recording, in order. */
function frames(
  ops: readonly DrawOp3d[],
  state = 0,
  extra: Partial<RecordedFrame3d> = {},
): readonly RecordedFrame3d[] {
  return [
    {
      count: 0,
      timeMs: 16,
      deltaMs: 16,
      surface: { width: 800, height: 600 },
      state,
      ops: ops.map((_, i) => i),
      ...extra,
    },
  ];
}

/** A one-frame recording of `ops`, with whatever tables it needs. */
function recording(
  ops: readonly DrawOp3d[],
  parts: Partial<Recording3d> = {},
): Recording3d {
  return {
    format: RECORDING_FORMAT,
    space: "3d",
    width: 800,
    height: 600,
    background: null,
    assets: [],
    resources: [],
    states: [STATE],
    ...parts,
    ops,
    frames: parts.frames ?? frames(ops, 0),
  };
}

/** A call operation. */
function call(method: string, ...args: DrawValue3d[]): DrawOp3d {
  return { op: "call", method, args };
}

/** No assets decoded, for a recording that draws none. */
const NOTHING: Replay3dResources = { assets: [] };

/** A decoded mesh, as `prepareRecording3d` hands one on. */
function mesh(
  path = "meshes/crate.glb",
  extra: Partial<DecodedMesh> = {},
): DecodedMesh {
  return {
    kind: "mesh",
    path,
    translucent: false,
    clips: ["walk"],
    value: `parsed:${path}`,
    ...extra,
  };
}

/** A decoded texture. */
function texture(path = "textures/brick.png"): DecodedTexture {
  return {
    kind: "texture",
    path,
    width: 2,
    height: 2,
    value: `pixels:${path}`,
  };
}

/** Draw the recording's only frame, reporting what the scene saw. */
function draw(
  recording3d: Recording3d,
  resources: Replay3dResources = NOTHING,
  frame = 0,
): { stub: Stub; report: ReturnType<typeof drawFrame3d> } {
  const stub = sceneStub();
  const report = drawFrame3d(stub.scene, recording3d, resources, frame);
  return { stub, report };
}

describe("re-issuing the scene vocabulary", () => {
  it("opens a frame by blanking the surface it was recorded into", () => {
    const { stub } = draw(recording([], { background: "#101010" }));
    expect(stub.calls[0]).toEqual({
      method: "blank",
      args: [
        { width: 800, height: 600 },
        { width: 800, height: 600 },
        "#101010",
      ],
    });
  });

  it("blanks at the design size when the frame recorded no surface", () => {
    // A recording taken before the canvas was laid out carries a zero-sized
    // surface, and the player sizes its canvas by the same fallback.
    const doc = recording([], {
      frames: frames([], 0).map((frame) => ({
        ...frame,
        surface: { width: 0, height: 0 },
      })),
    });
    const { stub } = draw(doc);
    expect(stub.calls[0]?.args[0]).toEqual({ width: 800, height: 600 });
  });

  it("applies the inherited state as the mode, the camera, then the lights", () => {
    const lit: RenderState3d = {
      camera: CAMERA,
      lights: [{ type: "ambient", color: "#ffffff", intensity: 0.5 }],
      mode: "unlit",
    };
    const { stub } = draw(recording([], { states: [lit] }));
    expect(stub.log).toEqual([
      "blank",
      "setMode",
      "setCamera",
      "setLights",
      "render",
    ]);
    expect(stub.calls[1]?.args[0]).toBe("unlit");
    expect(stub.calls[3]?.args[0]).toEqual(lit.lights);
  });

  it("re-issues each of the ten verbs with the arguments the build passed", () => {
    const doc = recording(
      [
        call("setCamera", CAMERA as unknown as DrawValue3d),
        call("setLights", [
          {
            type: "point",
            color: "#ff0000",
            intensity: 2,
            position: { x: 1, y: 2, z: 3 },
            range: 9,
          },
        ] as unknown as DrawValue3d),
        call("setMode", "wireframe"),
        call("clearDepth"),
        call("drawMesh", { $asset: 0 }, HERE),
        call("drawGeometry", { $res: 0 }, "#00ff00", HERE),
        call(
          "drawBillboard",
          { $asset: 1 },
          { x: 0, y: 1, z: 0 },
          { x: 2, y: 2 },
        ),
        call(
          "drawLine",
          [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 1, z: 1 },
          ],
          "#ffffff",
        ),
        call(
          "drawHudText",
          "score",
          { x: 8, y: 8 },
          { size: 32, align: "right" },
        ),
        call("drawHudRect", { x: 0, y: 0 }, { x: 10, y: 4 }, "#000000"),
      ],
      {
        assets: [
          { kind: "mesh", path: "m.glb", data: "AA==" },
          {
            kind: "texture",
            path: "t.png",
            width: 1,
            height: 1,
            src: "data:,",
          },
        ],
        resources: [
          {
            make: { method: "createBox", args: [{ x: 1, y: 1, z: 1 }] },
            then: [],
          },
        ],
      },
    );
    const resources: Replay3dResources = {
      assets: [mesh("m.glb"), texture("t.png")],
    };
    const { stub, report } = draw(doc, resources);

    expect(report.skipped).toBe(0);
    expect(report.drawn).toBe(10);
    expect(stub.log).toEqual([
      "blank",
      "setMode",
      "setCamera",
      "setLights",
      "setCamera",
      "setLights",
      "setMode",
      "clearDepth",
      "createBox",
      "drawMesh",
      "drawGeometry",
      "drawLine",
      "drawBillboard",
      "drawHudText",
      "drawHudRect",
      "render",
    ]);

    const seen = (method: string): SceneCall =>
      stub.calls.filter((entry) => entry.method === method).at(-1) as SceneCall;
    expect(seen("setMode").args[0]).toBe("wireframe");
    expect(seen("drawMesh").args[0]).toBe(resources.assets[0]);
    expect(seen("drawMesh").args[2]).toEqual({
      material: null,
      clip: null,
      clipTime: 0,
    });
    expect(seen("drawGeometry").args[0]).toEqual({
      made: "createBox",
      args: [{ x: 1, y: 1, z: 1 }],
    });
    expect(seen("drawGeometry").args[1]).toMatchObject({
      baseColor: "#00ff00",
      roughness: 0.8,
      metallic: 0,
      opacity: 1,
      unlit: false,
    });
    expect(seen("drawBillboard").args[0]).toBe(resources.assets[1]);
    expect(seen("drawLine").args[0]).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    ]);
    expect(seen("drawHudText").args[2]).toEqual({
      size: 32,
      color: "#ffffff",
      align: "right",
    });
  });

  it("fills a mesh draw's options in as the engine does", () => {
    const doc = recording(
      [
        call("drawMesh", { $asset: 0 }, HERE, {
          material: "#ff00ff",
          clip: "walk",
          clipTime: 1.5,
        }),
      ],
      {
        assets: [{ kind: "mesh", path: "m.glb", data: "AA==" }],
      },
    );
    const { stub, report } = draw(doc, { assets: [mesh("m.glb")] });
    expect(report.skipped).toBe(0);
    expect(stub.calls.at(-2)?.args[2]).toMatchObject({
      clip: "walk",
      clipTime: 1.5,
      material: { baseColor: "#ff00ff", opacity: 1 },
    });
  });

  it("reports a clip the mesh does not carry rather than posing the rest pose", () => {
    const doc = recording(
      [call("drawMesh", { $asset: 0 }, HERE, { clip: "swim" })],
      {
        assets: [{ kind: "mesh", path: "m.glb", data: "AA==" }],
      },
    );
    const { stub, report } = draw(doc, { assets: [mesh("m.glb")] });
    expect(report.unreproducible).toEqual(["drawMesh()"]);
    expect(stub.log).not.toContain("drawMesh");
  });

  it("skips a verb this player has not got, and names it", () => {
    const { stub, report } = draw(recording([call("drawTeapot", 1)]));
    expect(report).toMatchObject({ drawn: 0, skipped: 1 });
    expect(report.unreproducible).toEqual(["drawTeapot()"]);
    expect(stub.log).toEqual([
      "blank",
      "setMode",
      "setCamera",
      "setLights",
      "render",
    ]);
  });

  it("reports an assignment rather than hanging a name on the scene it draws through", () => {
    // No recorder writes one — the scene context declares no assignable
    // properties — but the format carries `set`, so a document from elsewhere
    // can. Performing it is what a drawing object does not survive.
    const doc = recording([{ op: "set", property: "__proto__", value: null }]);
    const { stub, report } = draw(doc);
    expect(report.unreproducible).toEqual(["the __proto__ property"]);
    expect(stub.log).toContain("render");
  });

  it("reports an operation the recording does not carry rather than drawing on", () => {
    const doc = recording([call("clearDepth")], {
      frames: frames([call("clearDepth")], 0).map((frame) => ({
        ...frame,
        ops: [0, 7],
      })),
    });
    const { report } = draw(doc);
    expect(report.drawn).toBe(1);
    expect(report.unreproducible).toEqual([
      "a value this replay does not carry",
    ]);
  });

  it("issues a draw the scene refuses as a loss of that draw alone", () => {
    const stub = sceneStub({ refuse: ["drawLine"] });
    const doc = recording([
      call(
        "drawLine",
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        "#fff",
      ),
      call("drawHudRect", { x: 0, y: 0 }, { x: 1, y: 1 }, "#000"),
    ]);
    const report = drawFrame3d(stub.scene, doc, NOTHING, 0);
    expect(report).toMatchObject({ drawn: 1, skipped: 1 });
    expect(report.unreproducible).toEqual(["drawLine()"]);
    expect(stub.log).toContain("drawHudRect");
  });
});

describe("the order a frame composites in", () => {
  it("draws the opaque draws in issue order", () => {
    const doc = recording(
      [
        call("drawGeometry", { $res: 0 }, "#111111", at(0, 0, -1)),
        call("drawGeometry", { $res: 0 }, "#222222", at(0, 0, -9)),
        call("drawGeometry", { $res: 0 }, "#333333", at(0, 0, -5)),
      ],
      {
        resources: [{ make: { method: "createSphere", args: [1] }, then: [] }],
      },
    );
    const { stub } = draw(doc);
    const colors = stub.calls
      .filter((entry) => entry.method === "drawGeometry")
      .map((entry) => (entry.args[1] as { baseColor: string }).baseColor);
    expect(colors).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("draws the translucent draws after the opaque ones, farthest first", () => {
    const doc = recording(
      [
        call("drawGeometry", { $res: 0 }, { $res: 1 }, at(0, 0, -2)),
        call("drawGeometry", { $res: 0 }, "#ffffff", at(0, 0, -50)),
        call("drawGeometry", { $res: 0 }, { $res: 1 }, at(0, 0, -20)),
      ],
      {
        resources: [
          {
            make: { method: "createBox", args: [{ x: 1, y: 1, z: 1 }] },
            then: [],
          },
          {
            make: {
              method: "createMaterial",
              args: [{ baseColor: "#00ffff", opacity: 0.5 }],
            },
            then: [],
          },
        ],
      },
    );
    const { stub } = draw(doc);
    const zs = stub.calls
      .filter((entry) => entry.method === "drawGeometry")
      .map(
        (entry) => (entry.args[2] as { position: { z: number } }).position.z,
      );
    // The opaque draw first, however near it is; then the two translucent
    // draws, the farther one first.
    expect(zs).toEqual([-50, -20, -2]);
  });

  it("holds issue order between two translucent draws at the same distance", () => {
    const doc = recording(
      [
        call(
          "drawBillboard",
          { $asset: 0 },
          { x: 3, y: 0, z: 0 },
          { x: 1, y: 1 },
        ),
        call(
          "drawBillboard",
          { $asset: 1 },
          { x: -3, y: 0, z: 0 },
          { x: 1, y: 1 },
        ),
      ],
      {
        assets: [
          {
            kind: "texture",
            path: "a.png",
            width: 1,
            height: 1,
            src: "data:,",
          },
          {
            kind: "texture",
            path: "b.png",
            width: 1,
            height: 1,
            src: "data:,",
          },
        ],
      },
    );
    const { stub } = draw(doc, {
      assets: [texture("a.png"), texture("b.png")],
    });
    const paths = stub.calls
      .filter((entry) => entry.method === "drawBillboard")
      .map((entry) => (entry.args[0] as DecodedTexture).path);
    expect(paths).toEqual(["a.png", "b.png"]);
  });

  it("sorts a line by its first point, and a billboard however opaque its texture", () => {
    const doc = recording(
      [
        // A billboard is translucent whatever it carries; the line is opaque,
        // because its colour is.
        call(
          "drawBillboard",
          { $asset: 0 },
          { x: 0, y: 0, z: -1 },
          { x: 1, y: 1 },
        ),
        call(
          "drawLine",
          [
            { x: 0, y: 0, z: -80 },
            { x: 0, y: 0, z: 0 },
          ],
          "#ffffff",
        ),
        call(
          "drawLine",
          [
            { x: 0, y: 0, z: -40 },
            { x: 0, y: 0, z: 0 },
          ],
          "#ffffff80",
        ),
      ],
      {
        assets: [
          {
            kind: "texture",
            path: "a.png",
            width: 1,
            height: 1,
            src: "data:,",
          },
        ],
      },
    );
    const { stub } = draw(doc, { assets: [texture("a.png")] });
    // Opaque first (the white line), then the translucent draws farthest
    // first: the half-transparent line at −40 sorts by its FIRST point, so it
    // comes before the billboard at −1.
    expect(stub.log.filter((method) => method.startsWith("draw"))).toEqual([
      "drawLine",
      "drawLine",
      "drawBillboard",
    ]);
    const lines = stub.calls.filter((entry) => entry.method === "drawLine");
    expect(lines[0]?.args[1]).toBe("#ffffff");
    expect(lines[1]?.args[1]).toBe("#ffffff80");
  });

  it("sorts each run under the camera that run was issued with", () => {
    const far: CameraState = { ...CAMERA, position: { x: 0, y: 0, z: -100 } };
    const doc = recording(
      [
        call(
          "drawBillboard",
          { $asset: 0 },
          { x: 0, y: 0, z: -1 },
          { x: 1, y: 1 },
        ),
        call(
          "drawBillboard",
          { $asset: 1 },
          { x: 0, y: 0, z: -9 },
          { x: 1, y: 1 },
        ),
        call("setCamera", far as unknown as DrawValue3d),
        call(
          "drawBillboard",
          { $asset: 2 },
          { x: 0, y: 0, z: -1 },
          { x: 1, y: 1 },
        ),
        call(
          "drawBillboard",
          { $asset: 3 },
          { x: 0, y: 0, z: -9 },
          { x: 1, y: 1 },
        ),
      ],
      {
        assets: [0, 1, 2, 3].map((i) => ({
          kind: "texture" as const,
          path: `${i}.png`,
          width: 1,
          height: 1,
          src: "data:,",
        })),
      },
    );
    const { stub } = draw(doc, {
      assets: [
        texture("0.png"),
        texture("1.png"),
        texture("2.png"),
        texture("3.png"),
      ],
    });
    const paths = stub.calls
      .filter((entry) => entry.method === "drawBillboard")
      .map((entry) => (entry.args[0] as DecodedTexture).path);
    // From the origin the far billboard sorts first; from z = −100 the nearer
    // one to the ORIGIN is the farther one from the camera, so the order flips.
    expect(paths).toEqual(["1.png", "0.png", "2.png", "3.png"]);
  });

  it("closes a run at a depth clear, so nothing crosses it", () => {
    const doc = recording(
      [
        call(
          "drawBillboard",
          { $asset: 0 },
          { x: 0, y: 0, z: -1 },
          { x: 1, y: 1 },
        ),
        call("clearDepth"),
        call(
          "drawBillboard",
          { $asset: 1 },
          { x: 0, y: 0, z: -90 },
          { x: 1, y: 1 },
        ),
      ],
      {
        assets: [0, 1].map((i) => ({
          kind: "texture" as const,
          path: `${i}.png`,
          width: 1,
          height: 1,
          src: "data:,",
        })),
      },
    );
    const { stub } = draw(doc, {
      assets: [texture("0.png"), texture("1.png")],
    });
    // The far billboard is issued after the clear even though it is farther:
    // sorting happens inside a run, and the clear ended the first one.
    expect(stub.log.slice(4)).toEqual([
      "drawBillboard",
      "clearDepth",
      "drawBillboard",
      "render",
    ]);
  });

  it("composites the HUD last, in issue order, across every run", () => {
    const doc = recording(
      [
        call("drawHudRect", { x: 0, y: 0 }, { x: 1, y: 1 }, "#000000"),
        call("drawGeometry", { $res: 0 }, "#ffffff", HERE),
        call("setMode", "unlit"),
        call("drawHudText", "second", { x: 0, y: 0 }),
        call("drawGeometry", { $res: 0 }, "#ffffff", HERE),
      ],
      {
        resources: [
          { make: { method: "createPlane", args: [1, 1] }, then: [] },
        ],
      },
    );
    const { stub } = draw(doc);
    expect(stub.log.slice(4)).toEqual([
      "createPlane",
      "drawGeometry",
      "setMode",
      "drawGeometry",
      "drawHudRect",
      "drawHudText",
      "render",
    ]);
  });
});

describe("the lights a frame is lit by", () => {
  /** `count` ambient lights, distinguishable by intensity. */
  function lights(count: number): LightState[] {
    return Array.from({ length: count }, (_, i) => ({
      type: "ambient" as const,
      color: "#ffffff",
      intensity: i,
    }));
  }

  it("keeps the first sixty-four of a longer list the build set", () => {
    const doc = recording([
      call("setLights", lights(70) as unknown as DrawValue3d),
    ]);
    const { stub } = draw(doc);
    const applied = stub.calls
      .filter((entry) => entry.method === "setLights")
      .at(-1);
    expect((applied?.args[0] as readonly LightState[]).length).toBe(64);
    expect((applied?.args[0] as LightState[])[63]?.intensity).toBe(63);
  });

  it("reports a frame whose inherited list the recorder had to cut down", () => {
    const doc = recording([], {
      states: [{ camera: CAMERA, lights: lights(64), mode: "standard" }],
      frames: frames([], 0, { truncated: true }),
    });
    const { report } = draw(doc);
    expect(report.unreproducible).toEqual([
      "a light list longer than this format carries",
    ]);
  });

  it("says nothing about a frame the recorder carried whole", () => {
    const doc = recording([], {
      states: [{ camera: CAMERA, lights: lights(64), mode: "standard" }],
    });
    expect(draw(doc).report.skipped).toBe(0);
  });

  it("reports an inherited state the recording does not carry, and draws on", () => {
    const doc = recording([call("clearDepth")], {
      frames: frames([call("clearDepth")], 3),
    });
    const { stub, report } = draw(doc);
    expect(report.unreproducible).toEqual(["the state this frame inherited"]);
    expect(report.drawn).toBe(1);
    // A fresh engine's own defaults, so the frame's operations still draw.
    expect(stub.calls[1]?.args[0]).toBe("standard");
    expect(stub.calls[2]?.args[0]).toMatchObject({
      position: { x: 0, y: 0, z: 10 },
    });
  });
});

describe("values the scene produced", () => {
  it("rebuilds a geometry from the call that created it", () => {
    const doc = recording([call("drawGeometry", { $res: 0 }, "#fff", HERE)], {
      resources: [
        { make: { method: "createCapsule", args: [0.5, 2] }, then: [] },
      ],
    });
    const { stub, report } = draw(doc);
    expect(report.skipped).toBe(0);
    expect(
      stub.calls.find((entry) => entry.method === "createCapsule")?.args,
    ).toEqual([0.5, 2]);
  });

  it("issues each of the six producers with the arguments its recipe carries", () => {
    const doc = recording(
      [0, 1, 2, 3, 4].map((i) =>
        call("drawGeometry", { $res: i }, { $res: 5 }, HERE),
      ),
      {
        resources: [
          {
            make: { method: "createBox", args: [{ x: 1, y: 2, z: 3 }] },
            then: [],
          },
          { make: { method: "createSphere", args: [4] }, then: [] },
          { make: { method: "createCylinder", args: [1, 5] }, then: [] },
          { make: { method: "createCapsule", args: [1, 6] }, then: [] },
          { make: { method: "createPlane", args: [7, 8] }, then: [] },
          {
            make: {
              method: "createMaterial",
              args: [{ baseColor: "#abcdef" }],
            },
            then: [],
          },
        ],
      },
    );
    const { stub, report } = draw(doc);
    expect(report.skipped).toBe(0);
    expect(stub.log.filter((m) => m.startsWith("create"))).toEqual([
      "createBox",
      "createMaterial",
      "createSphere",
      "createCylinder",
      "createCapsule",
      "createPlane",
    ]);
    expect(
      stub.calls.find((entry) => entry.method === "createMaterial")?.args[0],
    ).toMatchObject({ baseColor: "#abcdef", roughness: 0.8 });
  });

  it("builds a resource once a frame, however many draws name it", () => {
    const doc = recording(
      Array.from({ length: 5 }, () =>
        call("drawGeometry", { $res: 0 }, "#fff", HERE),
      ),
      {
        resources: [{ make: { method: "createSphere", args: [1] }, then: [] }],
      },
    );
    const { stub } = draw(doc);
    expect(stub.log.filter((m) => m === "createSphere")).toHaveLength(1);
  });

  it("seeks straight to a late frame and draws it under a material created long before it", () => {
    const ops = [call("drawGeometry", { $res: 0 }, { $res: 1 }, HERE)];
    const doc: Recording3d = {
      ...recording(ops, {
        resources: [
          {
            make: { method: "createBox", args: [{ x: 1, y: 1, z: 1 }] },
            then: [],
          },
          {
            make: {
              method: "createMaterial",
              args: [{ baseColor: "#123456" }],
            },
            then: [],
          },
        ],
      }),
      frames: Array.from({ length: 900 }, (_, count) => ({
        count,
        timeMs: count * 16,
        deltaMs: 16,
        surface: { width: 800, height: 600 },
        state: 0,
        ops: [0],
      })),
    };
    const { stub, report } = draw(doc, NOTHING, 899);
    expect(report.skipped).toBe(0);
    expect(
      (
        stub.calls.find((entry) => entry.method === "drawGeometry")
          ?.args[1] as { baseColor: string }
      ).baseColor,
    ).toBe("#123456");
  });

  it("replays the steps a recipe carries against the value the scene answered", () => {
    // No conforming 3D recording holds one — a produced value is immutable —
    // but the mutation machinery is part of the format the two spaces share.
    const stub = sceneStub();
    const seen: unknown[] = [];
    const scene: SceneDrawer3d = {
      ...stub.scene,
      createSphere: (radius) => {
        stub.log.push("createSphere");
        return {
          radius,
          scaleBy: (factor: number) => seen.push(factor),
        };
      },
    };
    const doc = recording([call("drawGeometry", { $res: 0 }, "#fff", HERE)], {
      resources: [
        {
          make: { method: "createSphere", args: [2] },
          then: [{ op: "call", method: "scaleBy", args: [3] }],
        },
      ],
    });
    const report = drawFrame3d(scene, doc, NOTHING, 0);
    expect(report.skipped).toBe(0);
    expect(seen).toEqual([3]);
  });

  it("fails the whole resource when a step of its recipe does not land", () => {
    const doc = recording([call("drawGeometry", { $res: 0 }, "#fff", HERE)], {
      resources: [
        {
          make: { method: "createSphere", args: [2] },
          then: [{ op: "call", method: "polish", args: [] }],
        },
      ],
    });
    const { stub, report } = draw(doc);
    expect(report.unreproducible).toEqual(["polish()"]);
    expect(stub.log).not.toContain("drawGeometry");
  });

  it("tries a recipe the scene refuses once, however many draws name it", () => {
    const stub = sceneStub({ produceNothing: true });
    const doc = recording(
      Array.from({ length: 4 }, () =>
        call("drawGeometry", { $res: 0 }, "#fff", HERE),
      ),
      {
        resources: [
          {
            make: { method: "createBox", args: [{ x: 1, y: 1, z: 1 }] },
            then: [],
          },
        ],
      },
    );
    const report = drawFrame3d(stub.scene, doc, NOTHING, 0);
    expect(stub.log.filter((m) => m === "createBox")).toHaveLength(1);
    expect(report.skipped).toBe(4);
    expect(report.unreproducible).toEqual(["createBox()"]);
  });

  it("refuses a recipe that names itself instead of recurring until the tab dies", () => {
    const doc = recording([call("drawGeometry", { $res: 0 }, "#fff", HERE)], {
      resources: [
        {
          make: { method: "createBox", args: [{ x: 1, y: 1, z: { $res: 0 } }] },
          then: [],
        },
      ],
    });
    const { report } = draw(doc);
    expect(report.unreproducible).toEqual([
      "a value whose recipe refers to itself",
    ]);
  });

  it("reports a geometry draw handed a material where a geometry belongs", () => {
    const doc = recording([call("drawGeometry", { $res: 0 }, "#fff", HERE)], {
      resources: [{ make: { method: "createMaterial", args: [{}] }, then: [] }],
    });
    const { report } = draw(doc);
    expect(report.unreproducible).toEqual(["drawGeometry()"]);
  });
});

describe("a value nested deeper than the format carries", () => {
  /** A value `depth` containers deep. */
  function nest(depth: number): DrawValue3d {
    let value: DrawValue3d = 1;
    for (let i = 0; i < depth; i += 1) value = [value];
    return value;
  }

  it("is refused rather than recurred into until the stack runs out", () => {
    const doc = recording([
      call("drawHudText", "x", { x: 0, y: 0 }, nest(40) as never),
    ]);
    const { report } = draw(doc);
    expect(report.unreproducible).toEqual([
      "a value nested deeper than this format carries",
    ]);
  });

  it("does not refuse a value nested within the bound", () => {
    const doc = recording([
      call(
        "drawLine",
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1, z: 1 },
        ],
        "#fff",
      ),
    ]);
    expect(draw(doc).report.skipped).toBe(0);
  });

  it("is refused when the nesting is a chain of recipes rather than of arrays", () => {
    const resources: Resource3d[] = [];
    for (let i = 0; i < 40; i += 1) {
      resources.push({
        make: {
          method: "createSphere",
          args: i === 39 ? [1] : [{ $res: i + 1 } as unknown as DrawValue3d],
        },
        then: [],
      });
    }
    const doc = recording([call("drawGeometry", { $res: 0 }, "#fff", HERE)], {
      resources,
    });
    const { report } = draw(doc);
    expect(report.unreproducible).toEqual([
      "a value nested deeper than this format carries",
    ]);
  });
});

describe("what the player cannot reproduce", () => {
  it("skips a draw carrying a value the recorder could not carry, and names it", () => {
    const doc = recording([
      call("drawMesh", { $opaque: "MeshHandle" }, HERE),
      call("drawHudRect", { x: 0, y: 0 }, { x: 1, y: 1 }, "#000"),
    ]);
    const { stub, report } = draw(doc);
    expect(report).toMatchObject({ drawn: 1, skipped: 1 });
    expect(report.unreproducible).toEqual(["MeshHandle"]);
    expect(stub.log).toContain("drawHudRect");
  });

  it("names the remainder of a container the recorder ran out of room inside", () => {
    const doc = recording([
      call(
        "drawLine",
        [{ x: 0, y: 0, z: 0 }, { $opaque: "truncated" }],
        "#fff",
      ),
    ]);
    expect(draw(doc).report.unreproducible).toEqual(["truncated"]);
  });

  it("reports each distinct reason once, however many draws it cost", () => {
    const doc = recording(
      Array.from({ length: 6 }, () =>
        call("drawMesh", { $opaque: "MeshHandle" }, HERE),
      ),
    );
    const { report } = draw(doc);
    expect(report.skipped).toBe(6);
    expect(report.unreproducible).toEqual(["MeshHandle"]);
  });

  it("reports an asset that would not decode, and draws the rest of the frame", () => {
    const doc = recording(
      [
        call(
          "drawBillboard",
          { $asset: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1 },
        ),
        call("drawHudRect", { x: 0, y: 0 }, { x: 1, y: 1 }, "#000"),
      ],
      {
        assets: [
          {
            kind: "texture",
            path: "t.png",
            width: 1,
            height: 1,
            src: "data:,",
          },
        ],
      },
    );
    const { stub, report } = draw(doc, { assets: [null] });
    expect(report.unreproducible).toEqual([
      "an asset that could not be decoded",
    ]);
    expect(stub.log).toContain("drawHudRect");
  });

  it("reports an asset the recording does not carry as a missing entry", () => {
    const doc = recording([
      call(
        "drawBillboard",
        { $asset: 4 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1 },
      ),
    ]);
    expect(draw(doc).report.unreproducible).toEqual([
      "a value this replay does not carry",
    ]);
  });

  it("reports a texture draw handed a mesh", () => {
    const doc = recording(
      [
        call(
          "drawBillboard",
          { $asset: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1 },
        ),
      ],
      {
        assets: [{ kind: "mesh", path: "m.glb", data: "AA==" }],
      },
    );
    const { report } = draw(doc, { assets: [mesh("m.glb")] });
    expect(report.unreproducible).toEqual(["drawBillboard()"]);
  });
});

describe("drawing a call the build drew nothing for", () => {
  it("passes a non-finite transform on rather than reporting a loss", () => {
    // "A draw call carrying a non-finite number … draws nothing for that call.
    // The call is still recorded." The build reported nothing, so nor does the
    // player: what draws nothing is the scene.
    const doc = recording(
      [
        call(
          "drawGeometry",
          { $res: 0 },
          "#fff",
          at(Number.POSITIVE_INFINITY, 0, 0),
        ),
      ],
      {
        resources: [{ make: { method: "createSphere", args: [1] }, then: [] }],
      },
    );
    const { stub, report } = draw(doc);
    expect(report.skipped).toBe(0);
    expect(stub.log).toContain("drawGeometry");
  });

  it("passes a one-point line on rather than reporting a loss", () => {
    const doc = recording([call("drawLine", [{ x: 0, y: 0, z: 0 }], "#fff")]);
    const { stub, report } = draw(doc);
    expect(report.skipped).toBe(0);
    expect(stub.log).toContain("drawLine");
  });
});

describe("seeking", () => {
  /** A recording whose frames each draw their own index, under their own state. */
  function timeline(): Recording3d {
    const states: RenderState3d[] = [
      { camera: CAMERA, lights: [], mode: "standard" },
      {
        camera: { ...CAMERA, position: { x: 0, y: 0, z: 5 } },
        lights: [{ type: "ambient", color: "#ffffff", intensity: 1 }],
        mode: "wireframe",
      },
    ];
    const ops: DrawOp3d[] = [
      call("drawGeometry", { $res: 0 }, "#111111", at(0, 0, -1)),
      call(
        "drawBillboard",
        { $asset: 0 },
        { x: 0, y: 0, z: -3 },
        { x: 1, y: 1 },
      ),
      call("setMode", "normals"),
      call("drawHudText", "hud", { x: 4, y: 4 }),
      call(
        "drawLine",
        [
          { x: 0, y: 0, z: -9 },
          { x: 1, y: 0, z: 0 },
        ],
        "#00000080",
      ),
    ];
    return {
      format: RECORDING_FORMAT,
      space: "3d",
      width: 800,
      height: 600,
      background: "#000000",
      assets: [
        { kind: "texture", path: "t.png", width: 1, height: 1, src: "data:," },
      ],
      resources: [
        {
          make: { method: "createBox", args: [{ x: 1, y: 1, z: 1 }] },
          then: [],
        },
      ],
      ops,
      states,
      frames: Array.from({ length: 6 }, (_, count) => ({
        count,
        timeMs: count * 16,
        deltaMs: 16,
        surface: { width: 800, height: 600 },
        state: count % 2,
        ops: ops.map((_, i) => i).slice(0, (count % 5) + 1),
      })),
    };
  }

  /** What one frame put at the scene, as comparable text. */
  function shot(recording3d: Recording3d, frame: number): string {
    const stub = sceneStub();
    drawFrame3d(stub.scene, recording3d, { assets: [texture("t.png")] }, frame);
    return JSON.stringify(
      stub.calls.map((entry) => [entry.method, entry.args]),
    );
  }

  it("draws a frame landed on cold exactly as the frame reached in order", () => {
    const doc = timeline();
    // In order, on ONE scene, as playback does.
    const played = sceneStub();
    const inOrder: string[] = [];
    for (let frame = 0; frame < doc.frames.length; frame += 1) {
      const before = played.calls.length;
      drawFrame3d(played.scene, doc, { assets: [texture("t.png")] }, frame);
      inOrder.push(
        JSON.stringify(
          played.calls.slice(before).map((entry) => [entry.method, entry.args]),
        ),
      );
    }
    // Cold, each on a scene of its own, as a scrub does.
    for (let frame = 0; frame < doc.frames.length; frame += 1) {
      expect(shot(doc, frame)).toBe(inOrder[frame]);
    }
  });

  it("draws any frame at the same cost, in either direction", () => {
    const doc = timeline();
    expect(shot(doc, 4)).toBe(shot(doc, 4));
    expect(shot(doc, 1)).not.toBe(shot(doc, 4));
  });

  it("draws nothing for a frame the recording does not have", () => {
    const stub = sceneStub();
    const report = drawFrame3d(stub.scene, timeline(), NOTHING, 99);
    expect(report).toEqual({ drawn: 0, skipped: 0, unreproducible: [] });
    expect(stub.log).toEqual([]);
  });
});

describe("decoding a recording's assets", () => {
  const glb: CapturedAsset = { kind: "mesh", path: "m.glb", data: "AA==" };
  const png: CapturedAsset = {
    kind: "texture",
    path: "t.png",
    width: 1,
    height: 1,
    src: "data:image/png;base64,AA==",
  };

  it("decodes every entry once, in the order the table holds them", async () => {
    const seen: string[] = [];
    const decode: Asset3dDecoder = async (asset) => {
      seen.push(asset.path);
      return asset.kind === "mesh" ? mesh(asset.path) : texture(asset.path);
    };
    const doc = recording([], { assets: [glb, png] });
    const resources = await prepareRecording3d(doc, decode);
    expect(seen).toEqual(["m.glb", "t.png"]);
    expect(resources.assets.map((entry) => entry?.kind)).toEqual([
      "mesh",
      "texture",
    ]);
  });

  it("assembles a captured material from the textures it names", async () => {
    const decode: Asset3dDecoder = async (asset) => texture(asset.path);
    const doc = recording([], {
      assets: [
        png,
        { kind: "texture", path: "n.png", width: 1, height: 1, src: "data:," },
        {
          kind: "material",
          path: "m.json",
          maps: { baseColor: 0, normal: 1 },
        },
      ],
    });
    const resources = await prepareRecording3d(doc, decode);
    expect(resources.assets[2]).toEqual({
      kind: "material",
      path: "m.json",
      maps: { baseColor: texture("t.png"), normal: texture("n.png") },
    });
  });

  it("fails a material whose texture would not decode, rather than dropping the slot", async () => {
    const decode: Asset3dDecoder = async (asset) => {
      if (asset.path === "n.png") throw new Error("no");
      return texture(asset.path);
    };
    const doc = recording([], {
      assets: [
        png,
        { kind: "texture", path: "n.png", width: 1, height: 1, src: "data:," },
        { kind: "material", path: "m.json", maps: { baseColor: 0, normal: 1 } },
      ],
    });
    const resources = await prepareRecording3d(doc, decode);
    expect(resources.assets[1]).toBeNull();
    expect(resources.assets[2]).toBeNull();
  });

  it("keeps playing a recording one of whose assets will not decode", async () => {
    const decode = vi.fn<Asset3dDecoder>(async () => {
      throw new Error("this browser will not decode it");
    });
    const doc = recording([], { assets: [glb] });
    const resources = await prepareRecording3d(doc, decode);
    expect(resources.assets).toEqual([null]);
  });

  it("draws with a captured material document under the slots the engine reads", () => {
    const doc = recording(
      [call("drawGeometry", { $res: 0 }, { $asset: 0 }, HERE)],
      {
        assets: [{ kind: "material", path: "m.json", maps: { baseColor: 1 } }],
        resources: [{ make: { method: "createSphere", args: [1] }, then: [] }],
      },
    );
    const base = texture("base.png");
    const { stub, report } = draw(doc, {
      assets: [
        { kind: "material", path: "m.json", maps: { baseColor: base } },
        base,
      ],
    });
    expect(report.skipped).toBe(0);
    expect(
      stub.calls.find((entry) => entry.method === "drawGeometry")?.args[1],
    ).toMatchObject({
      baseColorMap: base,
      normalMap: null,
      baseColor: "#ffffff",
    });
  });
});
