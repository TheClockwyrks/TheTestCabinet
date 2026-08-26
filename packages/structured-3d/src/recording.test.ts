import { describe, expect, it } from "vitest";
import {
  ASSET_BYTE_LIMIT,
  LIGHT_LIMIT,
  VALUE_DEPTH_LIMIT,
  VALUE_EXPANSION_LIMIT,
  type DrawValue,
  type LightState,
  type Recording,
} from "./contract";
import type { CameraState } from "./math";
import {
  RECORDING_FORMAT,
  SceneRecorder,
  type HandleCapturePayload,
  type HandleDescription,
  type InheritedState,
} from "./recording";

/**
 * The recorder on its own: what a frame captures, what the shared tables hold,
 * and how a value the format cannot carry degrades. Everything here is stated
 * against `SceneRecorder` directly rather than through the engine, because the
 * claims are about the document — its two encoding bounds, its dedup, its
 * capture budget, its rounding — and driving them through a pipeline would only
 * put a picture between the assertion and the rule it is about. That the
 * pipeline feeds this recorder the operations it does is `rendering.test.ts`'s
 * claim, and it is checked there against the same document.
 *
 * The two seams are the test's: an `envelope` it can move between arming and
 * closing, and a `describeHandle` that recognizes whatever the test decides is
 * a handle — which is exactly the shape the scene supplies in the engine.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The default camera state, which every inherited block here opens from. */
function camera(): CameraState {
  return {
    position: { x: 0, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    fovY: Math.PI / 3,
    near: 0.1,
    far: 1000,
  };
}

/** The renderer state a frame inherits, with only what a test cares about stated. */
function inherited(overrides: Partial<InheritedState> = {}): InheritedState {
  return { camera: camera(), lights: [], mode: "standard", ...overrides };
}

/**
 * A recorder over movable seams: `envelope` is a field a test can reassign
 * between arming and closing (the docs fix the figures at arm time), and
 * `handles` is the table `describeHandle` answers from, so a test names its own
 * handles without owning an engine.
 */
function recorderWith() {
  const state = {
    envelope: {
      width: 320,
      height: 180,
      background: "#000000" as string | null,
    },
  };
  const handles = new Map<object, HandleDescription>();
  const recorder = new SceneRecorder({
    envelope: () => ({ ...state.envelope }),
    describeHandle: (value) => handles.get(value) ?? null,
  });
  return { recorder, state, handles };
}

/** Open a frame, issue `body`'s calls into it, and close it with plain figures. */
function frame(
  recorder: SceneRecorder,
  body: (
    record: (
      method: "drawLine" | "drawHudRect" | "drawMesh" | "drawGeometry",
      args: readonly unknown[],
    ) => void,
  ) => void,
  figures = { count: 1, timeMs: 16, deltaMs: 16 },
  state: InheritedState = inherited(),
): void {
  recorder.openFrame(state, { width: 320, height: 180 });
  body((method, args) => {
    recorder.recordCall(method, args);
  });
  recorder.closeFrame(figures);
}

/** A handle description whose capture is the payload the test names. */
function handleOf(
  name: string,
  payload: () => HandleCapturePayload,
): HandleDescription {
  return { name, capture: payload };
}

/** `depth` nested arrays around a leaf, for the depth bound. */
function nest(depth: number): unknown {
  let value: unknown = "leaf";
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

/** The one operation a single-frame recording holds at `index`. */
function callAt(
  recording: Recording,
  index: number,
): { method: string; args: readonly DrawValue[] } {
  const at = recording.frames[0]?.ops[index];
  const op = at === undefined ? undefined : recording.ops[at];
  if (op === undefined || op.op !== "call")
    throw new Error(`the frame holds no call at ${index}`);
  return op;
}

/* -------------------------------------------------------------------------- */
/* Arming                                                                     */
/* -------------------------------------------------------------------------- */

describe("arming the recorder", () => {
  it("reports whether operations are being captured", () => {
    const { recorder } = recorderWith();

    expect(recorder.active()).toBe(false);
    recorder.start();
    expect(recorder.active()).toBe(true);
    recorder.stop();
    expect(recorder.active()).toBe(false);
  });

  it("refuses a second start, naming the unbalanced call", () => {
    const { recorder } = recorderWith();
    recorder.start();

    expect(() => recorder.start()).toThrow(Error);
    expect(() => recorder.start()).toThrow(
      /startRecording was called while the recorder is already armed/,
    );
  });

  it("refuses a stop while it is not armed, naming the unbalanced call", () => {
    const { recorder } = recorderWith();

    expect(() => recorder.stop()).toThrow(
      /stopRecording was called while the recorder is not armed/,
    );
  });

  it("writes the one format version and the 3D space", () => {
    const { recorder } = recorderWith();
    recorder.start();
    const recording = recorder.stop();

    expect(RECORDING_FORMAT).toBe(1);
    expect(recording.format).toBe(RECORDING_FORMAT);
    expect(recording.space).toBe("3d");
  });

  it("fixes the design size and background when it is armed rather than when it closes", () => {
    const { recorder, state } = recorderWith();
    recorder.start();
    state.envelope = { width: 9, height: 9, background: "#ffffff" };
    const recording = recorder.stop();

    expect(recording.width).toBe(320);
    expect(recording.height).toBe(180);
    expect(recording.background).toBe("#000000");
  });

  it("carries a transparent background as null", () => {
    const { recorder, state } = recorderWith();
    state.envelope = { width: 4, height: 4, background: null };
    recorder.start();

    expect(recorder.stop().background).toBeNull();
  });

  it("starts each recording from empty tables", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) => record("drawLine", [[], "#fff"]));
    recorder.stop();

    recorder.start();
    const second = recorder.stop();

    expect(second.frames).toEqual([]);
    expect(second.ops).toEqual([]);
    expect(second.states).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Frame boundaries                                                           */
/* -------------------------------------------------------------------------- */

describe("frame boundaries", () => {
  it("captures nothing from a frame that opened before the recorder was armed", () => {
    const { recorder } = recorderWith();

    recorder.openFrame(inherited(), { width: 320, height: 180 });
    recorder.recordCall("drawHudRect", [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      "#fff",
    ]);
    recorder.start();
    recorder.closeFrame({ count: 1, timeMs: 16, deltaMs: 16 });
    const recording = recorder.stop();

    expect(recording.frames).toEqual([]);
    expect(recording.ops).toEqual([]);
  });

  it("drops a frame still open when the recorder is disarmed, and everything it interned", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) =>
      record("drawLine", [[{ x: 0, y: 0, z: 0 }], "#fff"]),
    );

    recorder.openFrame(inherited({ mode: "wireframe" }), {
      width: 320,
      height: 180,
    });
    recorder.recordCall("drawHudRect", [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      "#abc",
    ]);
    const recording = recorder.stop();

    expect(recording.frames).toHaveLength(1);
    // "every entry is one some frame names": the dropped frame's own operation
    // and its inherited state left with it.
    expect(recording.ops).toHaveLength(1);
    expect(recording.states).toHaveLength(1);
    expect(recording.states[0]?.mode).toBe("standard");
  });

  it("carries the frame's own figures exactly, unrounded", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, () => {}, {
      count: 903,
      timeMs: 15_050.123456789012,
      deltaMs: 16.666666666666668,
    });
    const recorded = recorder.stop().frames[0];

    expect(recorded?.count).toBe(903);
    expect(recorded?.timeMs).toBe(15_050.123456789012);
    expect(recorded?.deltaMs).toBe(16.666666666666668);
    expect(recorded?.surface).toEqual({ width: 320, height: 180 });
  });

  it("names the operations it issued by index, in issue order", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) => {
      record("drawLine", [[], "#a"]);
      record("drawLine", [[], "#b"]);
      record("drawLine", [[], "#a"]);
    });
    const recording = recorder.stop();

    expect(recording.ops).toHaveLength(2);
    expect(recording.frames[0]?.ops).toEqual([0, 1, 0]);
  });
});

/* -------------------------------------------------------------------------- */
/* The shared tables                                                          */
/* -------------------------------------------------------------------------- */

describe("the shared tables", () => {
  it("holds each distinct operation once, however many frames issue it", () => {
    const { recorder } = recorderWith();
    recorder.start();
    for (let count = 1; count <= 5; count++) {
      frame(
        recorder,
        (record) =>
          record("drawHudRect", [{ x: 1, y: 2 }, { x: 3, y: 4 }, "#fff"]),
        {
          count,
          timeMs: count * 16,
          deltaMs: 16,
        },
      );
    }
    const recording = recorder.stop();

    expect(recording.frames).toHaveLength(5);
    expect(recording.ops).toHaveLength(1);
    expect(recording.states).toHaveLength(1);
  });

  it("keys sharing on the entry itself, whatever order its fields were produced in", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) => {
      record("drawHudRect", [{ x: 1, y: 2 }]);
      // The same value, built the other way round.
      const other: Record<string, number> = {};
      other["y"] = 2;
      other["x"] = 1;
      record("drawHudRect", [other]);
    });
    const recording = recorder.stop();

    expect(recording.ops).toHaveLength(1);
    expect(recording.frames[0]?.ops).toEqual([0, 0]);
  });

  it("holds the renderer state a frame inherited, rounded like every other number", () => {
    const { recorder } = recorderWith();
    const lights: LightState[] = [
      {
        type: "directional",
        color: "#ffffff",
        intensity: 1 / 3,
        direction: { x: 1 / 7, y: 0, z: 0 },
      },
    ];
    recorder.start();
    frame(
      recorder,
      () => {},
      { count: 1, timeMs: 16, deltaMs: 16 },
      inherited({ lights, mode: "unlit" }),
    );
    const state = recorder.stop().states[0];

    expect(state?.mode).toBe("unlit");
    expect(state?.camera.fovY).toBe(1.04719755);
    expect(state?.lights[0]).toEqual({
      type: "directional",
      color: "#ffffff",
      intensity: 0.333333333,
      direction: { x: 0.142857143, y: 0, z: 0 },
    });
  });

  it("cuts an inherited light list to the format's bound and says the frame was cut", () => {
    const { recorder } = recorderWith();
    const lights: LightState[] = Array.from(
      { length: LIGHT_LIMIT + 1 },
      () => ({
        type: "ambient" as const,
        color: "#ffffff",
        intensity: 1,
      }),
    );
    recorder.start();
    frame(
      recorder,
      () => {},
      { count: 1, timeMs: 16, deltaMs: 16 },
      inherited({ lights }),
    );
    const recording = recorder.stop();

    expect(recording.states[0]?.lights).toHaveLength(LIGHT_LIMIT);
    expect(recording.frames[0]?.truncated).toBe(true);
  });

  it("leaves the truncation flag off a frame whose light list fits", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(
      recorder,
      () => {},
      { count: 1, timeMs: 16, deltaMs: 16 },
      inherited({
        lights: [{ type: "ambient", color: "#fff", intensity: 1 }],
      }),
    );

    expect(recorder.stop().frames[0]?.truncated).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Encoding a value                                                           */
/* -------------------------------------------------------------------------- */

describe("encoding a value", () => {
  it("writes plain data as its own shape, with numbers at nine significant digits", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) =>
      record("drawGeometry", [
        { position: { x: 1 / 3, y: -2, z: 0 }, tags: ["a", true, null] },
        "#ff8800",
      ]),
    );
    const call = callAt(recorder.stop(), 0);

    expect(call.args[0]).toEqual({
      position: { x: 0.333333333, y: -2, z: 0 },
      tags: ["a", true, null],
    });
    expect(call.args[1]).toBe("#ff8800");
  });

  it("records a cyclic object as a marker naming its constructor", () => {
    const { recorder } = recorderWith();
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    recorder.start();
    frame(recorder, (record) => record("drawLine", [cyclic]));
    const call = callAt(recorder.stop(), 0);

    expect(call.args[0]).toEqual({ name: "loop", self: { $opaque: "Object" } });
  });

  it("records an object whose getter throws as a marker, and still performs the call", () => {
    const { recorder } = recorderWith();
    const trap = {
      get value(): number {
        throw new Error("no");
      },
    };
    recorder.start();
    frame(recorder, (record) => record("drawLine", [trap, "#fff"]));
    const call = callAt(recorder.stop(), 0);

    expect(call.args[0]).toEqual({ $opaque: "Object" });
    expect(call.args[1]).toBe("#fff");
  });

  it("records a value JSON cannot carry as a marker naming it", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) =>
      record("drawLine", [undefined, () => 1, new Map()]),
    );
    const call = callAt(recorder.stop(), 0);

    expect(call.args[0]).toEqual({ $opaque: "undefined" });
    expect(call.args[1]).toEqual({ $opaque: "Function" });
    expect(call.args[2]).toEqual({ $opaque: "Map" });
  });

  it("stops expanding a container reached at the depth bound", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) =>
      record("drawLine", [nest(VALUE_DEPTH_LIMIT + 4)]),
    );
    const call = callAt(recorder.stop(), 0);

    let value = call.args[0];
    let depth = 0;
    while (Array.isArray(value)) {
      depth += 1;
      value = value[0];
    }
    expect(depth).toBe(VALUE_DEPTH_LIMIT);
    expect(value).toEqual({ $opaque: "Array" });
  });

  it("carries the remainder of an over-long array as one truncation marker", () => {
    const { recorder } = recorderWith();
    const long = Array.from(
      { length: VALUE_EXPANSION_LIMIT + 500 },
      (_, i) => i,
    );
    recorder.start();
    frame(recorder, (record) => record("drawLine", [long]));
    const encoded = callAt(recorder.stop(), 0).args[0] as DrawValue[];

    expect(encoded.length).toBeLessThan(long.length);
    expect(encoded[encoded.length - 1]).toEqual({ $opaque: "truncated" });
    expect(encoded[0]).toBe(0);
  });

  it("carries the remainder of an over-long object under the field named $rest", () => {
    const { recorder } = recorderWith();
    const wide: Record<string, number> = {};
    for (let i = 0; i < VALUE_EXPANSION_LIMIT + 500; i++) wide[`k${i}`] = i;
    recorder.start();
    frame(recorder, (record) => record("drawLine", [wide]));
    const encoded = callAt(recorder.stop(), 0).args[0] as Record<
      string,
      DrawValue
    >;

    expect(encoded["$rest"]).toEqual({ $opaque: "truncated" });
    expect(Object.keys(encoded).length).toBeLessThan(Object.keys(wide).length);
  });

  it("gives one encoded value its own expansion budget", () => {
    const { recorder } = recorderWith();
    const half = Array.from(
      { length: VALUE_EXPANSION_LIMIT - 10 },
      (_, i) => i,
    );
    recorder.start();
    frame(recorder, (record) => record("drawLine", [half, [...half]]));
    const call = callAt(recorder.stop(), 0);

    // The bound is per value, so a second argument the same size is not cut by
    // what the first one spent.
    expect((call.args[0] as DrawValue[]).length).toBe(half.length);
    expect((call.args[1] as DrawValue[]).length).toBe(half.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Resources                                                                  */
/* -------------------------------------------------------------------------- */

describe("produced values", () => {
  it("records a producing call as the value's recipe rather than as a frame operation", () => {
    const { recorder } = recorderWith();
    const geometry = { kind: "box" };
    recorder.registerResource(geometry, "createBox", [{ x: 1, y: 2, z: 3 }]);
    recorder.start();
    frame(recorder, (record) => record("drawGeometry", [geometry, "#fff"]));
    const recording = recorder.stop();

    expect(callAt(recording, 0).args[0]).toEqual({ $res: 0 });
    expect(recording.resources[0]?.make).toEqual({
      method: "createBox",
      args: [{ x: 1, y: 2, z: 3 }],
    });
    // A produced value is immutable, so its recipe is its make alone.
    expect(recording.resources[0]?.then).toEqual([]);
    expect(
      recording.ops.map((op) => (op.op === "call" ? op.method : op.property)),
    ).toEqual(["drawGeometry"]);
  });

  it("shares one entry between two producing calls with the same arguments", () => {
    const { recorder } = recorderWith();
    const first = { id: 1 };
    const second = { id: 2 };
    recorder.registerResource(first, "createSphere", [2]);
    recorder.registerResource(second, "createSphere", [2]);
    recorder.start();
    frame(recorder, (record) => {
      record("drawGeometry", [first, "#a"]);
      record("drawGeometry", [second, "#b"]);
    });
    const recording = recorder.stop();

    expect(recording.resources).toHaveLength(1);
    expect(callAt(recording, 0).args[0]).toEqual({ $res: 0 });
    expect(callAt(recording, 1).args[0]).toEqual({ $res: 0 });
  });

  it("leaves a value that was created and never used out of the table", () => {
    const { recorder } = recorderWith();
    recorder.registerResource({ id: 1 }, "createPlane", [4, 4]);
    recorder.start();
    frame(recorder, (record) => record("drawLine", [[], "#fff"]));

    expect(recorder.stop().resources).toEqual([]);
  });

  it("collects a recipe from before the recorder was armed", () => {
    const { recorder } = recorderWith();
    const material = { spec: {} };
    recorder.registerResource(material, "createMaterial", [
      { baseColor: "#123456" },
    ]);

    recorder.start();
    frame(recorder, (record) => record("drawGeometry", [{ id: 0 }, material]));
    const recording = recorder.stop();

    expect(recording.resources[0]?.make.method).toBe("createMaterial");
    expect(callAt(recording, 0).args[1]).toEqual({ $res: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* Captured assets                                                            */
/* -------------------------------------------------------------------------- */

describe("captured assets", () => {
  it("captures a mesh as its glTF binary, base64 encoded", () => {
    const { recorder, handles } = recorderWith();
    const mesh = { path: "models/ship.glb" };
    handles.set(
      mesh,
      handleOf("MeshHandle", () => ({
        kind: "mesh",
        path: "models/ship.glb",
        bytes: Uint8Array.from([0x67, 0x6c, 0x54, 0x46]),
      })),
    );
    recorder.start();
    frame(recorder, (record) => record("drawMesh", [mesh]));
    const recording = recorder.stop();

    expect(callAt(recording, 0).args[0]).toEqual({ $asset: 0 });
    expect(recording.assets[0]).toEqual({
      kind: "mesh",
      path: "models/ship.glb",
      data: "Z2xURg==",
    });
  });

  it("captures a texture as a PNG data URL beside its decoded size", () => {
    const { recorder, handles } = recorderWith();
    const texture = { path: "textures/dot.png" };
    handles.set(
      texture,
      handleOf("TextureHandle", () => ({
        kind: "texture",
        path: "textures/dot.png",
        width: 2,
        height: 3,
        png: Uint8Array.from([1, 2, 3]),
      })),
    );
    recorder.start();
    frame(recorder, (record) => record("drawMesh", [texture]));
    const asset = recorder.stop().assets[0];

    expect(asset).toEqual({
      kind: "texture",
      path: "textures/dot.png",
      width: 2,
      height: 3,
      src: "data:image/png;base64,AQID",
    });
  });

  it("captures a material as indices into the asset table, per slot", () => {
    const { recorder, handles } = recorderWith();
    const base = { path: "mat/base.png" };
    const normal = { path: "mat/normal.png" };
    const material = { path: "mat/" };
    for (const [handle, path] of [
      [base, "mat/base.png"],
      [normal, "mat/normal.png"],
    ] as const) {
      handles.set(
        handle,
        handleOf("TextureHandle", () => ({
          kind: "texture",
          path,
          width: 1,
          height: 1,
          png: Uint8Array.from([path.length]),
        })),
      );
    }
    handles.set(
      material,
      handleOf("MaterialHandle", () => ({
        kind: "material",
        path: "mat/",
        maps: [
          ["baseColor", base],
          ["normal", normal],
        ],
      })),
    );
    recorder.start();
    frame(recorder, (record) => record("drawMesh", [material]));
    const recording = recorder.stop();

    expect(callAt(recording, 0).args[0]).toEqual({ $asset: 2 });
    expect(recording.assets[2]).toEqual({
      kind: "material",
      path: "mat/",
      maps: { baseColor: 0, normal: 1 },
    });
  });

  it("captures a handle once, however many frames draw it", () => {
    const { recorder, handles } = recorderWith();
    const mesh = { path: "models/ship.glb" };
    let captures = 0;
    handles.set(
      mesh,
      handleOf("MeshHandle", () => {
        captures += 1;
        return {
          kind: "mesh",
          path: "models/ship.glb",
          bytes: Uint8Array.from([1]),
        };
      }),
    );
    recorder.start();
    for (let count = 1; count <= 4; count++) {
      frame(recorder, (record) => record("drawMesh", [mesh]), {
        count,
        timeMs: count * 16,
        deltaMs: 16,
      });
    }
    const recording = recorder.stop();

    expect(captures).toBe(1);
    expect(recording.assets).toHaveLength(1);
  });

  it("degrades a handle whose capture throws to a marker naming its type", () => {
    const { recorder, handles } = recorderWith();
    const mesh = { path: "models/broken.glb" };
    handles.set(
      mesh,
      handleOf("MeshHandle", () => {
        throw new Error("the bytes are gone");
      }),
    );
    recorder.start();
    frame(recorder, (record) => record("drawMesh", [mesh]));
    const recording = recorder.stop();

    expect(callAt(recording, 0).args[0]).toEqual({ $opaque: "MeshHandle" });
    expect(recording.assets).toEqual([]);
  });

  it("stops capturing once the recording holds the format's asset budget, and keeps the earlier ones resolving", () => {
    const { recorder, handles } = recorderWith();
    const small = { path: "models/small.glb" };
    const huge = { path: "models/huge.glb" };
    handles.set(
      small,
      handleOf("MeshHandle", () => ({
        kind: "mesh",
        path: "models/small.glb",
        bytes: Uint8Array.from([1, 2, 3]),
      })),
    );
    handles.set(
      huge,
      handleOf("MeshHandle", () => ({
        kind: "mesh",
        path: "models/huge.glb",
        // Base64 grows a payload by four thirds, so this is past the budget.
        bytes: new Uint8Array(ASSET_BYTE_LIMIT),
      })),
    );
    recorder.start();
    frame(recorder, (record) => {
      record("drawMesh", [small]);
      record("drawMesh", [huge]);
      record("drawMesh", [small]);
    });
    const recording = recorder.stop();

    expect(callAt(recording, 0).args[0]).toEqual({ $asset: 0 });
    expect(callAt(recording, 1).args[0]).toEqual({ $opaque: "MeshHandle" });
    expect(callAt(recording, 2).args[0]).toEqual({ $asset: 0 });
    expect(recording.assets).toHaveLength(1);
    // The check allocates and base64-encodes a payload the size of the whole
    // budget, which runs for seconds on a loaded machine: an explicit timeout,
    // bounding how long it may take and changing nothing it asserts.
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* Values the format cannot carry                                             */
/* -------------------------------------------------------------------------- */

/**
 * The two guarantees the recorder makes about a value it cannot carry, stated
 * here because both are shared with `simple-3d` — the recorder core is the same
 * module in both packages, and a defect in one is a defect in the other.
 */
describe("what the recorder promises about values it cannot carry", () => {
  it("records a value that refuses to say what shape it is, rather than throwing out of the draw", () => {
    // `apis/recording.md`: a value the recorder cannot carry records as
    // `{ $opaque: … }`, so a build draws the same pixels whether or not
    // anything is being captured. Asking the question can itself throw —
    // `Array.isArray` refuses a revoked proxy, `Object.getPrototypeOf` refuses
    // one whose trap says so — and an escape from here would turn a draw that
    // works into a draw that throws only while armed, which is precisely the
    // asymmetry that sentence rules out.
    const revoked = Proxy.revocable({ x: 1, y: 2 }, {});
    revoked.revoke();
    const refusing = new Proxy(
      { x: 3, y: 4 },
      {
        getPrototypeOf(): never {
          throw new Error("this value declines to say what it is");
        },
      },
    );
    for (const hostile of [revoked.proxy, refusing]) {
      const { recorder } = recorderWith();
      recorder.start();
      expect(() =>
        frame(recorder, (record) => {
          record("drawLine", [hostile, "#ffffff"]);
          record("drawHudRect", [hostile, { x: 1, y: 1 }, "#ffffff"]);
        }),
      ).not.toThrow();
      const recording = recorder.stop();

      // A proxy that will not name its prototype has no better label than the
      // bare kind, which is what `opaqueName` falls back to.
      expect(callAt(recording, 0).args[0]).toEqual({ $opaque: "object" });
      expect(callAt(recording, 1).args[0]).toEqual({ $opaque: "object" });
    }
  });

  it("leaves no asset entry behind when a material's later map cannot be carried", () => {
    // The tables promise every entry is one some frame names. A material
    // degrades whole when one of its maps cannot be captured, so the maps
    // interned on the way have to be rolled back with it — otherwise they sit
    // in `assets` named by nothing, spending the byte budget on pixels nothing
    // can resolve.
    const { recorder, handles } = recorderWith();
    const base = { path: "mat/base.png" };
    const huge = { path: "mat/huge.png" };
    const material = { path: "mat/" };
    handles.set(
      base,
      handleOf("TextureHandle", () => ({
        kind: "texture",
        path: "mat/base.png",
        width: 1,
        height: 1,
        png: Uint8Array.from([1, 2, 3]),
      })),
    );
    handles.set(
      huge,
      handleOf("TextureHandle", () => ({
        kind: "texture",
        path: "mat/huge.png",
        width: 1,
        height: 1,
        // Base64 grows a payload by four thirds, so this is past the budget.
        png: new Uint8Array(ASSET_BYTE_LIMIT),
      })),
    );
    handles.set(
      material,
      handleOf("MaterialHandle", () => ({
        kind: "material",
        path: "mat/",
        maps: [
          ["baseColor", base],
          ["normal", huge],
        ],
      })),
    );
    recorder.start();
    frame(recorder, (record) => record("drawMesh", [material]));
    const recording = recorder.stop();

    expect(callAt(recording, 0).args[0]).toEqual({ $opaque: "MaterialHandle" });
    expect(recording.assets).toEqual([]);
  });

  it("keeps a map some other draw already captured, because that one predates the rollback", () => {
    const { recorder, handles } = recorderWith();
    const base = { path: "mat/base.png" };
    const huge = { path: "mat/huge.png" };
    const material = { path: "mat/" };
    handles.set(
      base,
      handleOf("TextureHandle", () => ({
        kind: "texture",
        path: "mat/base.png",
        width: 1,
        height: 1,
        png: Uint8Array.from([1, 2, 3]),
      })),
    );
    handles.set(
      huge,
      handleOf("TextureHandle", () => ({
        kind: "texture",
        path: "mat/huge.png",
        width: 1,
        height: 1,
        png: new Uint8Array(ASSET_BYTE_LIMIT),
      })),
    );
    handles.set(
      material,
      handleOf("MaterialHandle", () => ({
        kind: "material",
        path: "mat/",
        maps: [
          ["baseColor", base],
          ["normal", huge],
        ],
      })),
    );
    recorder.start();
    frame(recorder, (record) => {
      record("drawMesh", [base]);
      record("drawMesh", [material]);
    });
    const recording = recorder.stop();

    // The texture the first draw captured is still there, and still the one
    // that draw names; only what the material interned is undone.
    expect(callAt(recording, 0).args[0]).toEqual({ $asset: 0 });
    expect(callAt(recording, 1).args[0]).toEqual({ $opaque: "MaterialHandle" });
    expect(recording.assets.map((asset) => asset.path)).toEqual([
      "mat/base.png",
    ]);
  });

  it("captures a material whole when every map fits, so the rollback fires only on failure", () => {
    const { recorder, handles } = recorderWith();
    const base = { path: "mat/base.png" };
    const normal = { path: "mat/normal.png" };
    const material = { path: "mat/" };
    for (const [handle, path] of [
      [base, "mat/base.png"],
      [normal, "mat/normal.png"],
    ] as const) {
      handles.set(
        handle,
        handleOf("TextureHandle", () => ({
          kind: "texture",
          path,
          width: 1,
          height: 1,
          png: Uint8Array.from([path.length]),
        })),
      );
    }
    handles.set(
      material,
      handleOf("MaterialHandle", () => ({
        kind: "material",
        path: "mat/",
        maps: [
          ["baseColor", base],
          ["normal", normal],
        ],
      })),
    );
    recorder.start();
    frame(recorder, (record) => record("drawMesh", [material]));
    const recording = recorder.stop();

    expect(callAt(recording, 0).args[0]).toEqual({ $asset: 2 });
    expect(recording.assets).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* The format's own shape                                                     */
/* -------------------------------------------------------------------------- */

describe("the recording document", () => {
  it("is assignable to the format the contract declares", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) =>
      record("drawHudRect", [{ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff"]),
    );
    // The typed binding is the assertion: `stop()` answers the shared type the
    // `./recording` subpath serves, so a player reading the format sees what
    // the engine wrote.
    const recording: Recording = recorder.stop();

    expect(Object.keys(recording).sort()).toEqual([
      "assets",
      "background",
      "format",
      "frames",
      "height",
      "ops",
      "resources",
      "space",
      "states",
      "width",
    ]);
  });

  it("holds call operations alone, since the scene context declares no assignable property", () => {
    const { recorder } = recorderWith();
    recorder.start();
    frame(recorder, (record) => {
      record("drawLine", [[], "#fff"]);
      record("drawHudRect", [{ x: 0, y: 0 }, { x: 1, y: 1 }, "#fff"]);
    });
    const recording = recorder.stop();

    expect(recording.ops.every((op) => op.op === "call")).toBe(true);
    expect(recording.frames[0]?.ops).toHaveLength(2);
  });
});
