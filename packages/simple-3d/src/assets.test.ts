import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { AssetLoader, cloneModel, type AssetLoaderOptions } from "./assets";
import type { EngineEventMap, Model } from "./contract";

/** One announced attempt, as a test reads it back. */
type Announced =
  | { event: "asset:loaded"; payload: EngineEventMap["asset:loaded"] }
  | { event: "asset:failed"; payload: EngineEventMap["asset:failed"] };

/**
 * A response that carries a body, as a successful `fetch` would. The blob is
 * created once and handed back by identity, so a test can prove the loader
 * returned *that* body rather than one it constructed itself (jsdom's `Blob` has
 * no readable text).
 */
function ok(body: Blob = new Blob(["pixels"])): {
  response: Response;
  body: Blob;
} {
  return {
    response: {
      ok: true,
      status: 200,
      blob: () => Promise.resolve(body),
    } as unknown as Response,
    body,
  };
}

/** A response the server refused — reached, but not an asset. */
function missing(status = 404): Response {
  return {
    ok: false,
    status,
    blob: () => Promise.resolve(new Blob([])),
  } as unknown as Response;
}

/**
 * A blob whose bytes can be read, which jsdom's own `Blob` cannot promise across
 * versions. The audio and model paths both read bytes, so both go through this.
 */
function bytes(buffer: ArrayBuffer = new ArrayBuffer(8)): Blob {
  return {
    arrayBuffer: () => Promise.resolve(buffer),
  } as unknown as Blob;
}

/**
 * A loader over a scripted fetcher, plus the spy so requested URLs can be read
 * back and the list every announcement lands in.
 *
 * The recorder is the test's, not the loader's: the loader keeps nothing, so a
 * test that wants a history has to keep one itself — which is exactly the
 * position a driver is in.
 */
function loaderWith(
  response: () => Promise<Response>,
  options: Omit<AssetLoaderOptions, "fetch" | "emit"> = {},
) {
  const fetcher = vi.fn(response);
  const announced: Announced[] = [];
  const loader = new AssetLoader({
    ...options,
    fetch: fetcher,
    emit: (event, payload) => {
      announced.push({ event, payload } as Announced);
    },
  });
  return { loader, fetcher, announced };
}

/** An `AudioContext` stand-in that decodes to a buffer chosen by the test. */
function audioContextYielding(
  decode: () => Promise<AudioBuffer>,
): () => AudioContext {
  return () => ({ decodeAudioData: () => decode() }) as unknown as AudioContext;
}

/** A stand-in `ImageBitmap`, installed as the global decoder's result. */
function bitmap(): ImageBitmap {
  return { width: 8, height: 8, close: () => {} } as unknown as ImageBitmap;
}

/**
 * Installs an image decoder that yields `decoded` and records how it was asked,
 * which is how the orientation `loadTexture` requests is observed.
 */
function installDecoder(decoded: ImageBitmap = bitmap()) {
  const decoder = vi.fn((_blob: Blob, _options?: ImageBitmapOptions) =>
    Promise.resolve(decoded),
  );
  vi.stubGlobal("createImageBitmap", decoder);
  return { decoder, decoded };
}

/**
 * How much the loader is holding, counted without naming a field.
 *
 * The claim under test is that nothing here grows with the number of loads, and
 * the honest way to check it is to look at every own value the loader carries and
 * assert none of them is a collection with anything in it. Naming the field would
 * make this a test of the implementation; counting them all makes it a test of
 * the claim.
 */
function retained(loader: AssetLoader): number {
  return Object.values(loader).reduce<number>((total, value) => {
    if (Array.isArray(value)) return total + value.length;
    if (value instanceof Map || value instanceof Set) return total + value.size;
    return total;
  }, 0);
}

/* -------------------------------------------------------------------------- */
/* glTF fixtures                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The bytes of a UTF-8 string, as their own exactly-sized buffer.
 *
 * Copied into a freshly constructed `ArrayBuffer` rather than handed the encoder's
 * own: under jsdom the encoder's buffer belongs to another realm, and three
 * branches on `data instanceof ArrayBuffer` to tell glTF bytes from a glTF
 * document. A real `Blob.arrayBuffer()` has no such problem; the copy is what
 * makes the fixture behave like one.
 */
function utf8(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

/**
 * A `.glb` container around a glTF JSON document and its binary chunk.
 *
 * Hand-built rather than checked in as a fixture file so each test states the
 * document it is about: the scene graph, the animation, and the texture reference
 * under test are all visible in the test that depends on them.
 */
function glb(json: unknown, bin?: Uint8Array): ArrayBuffer {
  const jsonBytes = new Uint8Array(utf8(JSON.stringify(json)));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binBytes = bin ?? new Uint8Array(0);
  const binPad = (4 - (binBytes.length % 4)) % 4;
  const binChunk = bin === undefined ? 0 : 8 + binBytes.length + binPad;
  const total = 12 + 8 + jsonBytes.length + jsonPad + binChunk;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true); // glTF 2.0
  view.setUint32(8, total, true);

  let at = 12;
  view.setUint32(at, jsonBytes.length + jsonPad, true);
  view.setUint32(at + 4, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, at + 8);
  // The JSON chunk pads with spaces and the binary chunk with zeroes, per the
  // container's own rules; a decoder that trimmed neither would still parse.
  out.fill(
    0x20,
    at + 8 + jsonBytes.length,
    at + 8 + jsonBytes.length + jsonPad,
  );
  at += 8 + jsonBytes.length + jsonPad;

  if (bin !== undefined) {
    view.setUint32(at, binBytes.length + binPad, true);
    view.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
    out.set(binBytes, at + 8);
  }

  return buffer;
}

/** Positions for one triangle, the two animation times, and two rotations. */
function shipBin(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const times = new Float32Array([0, 1]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]);
  const bin = new Uint8Array(
    positions.byteLength + times.byteLength + rotations.byteLength,
  );
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(times.buffer), positions.byteLength);
  bin.set(
    new Uint8Array(rotations.buffer),
    positions.byteLength + times.byteLength,
  );
  return bin;
}

/**
 * A glTF document with a named scene, a named mesh node, a named child, one
 * animation clip, and — when `textured` — a material whose base color map is an
 * image beside the model.
 */
function shipJson(
  options: { textured?: boolean; unnamedChild?: boolean } = {},
) {
  const nodes: unknown[] = [
    { name: "hull", mesh: 0, children: [1] },
    { name: "turret" },
  ];
  if (options.unnamedChild) {
    nodes[0] = { name: "hull", mesh: 0, children: [1, 2] };
    nodes.push({});
  }
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ name: "ship", nodes: [0] }],
    nodes,
    meshes: [
      {
        name: "hull-mesh",
        primitives: [{ attributes: { POSITION: 0 }, material: 0 }],
      },
    ],
    materials: [
      options.textured
        ? {
            name: "paint",
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
          }
        : { name: "paint" },
    ],
    ...(options.textured
      ? { textures: [{ source: 0 }], images: [{ uri: "hull.png" }] }
      : {}),
    animations: [
      {
        name: "spin",
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
        samplers: [{ input: 1, output: 2, interpolation: "LINEAR" }],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 2,
        type: "SCALAR",
        min: [0],
        max: [1],
      },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC4" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 32 },
    ],
    buffers: [{ byteLength: 76 }],
  };
}

/** The whole `.glb` a model test loads. */
function shipGlb(options: { textured?: boolean; unnamedChild?: boolean } = {}) {
  return glb(shipJson(options), shipBin());
}

/** A loader whose one fetch answers with these glTF bytes. */
function modelLoader(
  buffer: ArrayBuffer,
  options: Omit<AssetLoaderOptions, "fetch" | "emit"> = {},
) {
  return loaderWith(() => Promise.resolve(ok(bytes(buffer)).response), options);
}

/* -------------------------------------------------------------------------- */
/* Rigs                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A hand-built rigged template: a group holding a skinned mesh whose two bones
 * live inside it.
 *
 * Built with three directly rather than decoded from glTF because the claim under
 * test is about the clone's *bindings*, and a hand-built rig lets a test hold the
 * template's own skeleton and bones by identity.
 */
function riggedModel(): Model {
  const hip = new THREE.Bone();
  hip.name = "hip";
  const arm = new THREE.Bone();
  arm.name = "arm";
  hip.add(arm);

  const mesh = new THREE.SkinnedMesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  mesh.name = "body";
  mesh.add(hip);
  mesh.bind(new THREE.Skeleton([hip, arm]));

  const scene = new THREE.Group();
  scene.name = "crew";
  scene.add(mesh);

  return { scene, animations: [], nodes: ["crew", "body", "hip", "arm"] };
}

/** The skinned mesh inside a placed rig, by the name the template gave it. */
function skinned(root: THREE.Object3D): THREE.SkinnedMesh {
  const mesh = root.getObjectByName("body");
  if (!(mesh instanceof THREE.SkinnedMesh)) {
    throw new Error("the rig has no skinned mesh named body");
  }
  return mesh;
}

describe("AssetLoader.resolve", () => {
  it("resolves a plain path under the default root", () => {
    expect(new AssetLoader().resolve("models/ship.glb")).toBe(
      "assets/models/ship.glb",
    );
  });

  it("takes a custom root, with or without its trailing slash", () => {
    expect(new AssetLoader({ root: "media" }).resolve("a.png")).toBe(
      "media/a.png",
    );
    expect(new AssetLoader({ root: "media/" }).resolve("a.png")).toBe(
      "media/a.png",
    );
  });

  it("leaves an empty root empty rather than making every path absolute", () => {
    expect(new AssetLoader({ root: "" }).resolve("a.png")).toBe("a.png");
  });

  it("refuses every way a path could name something outside the root", () => {
    const loader = new AssetLoader();
    for (const path of [
      "",
      "/etc/passwd",
      "//cdn.example.com/x.png",
      "../secret.png",
      "models/../../secret.glb",
      "https://cdn.example.com/x.glb",
      "data:image/png;base64,AAAA",
      "blob:1234",
    ]) {
      expect(() => loader.resolve(path), path).toThrow();
    }
  });

  it("names why each refusal happened", () => {
    const loader = new AssetLoader();
    expect(() => loader.resolve("")).toThrow(/empty/);
    expect(() => loader.resolve("/a.png")).toThrow(/must not start with/);
    expect(() => loader.resolve("https://x/a.png")).toThrow(/absolute URL/);
    expect(() => loader.resolve("../a.png")).toThrow(/".." segment/);
  });

  it("does not mistake dots inside a name for an escape", () => {
    const loader = new AssetLoader();
    expect(loader.resolve("models/hero..idle.glb")).toBe(
      "assets/models/hero..idle.glb",
    );
    expect(loader.resolve("./ship.glb")).toBe("assets/./ship.glb");
  });

  it("announces nothing — resolving is URL arithmetic, not a load", () => {
    const { loader, announced, fetcher } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    loader.resolve("ship.glb");
    expect(() => loader.resolve("../ship.glb")).toThrow();

    expect(announced).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("AssetLoader.load", () => {
  it("fetches the resolved URL, returns the body, and announces the arrival", async () => {
    const asset = ok();
    const { loader, fetcher, announced } = loaderWith(() =>
      Promise.resolve(asset.response),
    );

    const blob = await loader.load("levels/01.json");

    expect(blob).toBe(asset.body);
    expect(fetcher).toHaveBeenCalledWith("assets/levels/01.json");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "levels/01.json", url: "assets/levels/01.json" },
      },
    ]);
  });

  it("resolves through the configured root", async () => {
    const { loader, fetcher } = loaderWith(
      () => Promise.resolve(ok().response),
      {
        root: "build/media",
      },
    );

    await loader.load("a.json");

    expect(fetcher).toHaveBeenCalledWith("build/media/a.json");
  });

  it("announces exactly one event per call, in request order", async () => {
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await loader.load("a.json");
    await loader.load("b.json");

    expect(announced.map((a) => [a.event, a.payload.path])).toEqual([
      ["asset:loaded", "a.json"],
      ["asset:loaded", "b.json"],
    ]);
  });
});

describe("AssetLoader.loadImage", () => {
  it("decodes the body to a bitmap and announces the arrival", async () => {
    const { decoder, decoded } = installDecoder();
    const asset = ok();
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(asset.response),
    );

    await expect(loader.loadImage("ui/hook.png")).resolves.toBe(decoded);

    expect(decoder).toHaveBeenCalledWith(asset.body, undefined);
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "ui/hook.png", url: "assets/ui/hook.png" },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("fails by name on a host that cannot decode images", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await expect(loader.loadImage("hook.png")).rejects.toThrow(
      /createImageBitmap/,
    );

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "hook.png",
          url: "assets/hook.png",
          reason: expect.stringContaining("createImageBitmap"),
        },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("reports a body that arrived but would not decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("not a PNG"))),
    );
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await expect(loader.loadImage("hook.png")).rejects.toThrow(/not a PNG/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "hook.png",
          url: "assets/hook.png",
          reason: "not a PNG",
        },
      },
    ]);
    vi.unstubAllGlobals();
  });
});

describe("AssetLoader.loadTexture", () => {
  it("wraps the decoded image as an sRGB texture and announces the arrival", async () => {
    const { decoded } = installDecoder();
    const { loader, fetcher, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    const texture = await loader.loadTexture("textures/gravel.png");

    expect(texture).toBeInstanceOf(THREE.Texture);
    expect(texture.image).toBe(decoded);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(fetcher).toHaveBeenCalledWith("assets/textures/gravel.png");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: {
          path: "textures/gravel.png",
          url: "assets/textures/gravel.png",
        },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("marks the texture dirty so the renderer uploads it", async () => {
    installDecoder();
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    const texture = await loader.loadTexture("gravel.png");

    // `needsUpdate` is write-only on a three texture; the version counter it bumps
    // is what the renderer actually consults, and a fresh texture starts at zero.
    expect(texture.version).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("decodes the image already flipped, since three ignores flipY for a bitmap", async () => {
    const { decoder } = installDecoder();
    const asset = ok();
    const { loader } = loaderWith(() => Promise.resolve(asset.response));

    const texture = await loader.loadTexture("gravel.png");

    expect(decoder).toHaveBeenCalledWith(asset.body, {
      imageOrientation: "flipY",
    });
    expect(texture.flipY).toBe(false);
    vi.unstubAllGlobals();
  });

  it("hands back a distinct texture per call, so two materials do not share one", async () => {
    installDecoder();
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    const first = await loader.loadTexture("gravel.png");
    const second = await loader.loadTexture("gravel.png");

    expect(first).not.toBe(second);
    vi.unstubAllGlobals();
  });

  it("fails by name on a host that cannot decode images", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await expect(loader.loadTexture("gravel.png")).rejects.toThrow(
      /createImageBitmap/,
    );

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
    vi.unstubAllGlobals();
  });

  it("reports a body that arrived but would not decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("not a PNG"))),
    );
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await expect(loader.loadTexture("gravel.png")).rejects.toThrow(/not a PNG/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "gravel.png",
          url: "assets/gravel.png",
          reason: "not a PNG",
        },
      },
    ]);
    vi.unstubAllGlobals();
  });
});

describe("AssetLoader.loadModel", () => {
  it("decodes a .glb to its tree, its clips, and its node names", async () => {
    const { loader, fetcher, announced } = modelLoader(shipGlb());

    const model = await loader.loadModel("models/ship.glb");

    expect(model.scene).toBeInstanceOf(THREE.Group);
    expect(model.scene.name).toBe("ship");
    expect(model.nodes).toEqual(["ship", "hull", "turret"]);
    expect(model.animations.map((clip) => clip.name)).toEqual(["spin"]);
    expect(model.animations[0]).toBeInstanceOf(THREE.AnimationClip);
    expect(fetcher).toHaveBeenCalledWith("assets/models/ship.glb");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "models/ship.glb", url: "assets/models/ship.glb" },
      },
    ]);
  });

  it("decodes the mesh the file describes, with its material", async () => {
    const { loader } = modelLoader(shipGlb());

    const model = await loader.loadModel("models/ship.glb");
    const hull = model.scene.getObjectByName("hull");

    expect(hull).toBeInstanceOf(THREE.Mesh);
    const mesh = hull as THREE.Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
    expect((mesh.material as THREE.Material).name).toBe("paint");
  });

  it("lists node names in traversal order, omitting the nodes glTF left unnamed", async () => {
    const { loader } = modelLoader(shipGlb({ unnamedChild: true }));

    const model = await loader.loadModel("models/ship.glb");

    expect(model.nodes).toEqual(["ship", "hull", "turret"]);
    // The unnamed node is still in the tree; it just has no name to list.
    expect(model.scene.getObjectByName("hull")?.children).toHaveLength(2);
  });

  it("decodes a .gltf whose body is JSON text rather than a container", async () => {
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ name: "yard", nodes: [0] }],
      nodes: [{ name: "gate" }],
    };
    const { loader } = modelLoader(utf8(JSON.stringify(json)));

    const model = await loader.loadModel("models/yard.gltf");

    expect(model.nodes).toEqual(["yard", "gate"]);
    expect(model.animations).toEqual([]);
  });

  it("resolves through the configured root", async () => {
    const { loader, fetcher } = modelLoader(shipGlb(), { root: "build/media" });

    await loader.loadModel("models/ship.glb");

    expect(fetcher).toHaveBeenCalledWith("build/media/models/ship.glb");
  });

  it("arrives with its map unset when the host cannot decode the texture", async () => {
    // three reaches for the platform's own `fetch` for a `.gltf`'s side files,
    // never this module's injected one, so a texture is failed by failing that.
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    const requested: string[] = [];
    installDecoder();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        requested.push(url);
        return Promise.reject(new Error("no such image"));
      }),
    );
    const { loader, announced } = modelLoader(shipGlb({ textured: true }));

    const model = await loader.loadModel("models/ship.glb");

    // The side file was looked for beside the model, inside the asset root.
    expect(requested).toEqual(["assets/models/hull.png"]);
    const mesh = model.scene.getObjectByName("hull") as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBeNull();
    // The value arrived, so the load is a success in every way an observer sees.
    expect(announced.map((a) => a.event)).toEqual(["asset:loaded"]);
    console_.mockRestore();
    vi.unstubAllGlobals();
  });

  it("rejects a file that decodes but defines no scene to place", async () => {
    const { loader, announced } = modelLoader(
      glb({ asset: { version: "2.0" }, nodes: [{ name: "loose" }] }),
    );

    await expect(loader.loadModel("models/parts.glb")).rejects.toThrow(
      /models\/parts\.glb.*no scene/,
    );

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "models/parts.glb",
          url: "assets/models/parts.glb",
          reason: expect.stringContaining("no scene"),
        },
      },
    ]);
  });

  it("reports a body that arrived but is not glTF at all", async () => {
    const { loader, announced } = modelLoader(utf8("this is not a model"));

    await expect(loader.loadModel("models/ship.glb")).rejects.toThrow();

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
    expect(announced[0]?.payload.path).toBe("models/ship.glb");
  });

  it("reports a glTF older than the version the engine decodes", async () => {
    const { loader, announced } = modelLoader(
      utf8(JSON.stringify({ asset: { version: "1.0" }, scenes: [{}] })),
    );

    await expect(loader.loadModel("models/ancient.gltf")).rejects.toThrow(
      /2\.0/,
    );

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });

  it("hands back an independent tree per call, so one file can be loaded twice", async () => {
    const { loader } = modelLoader(shipGlb());

    const first = await loader.loadModel("models/ship.glb");
    const second = await loader.loadModel("models/ship.glb");

    expect(first.scene).not.toBe(second.scene);
    expect(second.nodes).toEqual(first.nodes);
  });
});

describe("AssetLoader.loadAudio", () => {
  it("decodes the body to an audio buffer and announces the arrival", async () => {
    const decoded = { duration: 1 } as unknown as AudioBuffer;
    const { loader, announced } = loaderWith(
      () => Promise.resolve(ok(bytes()).response),
      {
        audioContext: audioContextYielding(() => Promise.resolve(decoded)),
      },
    );

    await expect(loader.loadAudio("audio/theme.ogg")).resolves.toBe(decoded);

    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "audio/theme.ogg", url: "assets/audio/theme.ogg" },
      },
    ]);
  });

  it("builds at most one context however many sounds are loaded", async () => {
    const factory = vi.fn(
      audioContextYielding(() => Promise.resolve({} as AudioBuffer)),
    );
    const { loader } = loaderWith(() => Promise.resolve(ok(bytes()).response), {
      audioContext: factory,
    });

    await loader.loadAudio("a.ogg");
    await loader.loadAudio("b.ogg");
    await loader.loadAudio("c.ogg");

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("degrades rather than throwing on a host with no Web Audio", async () => {
    const { loader, announced } = loaderWith(
      () => Promise.resolve(ok(bytes()).response),
      {
        audioContext: () => null,
      },
    );

    await expect(loader.loadAudio("theme.ogg")).rejects.toThrow(/AudioContext/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "theme.ogg",
          url: "assets/theme.ogg",
          reason: expect.stringContaining("AudioContext"),
        },
      },
    ]);
  });

  it("asks again for a context that was not available yet", async () => {
    let context: AudioContext | null = null;
    const { loader } = loaderWith(() => Promise.resolve(ok(bytes()).response), {
      audioContext: () => context,
    });

    await expect(loader.loadAudio("a.ogg")).rejects.toThrow(/AudioContext/);
    context = audioContextYielding(() => Promise.resolve({} as AudioBuffer))();
    await expect(loader.loadAudio("a.ogg")).resolves.toBeDefined();
  });

  it("reports a body that arrived but would not decode", async () => {
    const { loader, announced } = loaderWith(
      () => Promise.resolve(ok(bytes()).response),
      {
        audioContext: audioContextYielding(() =>
          Promise.reject(new Error("unsupported codec")),
        ),
      },
    );

    await expect(loader.loadAudio("theme.ogg")).rejects.toThrow(
      /unsupported codec/,
    );

    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced).toHaveLength(1);
  });
});

describe("AssetLoader failures", () => {
  it("refuses an escaping path identically in every loader, announcing no URL", async () => {
    installDecoder();
    for (const call of [
      (l: AssetLoader) => l.load("../../etc/passwd"),
      (l: AssetLoader) => l.loadImage("../../etc/passwd"),
      (l: AssetLoader) => l.loadTexture("../../etc/passwd"),
      (l: AssetLoader) => l.loadModel("../../etc/passwd"),
      (l: AssetLoader) => l.loadAudio("../../etc/passwd"),
    ]) {
      const { loader, fetcher, announced } = loaderWith(
        () => Promise.resolve(ok(bytes(shipGlb())).response),
        {
          audioContext: audioContextYielding(() =>
            Promise.resolve({} as AudioBuffer),
          ),
        },
      );

      await expect(call(loader)).rejects.toThrow(/escapes the asset root/);

      expect(fetcher).not.toHaveBeenCalled();
      expect(announced).toEqual([
        {
          event: "asset:failed",
          payload: {
            path: "../../etc/passwd",
            url: "",
            reason: expect.stringContaining("escapes the asset root"),
          },
        },
      ]);
    }
    vi.unstubAllGlobals();
  });

  it("names the status of a response the server refused, in every loader", async () => {
    installDecoder();
    for (const call of [
      (l: AssetLoader) => l.load("a.json"),
      (l: AssetLoader) => l.loadImage("a.png"),
      (l: AssetLoader) => l.loadTexture("a.png"),
      (l: AssetLoader) => l.loadModel("a.glb"),
      (l: AssetLoader) => l.loadAudio("a.ogg"),
    ]) {
      const { loader, announced } = loaderWith(
        () => Promise.resolve(missing(503)),
        {
          audioContext: audioContextYielding(() =>
            Promise.resolve({} as AudioBuffer),
          ),
        },
      );

      await expect(call(loader)).rejects.toThrow(/503/);

      expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
      expect(announced[0]?.payload).toMatchObject({
        reason: expect.stringContaining("503"),
      });
    }
    vi.unstubAllGlobals();
  });

  it("both announces and throws, so the game learns its model never arrived", async () => {
    const { loader, announced } = loaderWith(() => Promise.resolve(missing()));

    const rejection = await loader.loadModel("ship.glb").then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(announced).toHaveLength(1);
    expect(announced[0]?.payload.path).toBe("ship.glb");
  });

  it("rejects a network failure with the original error, announcing it once", async () => {
    const failure = new TypeError("Failed to fetch");
    const { loader, announced } = loaderWith(() => Promise.reject(failure));

    await expect(loader.load("ship.glb")).rejects.toBe(failure);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "ship.glb",
          url: "assets/ship.glb",
          reason: "Failed to fetch",
        },
      },
    ]);
  });

  it("does not call a load successful until the body has actually been read", async () => {
    const truncated = {
      ok: true,
      status: 200,
      blob: () => Promise.reject(new Error("stream closed")),
    } as unknown as Response;
    const { loader, announced } = loaderWith(() => Promise.resolve(truncated));

    await expect(loader.load("ship.glb")).rejects.toThrow(/stream closed/);

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });

  it("survives a thrown value that is not an Error", async () => {
    const { loader, announced } = loaderWith(() => Promise.reject("offline"));

    await expect(loader.load("ship.glb")).rejects.toBe("offline");

    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]).toMatchObject({ payload: { reason: "offline" } });
  });
});

describe("AssetLoader boundedness", () => {
  it("holds nothing that grows with the number of loads", async () => {
    let attempts = 0;
    const { loader, announced } = loaderWith(() => {
      attempts += 1;
      // Alternate the outcomes so a record of failures would grow just as a
      // record of successes would.
      return Promise.resolve(attempts % 2 === 0 ? missing() : ok().response);
    });

    for (let i = 0; i < 200; i += 1) {
      await loader.load(`level-${i}.json`).catch(() => undefined);
    }

    expect(announced).toHaveLength(200);
    expect(retained(loader)).toBe(0);
  });

  it("holds nothing after repeated loads of the same path either", async () => {
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    for (let i = 0; i < 200; i += 1) {
      await loader.load("ship.glb");
    }

    expect(retained(loader)).toBe(0);
  });

  it("holds no decoded model between loads", async () => {
    const { loader } = modelLoader(shipGlb());

    for (let i = 0; i < 20; i += 1) {
      await loader.loadModel(`models/ship-${i}.glb`);
    }

    expect(retained(loader)).toBe(0);
  });
});

describe("cloneModel", () => {
  it("copies the tree rather than handing back the template", () => {
    const model = riggedModel();

    const placed = cloneModel(model);

    expect(placed).not.toBe(model.scene);
    expect(placed).toBeInstanceOf(THREE.Group);
    expect(placed.getObjectByName("body")).not.toBe(
      model.scene.getObjectByName("body"),
    );
  });

  it("keeps every node name, so a joint is still reached by name", async () => {
    const { loader } = modelLoader(shipGlb());
    const model = await loader.loadModel("models/ship.glb");

    const placed = cloneModel(model);

    for (const name of model.nodes) {
      expect(placed.getObjectByName(name), name).toBeDefined();
    }
    expect(placed.getObjectByName("turret")).not.toBe(
      model.scene.getObjectByName("turret"),
    );
  });

  it("leaves the template at its rest pose however the clone is posed", () => {
    const model = riggedModel();
    model.scene.position.set(1, 2, 3);

    const placed = cloneModel(model);
    placed.position.set(9, 9, 9);
    const arm = placed.getObjectByName("arm");
    arm?.rotation.set(0.5, 0, 0);

    expect(model.scene.position.toArray()).toEqual([1, 2, 3]);
    expect(model.scene.getObjectByName("arm")?.rotation.x).toBe(0);
  });

  it("poses two clones of one template independently", () => {
    const model = riggedModel();

    const first = cloneModel(model);
    const second = cloneModel(model);
    first.getObjectByName("hip")?.position.set(0, 1, 0);

    expect(first.getObjectByName("hip")?.position.y).toBe(1);
    expect(second.getObjectByName("hip")?.position.y).toBe(0);
  });

  it("binds a skinned mesh to the skeleton inside its own clone", () => {
    const model = riggedModel();
    const template = skinned(model.scene);

    const placed = cloneModel(model);
    const mesh = skinned(placed);

    expect(mesh.skeleton).not.toBe(template.skeleton);
    expect(mesh.skeleton.bones).toHaveLength(2);
    expect(mesh.skeleton.bones[0]).toBe(placed.getObjectByName("hip"));
    expect(mesh.skeleton.bones[1]).toBe(placed.getObjectByName("arm"));
    for (const bone of mesh.skeleton.bones) {
      expect(template.skeleton.bones).not.toContain(bone);
    }
  });

  it("gives two rigged clones skeletons that move out of step", () => {
    const model = riggedModel();

    const first = skinned(cloneModel(model));
    const second = skinned(cloneModel(model));
    first.skeleton.bones[0]?.rotation.set(0, 1, 0);

    expect(first.skeleton).not.toBe(second.skeleton);
    expect(second.skeleton.bones[0]?.rotation.y).toBe(0);
    expect(skinned(model.scene).skeleton.bones[0]?.rotation.y).toBe(0);
  });

  it("clones a model decoded from glTF, geometry and material included", async () => {
    const { loader } = modelLoader(shipGlb());
    const model = await loader.loadModel("models/ship.glb");

    const placed = cloneModel(model);
    const hull = placed.getObjectByName("hull") as THREE.Mesh;

    expect(hull).toBeInstanceOf(THREE.Mesh);
    // Geometry and materials are shared by reference, as three's own clone shares
    // them: a hundred placed ships are a hundred transforms over one buffer.
    expect(hull.geometry).toBe(
      (model.scene.getObjectByName("hull") as THREE.Mesh).geometry,
    );
    expect(hull.material).toBe(
      (model.scene.getObjectByName("hull") as THREE.Mesh).material,
    );
  });
});
