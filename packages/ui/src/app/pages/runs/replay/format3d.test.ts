import { describe, expect, it } from "vitest";
import { RECORDING_FORMAT } from "./format";
import {
  LIGHT_LIMIT,
  PRODUCING_METHODS,
  RECIPE_STEP_LIMIT,
  parse3dRecording,
  type CameraState,
  type RecordedFrame3d,
} from "./format3d";

/**
 * Reading a document the envelope has routed to the 3D drawer.
 *
 * What is checked here is what `format.test.ts` checks next door and for the same
 * reason: the refusals are the part that protects the reviewer. A replay this
 * console cannot read must produce a sentence they can act on and no picture at
 * all, because a drawn approximation of a format we guessed at is evidence of
 * nothing, shown beside a verdict that rests on it.
 *
 * The indices get the same attention as the shapes, and in one more place than
 * they do in 2D: a captured material names its textures by index into the asset
 * table, so a material naming a mesh is a material a player could only resolve to
 * the wrong picture.
 */

/** The camera every state below inherits — the engine's own defaults. */
const CAMERA: CameraState = {
  position: { x: 0, y: 0, z: 10 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  fovY: Math.PI / 3,
  near: 0.1,
  far: 1000,
};

/** A minimal well-formed frame — enough shape for the parser to accept. */
function frame(overrides: Record<string, unknown> = {}): RecordedFrame3d {
  return {
    count: 1,
    timeMs: 16,
    deltaMs: 16,
    surface: { width: 640, height: 360 },
    state: 0,
    ops: [0],
    ...overrides,
  } as unknown as RecordedFrame3d;
}

/** A well-formed renderer state, with whatever this check is about replaced. */
function state(overrides: Record<string, unknown> = {}): unknown {
  return { camera: CAMERA, lights: [], mode: "standard", ...overrides };
}

/** `count` well-formed lights, for the checks that are about how many there are. */
function lights(count: number): unknown[] {
  return Array.from({ length: count }, () => ({
    type: "ambient",
    color: "#ffffff",
    intensity: 0.4,
  }));
}

/** A well-formed 3D recording, as JSON reaches the parser. */
function recording(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: RECORDING_FORMAT,
    space: "3d",
    width: 640,
    height: 360,
    background: "#05060a",
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
    states: [state()],
    frames: [frame()],
    ...overrides,
  };
}

describe("reading a 3D recording", () => {
  it("accepts a recording written in the format it knows", () => {
    const parsed = parse3dRecording(recording());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.space).toBe("3d");
    expect(parsed.recording.width).toBe(640);
    expect(parsed.recording.background).toBe("#05060a");
    expect(parsed.recording.frames).toHaveLength(1);
  });

  it("carries the shared tables through to the player", () => {
    const parsed = parse3dRecording(
      recording({
        assets: [
          {
            kind: "texture",
            path: "textures/wall.png",
            width: 8,
            height: 8,
            src: "data:image/png;base64,",
          },
          {
            kind: "material",
            path: "materials/wall.json",
            maps: { baseColor: 0 },
          },
          { kind: "mesh", path: "meshes/ship.glb", data: "Z2xURg==" },
        ],
        resources: [
          {
            make: { method: "createBox", args: [{ x: 1, y: 1, z: 1 }] },
            then: [],
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.assets).toHaveLength(3);
    expect(parsed.recording.resources).toHaveLength(1);
    expect(parsed.recording.ops).toHaveLength(1);
    expect(parsed.recording.states).toHaveLength(1);
  });

  it("reads an explicit null background as the transparency it is", () => {
    const parsed = parse3dRecording(recording({ background: null }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.background).toBeNull();
  });

  it("accepts a recording with no frames, which is empty rather than damaged", () => {
    expect(parse3dRecording(recording({ frames: [] })).ok).toBe(true);
  });

  it("accepts a state carrying one light of each kind", () => {
    const parsed = parse3dRecording(
      recording({
        states: [
          state({
            lights: [
              { type: "ambient", color: "#ffffff", intensity: 0.4 },
              {
                type: "directional",
                color: "#ffffff",
                intensity: 0.85,
                direction: { x: -0.3, y: -1, z: -0.2 },
              },
              {
                type: "point",
                color: "#ff2d55",
                intensity: 2,
                position: { x: 0, y: 3, z: 0 },
                range: 12,
              },
            ],
          }),
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("accepts each of the four render modes", () => {
    for (const mode of ["standard", "wireframe", "unlit", "normals"]) {
      expect(
        parse3dRecording(recording({ states: [state({ mode })] })).ok,
      ).toBe(true);
    }
  });

  it("accepts a recipe made by each of the six producing calls", () => {
    const parsed = parse3dRecording(
      recording({
        resources: PRODUCING_METHODS.map((method) => ({
          make: { method, args: [] },
          then: [],
        })),
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("carries a frame's truncation flag through to the player", () => {
    // In 3D the flag means the one thing: the light list this frame inherited was
    // longer than the format carries and was cut down to the bound. The player
    // turns it into a line under the canvas, so it has to survive the parse rather
    // than being dropped as a field the parser does not recognise.
    const parsed = parse3dRecording(
      recording({ frames: [frame({ truncated: true })] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.frames[0]?.truncated).toBe(true);
  });

  it("reads a frame that does not mention truncation as one that was not truncated", () => {
    const parsed = parse3dRecording(recording());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.frames[0]?.truncated).toBeUndefined();
  });

  it("ignores a field this space does not have, rather than refusing the frame", () => {
    // There is no save stack in 3D, so a frame carrying a 2D document's `stack` is
    // carrying a field that means nothing here — and a field that means nothing is
    // a field a player ignores. The parser refuses documents it would draw wrong,
    // not documents that say more than it reads.
    expect(
      parse3dRecording(recording({ frames: [frame({ stack: [0] })] })).ok,
    ).toBe(true);
  });
});

describe("refusing a 3D recording", () => {
  it("refuses a recording that does not say what size it was drawn at", () => {
    expect(parse3dRecording(recording({ width: "640" })).ok).toBe(false);
  });

  it("refuses a recording that does not say what its frames were cleared to", () => {
    // Transparency is an explicit `null`, so an absent field is a document that
    // lost the field rather than one that was transparent.
    const parsed = parse3dRecording(recording({ background: undefined }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toMatch(/cleared to/i);
  });

  it("refuses a recording missing a table its frames index into", () => {
    expect(parse3dRecording(recording({ assets: undefined })).ok).toBe(false);
    expect(parse3dRecording(recording({ resources: undefined })).ok).toBe(
      false,
    );
    expect(parse3dRecording(recording({ ops: undefined })).ok).toBe(false);
    expect(parse3dRecording(recording({ states: undefined })).ok).toBe(false);
  });

  it("refuses a damaged frame, naming which one it is", () => {
    const parsed = parse3dRecording(
      recording({ frames: [frame(), frame({ surface: undefined })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 1");
  });

  it("refuses a frame naming an operation the recording does not carry", () => {
    const parsed = parse3dRecording(
      recording({ frames: [frame({ ops: [0, 4] })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
    expect(parsed.message).toContain("operation 4");
  });

  it("refuses a frame naming an inherited state the recording does not carry", () => {
    const parsed = parse3dRecording(
      recording({ frames: [frame({ state: 3 })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
    expect(parsed.message).toContain("state 3");
  });

  it("refuses a frame that says it was truncated as something other than a yes", () => {
    const parsed = parse3dRecording(
      recording({ frames: [frame({ truncated: "yes" })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
  });

  it("refuses an operation of an unknown kind, naming which one it is", () => {
    const parsed = parse3dRecording(
      recording({ ops: [{ op: "invoke", method: "drawLine", args: [] }] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("operation 0");
  });

  it("refuses a call with no method name to dispatch on", () => {
    expect(
      parse3dRecording(recording({ ops: [{ op: "call", args: [] }] })).ok,
    ).toBe(false);
  });

  it("accepts an operation naming a verb outside the vocabulary, which the drawer reports", () => {
    // Deliberately NOT a refusal. A method this player has no verb for costs the
    // reviewer that one call, skipped and named beside the frame it was in;
    // refusing the document over it would cost them every frame of the replay.
    expect(
      parse3dRecording(
        recording({ ops: [{ op: "call", method: "frob", args: [] }] }),
      ).ok,
    ).toBe(true);
  });

  it("refuses a state that carries no camera, or a camera that sits nowhere", () => {
    const missing = parse3dRecording(
      recording({ states: [state({ camera: undefined })] }),
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.message).toContain("state 0");
    expect(
      parse3dRecording(
        recording({
          states: [state({ camera: { ...CAMERA, position: { x: 0, y: 0 } } })],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parse3dRecording(
        recording({
          states: [
            state({ camera: { ...CAMERA, rotation: { x: 0, y: 0, z: 0 } } }),
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parse3dRecording(
        recording({ states: [state({ camera: { ...CAMERA, far: null } })] }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a state drawn in a render mode this player does not have", () => {
    const parsed = parse3dRecording(
      recording({ states: [state({ mode: "toon" })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("state 0");
    expect(parsed.message).toContain('"toon"');
  });

  it("refuses a state that carries no light list at all", () => {
    // An empty list is a state lit by nothing, which a build may well have drawn
    // under; a missing list is a state a player would light by guesswork.
    expect(
      parse3dRecording(recording({ states: [state({ lights: undefined })] }))
        .ok,
    ).toBe(false);
  });

  it("refuses a malformed light, naming which one it is", () => {
    const parsed = parse3dRecording(
      recording({
        states: [
          state({
            lights: [
              { type: "ambient", color: "#ffffff", intensity: 0.4 },
              { type: "directional", color: "#ffffff", intensity: 1 },
            ],
          }),
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("state 0");
    expect(parsed.message).toContain("light (1)");
    expect(parsed.message).toMatch(/no direction/i);
  });

  it("refuses a light of a kind this format does not have", () => {
    const parsed = parse3dRecording(
      recording({
        states: [
          state({ lights: [{ type: "spot", color: "#fff", intensity: 1 }] }),
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('"spot"');
  });

  it("refuses a point light with no reach, which is a light with no falloff", () => {
    expect(
      parse3dRecording(
        recording({
          states: [
            state({
              lights: [
                {
                  type: "point",
                  color: "#fff",
                  intensity: 1,
                  position: { x: 0, y: 0, z: 0 },
                },
              ],
            }),
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a light list longer than the format carries, however valid each entry is", () => {
    // The bound is part of the format — a recorder cuts the inherited list down to
    // it and says so on the frame — so nothing a recorder writes is refused here,
    // and everything this console did not write is. Checking each light's shape
    // and not the count would leave the whole cost of a two-hundred-thousand-light
    // state in range, paid on every frame that inherits it.
    const parsed = parse3dRecording(
      recording({ states: [state({ lights: lights(LIGHT_LIMIT + 1) })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("state 0");
    expect(parsed.message).toContain(String(LIGHT_LIMIT + 1));
    expect(parsed.message).toContain(String(LIGHT_LIMIT));
  });

  it("accepts a light list at the bound", () => {
    expect(
      parse3dRecording(
        recording({ states: [state({ lights: lights(LIGHT_LIMIT) })] }),
      ).ok,
    ).toBe(true);
  });

  it("refuses a recipe made by anything but a producing call", () => {
    // A recipe is re-issued against the scene the player is drawing into, which is
    // faithful only for a call whose answer does not depend on that scene. A call
    // that read the scene back, accepted here, would have the player draw the rest
    // of the frame under whatever this scene answered and report it as clean.
    const parsed = parse3dRecording(
      recording({
        resources: [{ make: { method: "drawGeometry", args: [] }, then: [] }],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("resource 0");
    expect(parsed.message).toContain("drawGeometry");
  });

  it("refuses a malformed resource, naming which one it is", () => {
    const parsed = parse3dRecording(
      recording({
        resources: [
          { make: { method: "createSphere", args: [1] }, then: [] },
          { make: { args: [] }, then: [] },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("resource 1");
  });

  it("refuses a resource whose steps are not operations", () => {
    expect(
      parse3dRecording(
        recording({
          resources: [
            {
              make: { method: "createPlane", args: [4, 4] },
              then: [{ op: "call", args: [] }],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parse3dRecording(
        recording({
          resources: [{ make: { method: "createPlane", args: [] }, then: 3 }],
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a recipe carrying more steps than the format does", () => {
    // A produced 3D value is immutable, so a conforming recipe has no steps at all
    // — but the mutation machinery is part of the format the two spaces share, and
    // a recipe of a hundred thousand steps is one a player would pay for on every
    // frame that draws the value.
    const parsed = parse3dRecording(
      recording({
        resources: [
          {
            make: { method: "createMaterial", args: [{}] },
            then: Array.from({ length: RECIPE_STEP_LIMIT + 1 }, () => ({
              op: "set",
              property: "baseColor",
              value: "#fff",
            })),
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("resource 0");
    expect(parsed.message).toContain(String(RECIPE_STEP_LIMIT));
  });

  it("refuses a malformed asset, naming which one it is", () => {
    const parsed = parse3dRecording(
      recording({
        assets: [
          { kind: "mesh", path: "meshes/ship.glb", data: "Z2xURg==" },
          { kind: "model", path: "meshes/other.glb", data: "Z2xURg==" },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("asset 1");
    expect(parsed.message).toContain('"model"');
  });

  it("refuses an asset of each kind that carries none of what rebuilds it", () => {
    // Which field is checked is the whole of what `kind` decides here: a mesh is a
    // glTF binary's bytes, a texture is a PNG and the size it decodes to, and a
    // material is the slots it names.
    expect(
      parse3dRecording(
        recording({ assets: [{ kind: "mesh", path: "meshes/ship.glb" }] }),
      ).ok,
    ).toBe(false);
    expect(
      parse3dRecording(
        recording({
          assets: [{ kind: "texture", path: "t.png", width: 8, height: 8 }],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parse3dRecording(
        recording({
          assets: [
            { kind: "texture", path: "t.png", src: "data:image/png;base64," },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parse3dRecording(
        recording({ assets: [{ kind: "material", path: "m.json" }] }),
      ).ok,
    ).toBe(false);
  });

  it("refuses an asset that does not say what it was loaded from", () => {
    // The path is what a report names when an entry fails to decode, and a
    // rasterized billboard's is the lettering itself (`text:` and the string), so
    // every kind carries one.
    expect(
      parse3dRecording(
        recording({ assets: [{ kind: "mesh", data: "Z2xURg==" }] }),
      ).ok,
    ).toBe(false);
  });

  it("accepts a material naming a texture in every slot the format has", () => {
    const parsed = parse3dRecording(
      recording({
        assets: [
          {
            kind: "texture",
            path: "textures/wall.png",
            width: 4,
            height: 4,
            src: "data:image/png;base64,",
          },
          {
            kind: "material",
            path: "materials/wall.json",
            maps: {
              baseColor: 0,
              normal: 0,
              roughness: 0,
              metallic: 0,
              ao: 0,
              emissive: 0,
              height: 0,
            },
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("refuses a material naming a slot this format does not carry", () => {
    const parsed = parse3dRecording(
      recording({
        assets: [
          {
            kind: "texture",
            path: "t.png",
            width: 4,
            height: 4,
            src: "data:image/png;base64,",
          },
          { kind: "material", path: "m.json", maps: { glow: 0 } },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("asset 1");
    expect(parsed.message).toContain('"glow"');
  });

  it("refuses a material naming a texture the recording does not carry", () => {
    const parsed = parse3dRecording(
      recording({
        assets: [{ kind: "material", path: "m.json", maps: { baseColor: 2 } }],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("asset 0");
    expect(parsed.message).toContain("baseColor");
  });

  it("refuses a material whose map is not a texture at all", () => {
    // Checked when the file is read rather than when a draw resolves it: a
    // material built over a mesh entry is a picture the player would draw
    // confidently and wrongly.
    const parsed = parse3dRecording(
      recording({
        assets: [
          { kind: "mesh", path: "meshes/ship.glb", data: "Z2xURg==" },
          { kind: "material", path: "m.json", maps: { baseColor: 0 } },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("asset 1");
    expect(parsed.message).toMatch(/not a texture/i);
  });
});
