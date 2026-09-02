import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  AssetLoader,
  cloneModel,
  type AssetApi,
  type AssetEventMap,
  type AssetLoaderOptions,
} from "./assets";
import type { Model } from "./contract";

/** One announced attempt, as a test reads it back. */
type Announced =
  | { event: "asset:loaded"; payload: AssetEventMap["asset:loaded"] }
  | { event: "asset:failed"; payload: AssetEventMap["asset:failed"] };

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
 * position a validator subscribing to `engine.events` is in.
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
function walkerBin(): Uint8Array {
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
 *
 * The names are the ones a `ModelComponent` is driven by: `"walk"` is what `play`
 * would be handed, `"turret"` is what `node` would be asked for.
 */
function walkerJson(
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
    scenes: [{ name: "walker", nodes: [0] }],
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
        name: "walk",
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
function walkerGlb(
  options: { textured?: boolean; unnamedChild?: boolean } = {},
) {
  return glb(walkerJson(options), walkerBin());
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

describe("the asset surface", () => {
  it("is the six documented members, and a loader is one", () => {
    const api: AssetApi = new AssetLoader();

    // The six `InitApi.assets`, `LoadApi.assets` and `world.assets` all expose.
    for (const member of [
      "loadImage",
      "loadTexture",
      "loadModel",
      "loadAudio",
      "load",
      "resolve",
    ] as const) {
      expect(typeof api[member], member).toBe("function");
    }
  });

  it("announces nowhere and fetches through the platform when given nothing", () => {
    // The engine supplies every collaborator, but a loader built bare must still
    // be a working object rather than one that throws on its first call: a test
    // that only wants `resolve` should not have to script a transport.
    const loader = new AssetLoader();

    expect(loader.resolve("models/walker.glb")).toBe(
      "assets/models/walker.glb",
    );
  });
});

describe("AssetLoader.resolve", () => {
  it("resolves a plain path under the default root", () => {
    expect(new AssetLoader().resolve("models/walker.glb")).toBe(
      "assets/models/walker.glb",
    );
  });

  it("resolves the documented examples exactly", () => {
    const loader = new AssetLoader();

    expect(loader.resolve("models/ship.glb")).toBe("assets/models/ship.glb");
    expect(loader.resolve("textures/hull.png")).toBe(
      "assets/textures/hull.png",
    );
    expect(loader.resolve("audio/theme.ogg")).toBe("assets/audio/theme.ogg");
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
      "../secrets.txt",
      "models/../../secret.glb",
      "https://example.com/ship.glb",
      "data:image/png;base64,AAAA",
      "blob:1234",
    ]) {
      expect(() => loader.resolve(path), path).toThrow();
    }
  });

  it("names why each refusal happened", () => {
    const loader = new AssetLoader();

    // The docs' path-rules table says what each refusal must name, and a build
    // reading the reason out of an `asset:failed` event is reading these strings.
    expect(() => loader.resolve("")).toThrow(/empty/);
    expect(() => loader.resolve("/models/ship.glb")).toThrow(
      /must not start with/,
    );
    expect(() => loader.resolve("https://example.com/ship.glb")).toThrow(
      /absolute URL/,
    );
    expect(() => loader.resolve("../secrets.txt")).toThrow(/".." segment/);
  });

  it("quotes the offending path and the root it escaped in each refusal", () => {
    const loader = new AssetLoader({ root: "build/media" });

    expect(() => loader.resolve("../secrets.txt")).toThrow(
      /"\.\.\/secrets\.txt".*"build\/media\/"/,
    );
  });

  it("does not mistake dots inside a name for an escape", () => {
    const loader = new AssetLoader();

    expect(loader.resolve("models/hero..idle.glb")).toBe(
      "assets/models/hero..idle.glb",
    );
    expect(loader.resolve("./walker.glb")).toBe("assets/./walker.glb");
  });

  it("announces nothing — resolving is URL arithmetic, not a load", () => {
    const { loader, announced, fetcher } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    loader.resolve("walker.glb");
    expect(() => loader.resolve("../walker.glb")).toThrow();

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

    const blob = await loader.load("levels/arena.json");

    expect(blob).toBe(asset.body);
    expect(fetcher).toHaveBeenCalledWith("assets/levels/arena.json");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: {
          path: "levels/arena.json",
          url: "assets/levels/arena.json",
        },
      },
    ]);
  });

  it("resolves through the configured root", async () => {
    const { loader, fetcher } = loaderWith(
      () => Promise.resolve(ok().response),
      { root: "build/media" },
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

    await expect(loader.loadImage("ui/reticle.png")).resolves.toBe(decoded);

    expect(decoder).toHaveBeenCalledWith(asset.body, undefined);
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "ui/reticle.png", url: "assets/ui/reticle.png" },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("fails by name on a host that cannot decode images", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await expect(loader.loadImage("reticle.png")).rejects.toThrow(
      /createImageBitmap/,
    );

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "reticle.png",
          url: "assets/reticle.png",
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

    await expect(loader.loadImage("reticle.png")).rejects.toThrow(/not a PNG/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "reticle.png",
          url: "assets/reticle.png",
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

    const texture = await loader.loadTexture("textures/hull.png");

    expect(texture).toBeInstanceOf(THREE.Texture);
    expect(texture.image).toBe(decoded);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(fetcher).toHaveBeenCalledWith("assets/textures/hull.png");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: {
          path: "textures/hull.png",
          url: "assets/textures/hull.png",
        },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("hands back something a material declaration's map takes directly", async () => {
    installDecoder();
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    const texture = await loader.loadTexture("textures/hull.png");
    // A `MaterialSpec`'s `map` is a `THREE.Texture`, and the pipeline assigns it
    // to a three material without touching color management. Doing exactly that
    // is the check.
    const material = new THREE.MeshStandardMaterial({ map: texture });

    expect(material.map).toBe(texture);
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    vi.unstubAllGlobals();
  });

  it("marks the texture dirty so the renderer uploads it", async () => {
    installDecoder();
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    const texture = await loader.loadTexture("hull.png");

    // `needsUpdate` is write-only on a three texture; the version counter it bumps
    // is what the renderer actually consults, and a fresh texture starts at zero.
    expect(texture.version).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("decodes the image already flipped, since three ignores flipY for a bitmap", async () => {
    const { decoder } = installDecoder();
    const asset = ok();
    const { loader } = loaderWith(() => Promise.resolve(asset.response));

    const texture = await loader.loadTexture("hull.png");

    expect(decoder).toHaveBeenCalledWith(asset.body, {
      imageOrientation: "flipY",
    });
    expect(texture.flipY).toBe(false);
    vi.unstubAllGlobals();
  });

  it("hands back a distinct texture per call, so two materials do not share one", async () => {
    installDecoder();
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    const first = await loader.loadTexture("hull.png");
    const second = await loader.loadTexture("hull.png");
    first.wrapS = THREE.RepeatWrapping;

    expect(first).not.toBe(second);
    expect(second.wrapS).toBe(THREE.ClampToEdgeWrapping);
    vi.unstubAllGlobals();
  });

  it("fails by name on a host that cannot decode images", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await expect(loader.loadTexture("hull.png")).rejects.toThrow(
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

    await expect(loader.loadTexture("hull.png")).rejects.toThrow(/not a PNG/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "hull.png",
          url: "assets/hull.png",
          reason: "not a PNG",
        },
      },
    ]);
    vi.unstubAllGlobals();
  });
});

describe("AssetLoader.loadModel", () => {
  it("decodes a .glb to its tree, its clips, and its node names", async () => {
    const { loader, fetcher, announced } = modelLoader(walkerGlb());

    const model = await loader.loadModel("models/walker.glb");

    expect(model.scene).toBeInstanceOf(THREE.Group);
    expect(model.scene.name).toBe("walker");
    expect(model.nodes).toEqual(["walker", "hull", "turret"]);
    expect(model.animations.map((clip) => clip.name)).toEqual(["walk"]);
    expect(model.animations[0]).toBeInstanceOf(THREE.AnimationClip);
    expect(fetcher).toHaveBeenCalledWith("assets/models/walker.glb");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "models/walker.glb", url: "assets/models/walker.glb" },
      },
    ]);
  });

  it("carries the two lists a ModelComponent is driven through", async () => {
    const { loader } = modelLoader(walkerGlb());

    const model = await loader.loadModel("models/walker.glb");

    // `animations` names what `play` accepts, `nodes` what `node` hands back a
    // handle for — both answerable off the loaded model without walking the tree,
    // which is the reason they are carried beside it at all.
    expect(model.animations.map((clip) => clip.name)).toContain("walk");
    expect(model.nodes.includes("turret")).toBe(true);
    expect(model.nodes.includes("no-such-joint")).toBe(false);
    expect(model.scene.getObjectByName("turret")).toBeDefined();
  });

  it("decodes the mesh the file describes, with its material", async () => {
    const { loader } = modelLoader(walkerGlb());

    const model = await loader.loadModel("models/walker.glb");
    const hull = model.scene.getObjectByName("hull");

    expect(hull).toBeInstanceOf(THREE.Mesh);
    const mesh = hull as THREE.Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
    expect((mesh.material as THREE.Material).name).toBe("paint");
  });

  it("lists node names in traversal order, omitting the nodes glTF left unnamed", async () => {
    const { loader } = modelLoader(walkerGlb({ unnamedChild: true }));

    const model = await loader.loadModel("models/walker.glb");

    expect(model.nodes).toEqual(["walker", "hull", "turret"]);
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
    const { loader, fetcher } = modelLoader(walkerGlb(), {
      root: "build/media",
    });

    await loader.loadModel("models/walker.glb");

    expect(fetcher).toHaveBeenCalledWith("build/media/models/walker.glb");
  });

  it("looks for a .gltf's side files beside the model, inside the root", async () => {
    // three reaches for the platform's own `fetch` for a `.gltf`'s side files,
    // never this module's injected one, so the base it resolves against is
    // observed by watching the global.
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
    const { loader } = modelLoader(walkerGlb({ textured: true }), {
      root: "build/media",
    });

    await loader.loadModel("models/walker.glb");

    expect(requested).toEqual(["build/media/models/hull.png"]);
    console_.mockRestore();
    vi.unstubAllGlobals();
  });

  it("arrives with its map unset when the host cannot decode the texture", async () => {
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    installDecoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("no such image"))),
    );
    const { loader, announced } = modelLoader(walkerGlb({ textured: true }));

    const model = await loader.loadModel("models/walker.glb");

    const mesh = model.scene.getObjectByName("hull") as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBeNull();
    // The value arrived, so the load is a success in every way an observer sees:
    // geometry and hierarchy whole, one bare material, one `asset:loaded`.
    expect(model.nodes).toEqual(["walker", "hull", "turret"]);
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

    await expect(loader.loadModel("models/walker.glb")).rejects.toThrow();

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
    expect(announced[0]?.payload.path).toBe("models/walker.glb");
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
    const { loader } = modelLoader(walkerGlb());

    const first = await loader.loadModel("models/walker.glb");
    const second = await loader.loadModel("models/walker.glb");

    expect(first.scene).not.toBe(second.scene);
    expect(second.nodes).toEqual(first.nodes);
  });

  it("leaves the template out of any scene, so placing one does not re-parent it", async () => {
    const { loader } = modelLoader(walkerGlb());

    const model = await loader.loadModel("models/walker.glb");

    expect(model.scene.parent).toBeNull();
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
        () => Promise.resolve(ok(bytes(walkerGlb())).response),
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

  it("reports an empty path identically in every loader too", async () => {
    installDecoder();
    for (const call of [
      (l: AssetLoader) => l.load(""),
      (l: AssetLoader) => l.loadImage(""),
      (l: AssetLoader) => l.loadTexture(""),
      (l: AssetLoader) => l.loadModel(""),
      (l: AssetLoader) => l.loadAudio(""),
    ]) {
      const { loader, fetcher, announced } = loaderWith(
        () => Promise.resolve(ok(bytes(walkerGlb())).response),
        {
          audioContext: audioContextYielding(() =>
            Promise.resolve({} as AudioBuffer),
          ),
        },
      );

      await expect(call(loader)).rejects.toThrow(/empty/);

      expect(fetcher).not.toHaveBeenCalled();
      expect(announced).toEqual([
        {
          event: "asset:failed",
          payload: {
            path: "",
            url: "",
            reason: expect.stringContaining("empty"),
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

  it("both announces and throws, so the level learns its model never arrived", async () => {
    const { loader, announced } = loaderWith(() => Promise.resolve(missing()));

    const rejection = await loader.loadModel("walker.glb").then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(announced).toHaveLength(1);
    expect(announced[0]?.payload.path).toBe("walker.glb");
  });

  it("rejects a network failure with the original error, announcing it once", async () => {
    const failure = new TypeError("Failed to fetch");
    const { loader, announced } = loaderWith(() => Promise.reject(failure));

    await expect(loader.load("walker.glb")).rejects.toBe(failure);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "walker.glb",
          url: "assets/walker.glb",
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

    await expect(loader.load("walker.glb")).rejects.toThrow(/stream closed/);

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });

  it("survives a thrown value that is not an Error", async () => {
    const { loader, announced } = loaderWith(() => Promise.reject("offline"));

    await expect(loader.load("walker.glb")).rejects.toBe("offline");

    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]).toMatchObject({ payload: { reason: "offline" } });
  });

  it("never turns a load that succeeded into one that also reported a failure", async () => {
    // A subscriber that throws is the game's problem, not the loader's, but an
    // observer must never see one call announce both outcomes — which is why the
    // success event is emitted outside the try block that catches decode errors.
    const announced: string[] = [];
    const loader = new AssetLoader({
      fetch: () => Promise.resolve(ok().response),
      emit: (event) => {
        announced.push(event);
        if (event === "asset:loaded") throw new Error("subscriber blew up");
      },
    });

    await expect(loader.load("walker.glb")).rejects.toThrow(
      /subscriber blew up/,
    );

    expect(announced).toEqual(["asset:loaded"]);
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
    const { loader, fetcher } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    for (let i = 0; i < 200; i += 1) {
      await loader.load("walker.glb");
    }

    // Nothing is cached and nothing is de-duplicated: holding the value is the
    // game instance's job, which is why the docs say `initialize` is where a file
    // the whole game needs is fetched.
    expect(fetcher).toHaveBeenCalledTimes(200);
    expect(retained(loader)).toBe(0);
  });

  it("holds no decoded model between loads", async () => {
    const { loader } = modelLoader(walkerGlb());

    for (let i = 0; i < 20; i += 1) {
      await loader.loadModel(`models/walker-${i}.glb`);
    }

    expect(retained(loader)).toBe(0);
  });
});

describe("the three loading moments", () => {
  it("is one loader, so a level's load and a tick's load are the same six members", async () => {
    // The engine hands the same object out as `InitApi.assets`, `LoadApi.assets`
    // and `world.assets`; what differs is who holds the result, not the loader.
    installDecoder();
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok(bytes(walkerGlb())).response),
    );
    const instanceApi: AssetApi = loader;
    const levelApi: AssetApi = loader;
    const worldApi: AssetApi = loader;

    const shared = await instanceApi.loadModel("models/walker.glb");
    const perLevel = await levelApi.loadTexture("textures/hull.png");
    const discovered = await worldApi.loadModel("models/crate.glb");

    expect(shared.nodes).toEqual(["walker", "hull", "turret"]);
    expect(perLevel).toBeInstanceOf(THREE.Texture);
    expect(discovered.nodes).toEqual(shared.nodes);
    expect(announced.map((a) => a.payload.path)).toEqual([
      "models/walker.glb",
      "textures/hull.png",
      "models/crate.glb",
    ]);
    vi.unstubAllGlobals();
  });

  it("settles a level's whole load before any of it is read, as the engine awaits it", async () => {
    // What a level's `load` actually writes: several loads awaited together, the
    // results held in a module the level's actors read as plain values. An actor
    // constructed afterwards must find decoded values, not promises.
    installDecoder();
    const { loader } = loaderWith(() =>
      Promise.resolve(ok(bytes(walkerGlb())).response),
    );

    const [texture, model] = await Promise.all([
      loader.loadTexture("textures/hull.png"),
      loader.loadModel("models/walker.glb"),
    ]);

    expect(texture).toBeInstanceOf(THREE.Texture);
    expect(model.scene).toBeInstanceOf(THREE.Group);
    // A component would be handed these directly, with no `await` in sight.
    expect(new THREE.MeshStandardMaterial({ map: texture }).map).toBe(texture);
    expect(cloneModel(model)).toBeInstanceOf(THREE.Group);
    vi.unstubAllGlobals();
  });

  it("lets a level with a fallback catch the rejection where it made the call", async () => {
    const { loader, announced } = loaderWith(() => Promise.resolve(missing()));

    const model = await loader
      .loadModel("models/walker.glb")
      .catch(() => riggedModel());

    // The load still announced its failure, so an observer sees the miss even
    // though the level absorbed it.
    expect(model.nodes).toEqual(["crew", "body", "hip", "arm"]);
    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });
});

describe("what a validator subscribes for", () => {
  it("gives a subscriber the file names a build asked for and which arrived", async () => {
    // The shape `validators/input-and-audio.md` and `validators/the-suite.md`
    // write: two arrays filled from the two events, read after the run.
    installDecoder();
    const loaded: string[] = [];
    const failed: string[] = [];
    const responses = new Map<string, () => Promise<Response>>([
      ["assets/textures/hull.png", () => Promise.resolve(ok().response)],
      ["assets/audio/theme.ogg", () => Promise.resolve(missing())],
    ]);
    const loader = new AssetLoader({
      fetch: (url) =>
        (responses.get(url) ?? (() => Promise.resolve(missing())))(),
      emit: (event, payload) => {
        if (event === "asset:loaded") loaded.push(payload.path);
        else failed.push(payload.path);
      },
    });

    await loader.loadTexture("textures/hull.png");
    await loader.loadAudio("audio/theme.ogg").catch(() => undefined);
    await loader.loadModel("../escape.glb").catch(() => undefined);

    expect(loaded).toEqual(["textures/hull.png"]);
    expect(failed).toEqual(["audio/theme.ogg", "../escape.glb"]);
    vi.unstubAllGlobals();
  });

  it("marks a refused path with an empty URL and a resolved miss with its URL", async () => {
    // The signature that separates "the engine rejected the path" from "the file
    // resolved and was missing", which is what a report has to distinguish.
    const { loader, announced } = loaderWith(() => Promise.resolve(missing()));

    await loader.load("levels/arena.json").catch(() => undefined);
    await loader.load("../secrets.txt").catch(() => undefined);

    expect(announced.map((a) => [a.payload.path, a.payload.url])).toEqual([
      ["levels/arena.json", "assets/levels/arena.json"],
      ["../secrets.txt", ""],
    ]);
  });

  it("carries a reason that names the refusal, the status, or the decode error", async () => {
    installDecoder();
    const { loader: refused, announced: onRefusal } = loaderWith(() =>
      Promise.resolve(ok().response),
    );
    await refused.load("/absolute.json").catch(() => undefined);

    const { loader: missed, announced: onMiss } = loaderWith(() =>
      Promise.resolve(missing(418)),
    );
    await missed.load("levels/arena.json").catch(() => undefined);

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("corrupt PNG"))),
    );
    const { loader: corrupt, announced: onDecode } = loaderWith(() =>
      Promise.resolve(ok().response),
    );
    await corrupt.loadTexture("textures/hull.png").catch(() => undefined);

    expect(onRefusal[0]?.payload).toMatchObject({
      reason: expect.stringContaining("must not start with"),
    });
    expect(onMiss[0]?.payload).toMatchObject({
      reason: expect.stringContaining("418"),
    });
    expect(onDecode[0]?.payload).toMatchObject({
      reason: expect.stringContaining("corrupt PNG"),
    });
    vi.unstubAllGlobals();
  });

  it("names the path in the produced tree a reader can go and find", async () => {
    // A path an event carries is the one the game passed; the URL beside it is
    // where it was looked for. A reader needs both and reproduces neither.
    const { loader, announced } = loaderWith(
      () => Promise.resolve(ok().response),
      { root: "build/media" },
    );

    await loader.load("levels/arena.json");

    expect(announced[0]?.payload).toEqual({
      path: "levels/arena.json",
      url: "build/media/levels/arena.json",
    });
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
    const { loader } = modelLoader(walkerGlb());
    const model = await loader.loadModel("models/walker.glb");

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

  it("clones a model decoded from glTF, sharing its geometry", async () => {
    const { loader } = modelLoader(walkerGlb());
    const model = await loader.loadModel("models/walker.glb");

    const placed = cloneModel(model);
    const hull = placed.getObjectByName("hull") as THREE.Mesh;
    const template = model.scene.getObjectByName("hull") as THREE.Mesh;

    expect(hull).toBeInstanceOf(THREE.Mesh);
    // Geometry is shared by reference, as three's own clone shares it: a hundred
    // placed walkers are a hundred transforms over one buffer.
    expect(hull.geometry).toBe(template.geometry);
    // The material is not, because the pipeline writes each component's opacity
    // onto the materials under its own object.
    expect(hull.material).not.toBe(template.material);
    expect(hull.material).toBeInstanceOf(
      (template.material as THREE.Material).constructor as new () => unknown,
    );
  });

  it("gives each clone materials of its own, sharing the maps they sample", () => {
    const map = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ color: "#336699", map });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = "hull";
    const scene = new THREE.Group();
    scene.add(mesh);
    const model: Model = { scene, animations: [], nodes: ["hull"] };

    const first = cloneModel(model).getObjectByName("hull") as THREE.Mesh;
    const second = cloneModel(model).getObjectByName("hull") as THREE.Mesh;
    const alpha = first.material as THREE.MeshStandardMaterial;
    const beta = second.material as THREE.MeshStandardMaterial;

    // Two placements are drawn through two materials, so a fade applied to one
    // leaves the other — and the template — as they stood.
    expect(alpha).not.toBe(beta);
    expect(alpha).not.toBe(material);
    alpha.opacity = 0.25;
    expect(beta.opacity).toBe(1);
    expect(material.opacity).toBe(1);
    // What the copies sample is the loaded texture itself, not a copy of it.
    expect(alpha.map).toBe(map);
    expect(beta.map).toBe(map);
    expect(`#${beta.color.getHexString()}`).toBe("#336699");
  });

  it("carries the clips a clone is animated with unchanged on the template", async () => {
    const { loader } = modelLoader(walkerGlb());
    const model = await loader.loadModel("models/walker.glb");

    const first = cloneModel(model);
    const second = cloneModel(model);

    // The clips live on the `Model`, not on a clone, so two components mixing the
    // same clip onto two clones read one list and pose two trees.
    expect(model.animations.map((clip) => clip.name)).toEqual(["walk"]);
    expect(first.getObjectByName("turret")).not.toBe(
      second.getObjectByName("turret"),
    );
  });
});
