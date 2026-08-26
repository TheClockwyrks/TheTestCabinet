import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  AssetLoader,
  type AssetEventMap,
  type AssetLoaderOptions,
  type TextureHandle,
  materialSource,
  meshSource,
  registerTexture,
  textureSource,
} from "./assets";

/**
 * The asset loader alone: the path rules, the one-event-per-call contract,
 * the outcome table, the handles' documented fields, and the engine's own
 * decoding of PNG, WAV, and glTF binaries. The decoders' internals are pinned
 * in `png.test.ts` and `wav.test.ts`; here they appear only as the reason a
 * load resolves headless. Every fixture is built byte by byte in this file,
 * so an expectation is hand-derivable from the container formats rather than
 * from a binary checked in blind, and the fetcher is a scripted route table —
 * which is exactly the position a validator's suite is in when it installs a
 * `fetch` over the seeded asset directory.
 */

/** One announced attempt, as a test reads it back. */
type Announced =
  | { event: "asset:loaded"; payload: AssetEventMap["asset:loaded"] }
  | { event: "asset:failed"; payload: AssetEventMap["asset:failed"] };

/* -------------------------------------------------------------------------- */
/* Byte-built fixtures                                                        */
/* -------------------------------------------------------------------------- */

/** One PNG chunk: big-endian length, ASCII type, data, and a zeroed CRC. */
function chunk(type: string, data: Uint8Array | readonly number[]): Uint8Array {
  const body = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

/** A minimal 8-bit RGBA PNG of the given size, every pixel the same color. */
function pngBytes(
  width: number,
  height: number,
  rgba: readonly number[],
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0); // filter: none
    for (let x = 0; x < width; x += 1) rows.push(...rgba);
  }
  const idat = new Uint8Array(deflateSync(Uint8Array.from(rows)));
  const signature = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", [])];
  const total = chunks.reduce((sum, c) => sum + c.length, signature.length);
  const out = new Uint8Array(total);
  out.set(signature, 0);
  let at = signature.length;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A playable mono 16-bit PCM WAV carrying the given integer samples. */
function wavBytes(samples: readonly number[], sampleRate = 8_000): Uint8Array {
  const dataLength = samples.length * 2;
  const out = new Uint8Array(44 + dataLength);
  const view = new DataView(out.buffer);
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < 4; i += 1) out[at + i] = text.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // integer PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, dataLength, true);
  samples.forEach((sample, i) => {
    view.setInt16(44 + i * 2, sample, true);
  });
  return out;
}

/** A version-2 glTF binary wrapping the given document, with an optional BIN chunk. */
function glbBytes(json: object, bin?: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.length % 4)) % 4;
  const jsonLength = text.length + jsonPad;
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;
  const binLength = bin ? bin.length + binPad : 0;
  const total = 12 + 8 + jsonLength + (bin ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(text, 20);
  // The spec pads a JSON chunk with spaces, which JSON.parse tolerates.
  for (let i = 0; i < jsonPad; i += 1) out[20 + text.length + i] = 0x20;
  if (bin) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true); // BIN\0
    out.set(bin, at + 8);
  }
  return out;
}

/** A one-mesh document: a named node at a translation, bounds from the accessor pair. */
const SHIP_GLTF = {
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "hull", mesh: 0, translation: [1, 0, 0] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min: [-1, -2, -3], max: [1, 2, 3] }],
  animations: [{ name: "spin" }, { name: "bob" }],
};

/* -------------------------------------------------------------------------- */
/* The scripted transport                                                     */
/* -------------------------------------------------------------------------- */

/** A response the server refused — reached, but not an asset. */
function missing(status = 404): Response {
  return {
    ok: false,
    status,
    blob: () => Promise.resolve(new Blob([])),
  } as unknown as Response;
}

/**
 * A loader over a URL → body route table, plus the fetcher spy and the list
 * every announcement lands in. The recorder is the test's, not the loader's:
 * the loader keeps nothing, so a test that wants a history has to keep one —
 * which is exactly the position a driver is in.
 */
function loaderOver(
  routes: Record<string, Uint8Array | string>,
  options: Omit<AssetLoaderOptions, "fetch" | "emit"> = {},
) {
  const fetcher = vi.fn((url: string): Promise<Response> => {
    const body = routes[url];
    if (body === undefined) return Promise.resolve(missing());
    const blob = new Blob([
      typeof body === "string" ? body : (body as BlobPart),
    ]);
    return Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(blob),
    } as unknown as Response);
  });
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

  it("refuses an empty path", () => {
    expect(() => new AssetLoader().resolve("")).toThrow(Error);
    expect(() => new AssetLoader().resolve("")).toThrow(/empty/);
  });

  it("refuses a leading slash, which leaves the root", () => {
    expect(() => new AssetLoader().resolve("/models/ship.glb")).toThrow(
      /escapes the asset root/,
    );
  });

  it("refuses a .. segment, which leaves the root", () => {
    expect(() => new AssetLoader().resolve("../secrets.txt")).toThrow(
      /\.\." segment/,
    );
    // A dot-dot inside a *name* is not a segment and passes.
    expect(new AssetLoader().resolve("models/ship..glb")).toBe(
      "assets/models/ship..glb",
    );
  });

  it("refuses an absolute URL, which is not an asset path", () => {
    expect(() =>
      new AssetLoader().resolve("https://example.com/ship.glb"),
    ).toThrow(/absolute URL/);
  });

  it("is pure: it neither fetches nor announces", () => {
    const { loader, fetcher, announced } = loaderOver({});
    loader.resolve("models/ship.glb");
    expect(() => loader.resolve("/no")).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(announced).toEqual([]);
  });
});

describe("AssetLoader.load", () => {
  it("resolves to the response body and announces the load with the resolved url", async () => {
    const { loader, announced } = loaderOver({
      "assets/levels/01.json": "[1,2,3]",
    });

    const body = await loader.load("levels/01.json");

    expect(await body.text()).toBe("[1,2,3]");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "levels/01.json", url: "assets/levels/01.json" },
      },
    ]);
  });

  it("announces a refused path with an empty url and rejects with the resolve error, without fetching", async () => {
    const { loader, fetcher, announced } = loaderOver({});

    await expect(loader.load("../out.txt")).rejects.toThrow(
      /escapes the asset root/,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(announced).toHaveLength(1);
    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]?.payload).toMatchObject({
      path: "../out.txt",
      url: "",
    });
  });

  it("rejects a non-2xx response naming the status, and announces the failure at the resolved url", async () => {
    const { loader, announced } = loaderOver({});

    await expect(loader.load("levels/none.json")).rejects.toThrow(/HTTP 404/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "levels/none.json",
          url: "assets/levels/none.json",
          reason: expect.stringMatching(/HTTP 404/) as unknown as string,
        },
      },
    ]);
  });

  it("rejects with the fetch error itself when the transport fails", async () => {
    const boom = new Error("network down");
    const announced: Announced[] = [];
    const loader = new AssetLoader({
      fetch: () => Promise.reject(boom),
      emit: (event, payload) => {
        announced.push({ event, payload } as Announced);
      },
    });

    await expect(loader.load("levels/01.json")).rejects.toBe(boom);

    expect(announced[0]?.payload).toMatchObject({ reason: "network down" });
  });

  it("fetches on every call: nothing is cached", async () => {
    const { loader, fetcher } = loaderOver({ "assets/levels/01.json": "{}" });

    await loader.load("levels/01.json");
    await loader.load("levels/01.json");

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("AssetLoader.loadTexture", () => {
  it("decodes a PNG to a handle carrying the path and the decoded size", async () => {
    const { loader, announced } = loaderOver({
      "assets/textures/hull.png": pngBytes(3, 2, [255, 0, 0, 255]),
    });

    const texture = await loader.loadTexture("textures/hull.png");

    expect(texture).toEqual({ path: "textures/hull.png", width: 3, height: 2 });
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "textures/hull.png", url: "assets/textures/hull.png" },
      },
    ]);
  });

  it("rides the decoded pixels and the file's own bytes beside the handle", async () => {
    const bytes = pngBytes(1, 1, [10, 20, 30, 40]);
    const { loader } = loaderOver({ "assets/t.png": bytes });

    const texture = await loader.loadTexture("t.png");
    const source = textureSource(texture);

    expect(source?.width).toBe(1);
    expect(source?.height).toBe(1);
    expect(Array.from(source?.pixels ?? [])).toEqual([10, 20, 30, 40]);
    expect(Array.from(source?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  it("rejects a body that is not a PNG with the decode error, and announces it", async () => {
    const { loader, announced } = loaderOver({ "assets/t.png": "not a png" });

    await expect(loader.loadTexture("t.png")).rejects.toThrow(/PNG signature/);

    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]?.payload).toMatchObject({
      url: "assets/t.png",
      reason: expect.stringMatching(/PNG signature/) as unknown as string,
    });
  });

  it("answers undefined from the side table for a value this engine never loaded", () => {
    expect(textureSource({ path: "x", width: 1, height: 1 })).toBeUndefined();
  });

  it("lets an engine-made texture register its own pixels, with no file behind them", () => {
    const handle: TextureHandle = { path: "text:GO", width: 16, height: 16 };
    registerTexture(handle, {
      bytes: null,
      pixels: new Uint8Array(16 * 16 * 4),
      width: 16,
      height: 16,
    });

    expect(textureSource(handle)?.bytes).toBeNull();
    expect(textureSource(handle)?.pixels).toHaveLength(1024);
  });
});

describe("AssetLoader.loadMesh", () => {
  it("decodes a glTF binary to a handle with bounds, nodes, and clips in file order", async () => {
    const { loader, announced } = loaderOver({
      "assets/models/ship.glb": glbBytes(SHIP_GLTF),
    });

    const mesh = await loader.loadMesh("models/ship.glb");

    // The accessor's box is ±(1,2,3); the instancing node sits at x+1.
    expect(mesh.path).toBe("models/ship.glb");
    expect(mesh.bounds).toEqual({
      min: { x: 0, y: -2, z: -3 },
      max: { x: 2, y: 2, z: 3 },
    });
    expect(mesh.nodes).toEqual(["hull"]);
    expect(mesh.clips).toEqual(["spin", "bob"]);
    expect(announced[0]?.event).toBe("asset:loaded");
  });

  it("rides the file's bytes and the parsed document beside the handle", async () => {
    const bin = Uint8Array.from([1, 2, 3, 4]);
    const bytes = glbBytes(SHIP_GLTF, bin);
    const { loader } = loaderOver({ "assets/models/ship.glb": bytes });

    const mesh = await loader.loadMesh("models/ship.glb");
    const source = meshSource(mesh);

    expect(Array.from(source?.bytes ?? [])).toEqual(Array.from(bytes));
    expect(source?.json["scene"]).toBe(0);
    expect(Array.from(source?.bin ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("rejects a body that is not a glTF binary with the decode error, and announces it", async () => {
    const { loader, announced } = loaderOver({
      "assets/models/ship.glb": "not a glb",
    });

    await expect(loader.loadMesh("models/ship.glb")).rejects.toThrow(
      /not a glTF binary/,
    );

    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]?.payload).toMatchObject({
      reason: expect.stringMatching(/not a glTF binary/) as unknown as string,
    });
  });

  it("refuses a glTF container of any version but 2, by name", async () => {
    const bytes = glbBytes(SHIP_GLTF);
    new DataView(bytes.buffer).setUint32(4, 1, true);
    const { loader } = loaderOver({ "assets/models/old.glb": bytes });

    await expect(loader.loadMesh("models/old.glb")).rejects.toThrow(
      /version 1/,
    );
  });

  it("bounds a file with no geometry to a point at the origin", async () => {
    const { loader } = loaderOver({
      "assets/models/empty.glb": glbBytes({ nodes: [{ name: "root" }] }),
    });

    const mesh = await loader.loadMesh("models/empty.glb");

    expect(mesh.bounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    });
    expect(mesh.nodes).toEqual(["root"]);
    expect(mesh.clips).toEqual([]);
  });
});

describe("AssetLoader.loadAudio", () => {
  it("decodes a PCM WAV with no audio context, to a buffer carrying the documented facts", async () => {
    const { loader, announced } = loaderOver({
      "assets/audio/impact.wav": wavBytes([0, 16_384, -32_768, 0], 8_000),
    });

    const buffer = await loader.loadAudio("audio/impact.wav");

    // Node has no AudioBuffer, so the shaped value is what resolves — with
    // the channel data, sample rate, and duration a validator reads.
    expect("AudioBuffer" in globalThis).toBe(false);
    expect(buffer.sampleRate).toBe(8_000);
    expect(buffer.length).toBe(4);
    expect(buffer.duration).toBeCloseTo(4 / 8_000, 9);
    expect(buffer.numberOfChannels).toBe(1);
    expect(Array.from(buffer.getChannelData(0))).toEqual([0, 0.5, -1, 0]);
    expect(announced[0]?.event).toBe("asset:loaded");
  });

  it("rejects a body that is not a WAV with the decode error, and announces it", async () => {
    const { loader, announced } = loaderOver({
      "assets/audio/impact.wav": "nope",
    });

    await expect(loader.loadAudio("audio/impact.wav")).rejects.toThrow(
      /RIFF\/WAVE/,
    );

    expect(announced[0]?.event).toBe("asset:failed");
  });
});

describe("AssetLoader.loadMaterial", () => {
  const DOCUMENT = JSON.stringify({
    maps: [
      { name: "base-color", path: "base.png" },
      { name: "roughness", path: "rough.png", colorSpace: "linear" },
    ],
    tiling: 2,
    size: 512,
  });

  it("loads the document and every map it names, relative to the document's own directory", async () => {
    const { loader, announced, fetcher } = loaderOver({
      "assets/materials/hull/material.json": DOCUMENT,
      "assets/materials/hull/base.png": pngBytes(2, 2, [200, 0, 0, 255]),
      "assets/materials/hull/rough.png": pngBytes(1, 1, [128, 128, 128, 255]),
    });

    const material = await loader.loadMaterial("materials/hull/material.json");

    expect(material.path).toBe("materials/hull/material.json");
    expect(material.maps.baseColor).toEqual({
      path: "materials/hull/base.png",
      width: 2,
      height: 2,
    });
    expect(material.maps.roughness).toEqual({
      path: "materials/hull/rough.png",
      width: 1,
      height: 1,
    });
    // One call, one event: the map fetches announce nothing of their own.
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: {
          path: "materials/hull/material.json",
          url: "assets/materials/hull/material.json",
        },
      },
    ]);
  });

  it("rides the document's advisory metadata beside the handle", async () => {
    const { loader } = loaderOver({
      "assets/materials/hull/material.json": DOCUMENT,
      "assets/materials/hull/base.png": pngBytes(1, 1, [1, 2, 3, 4]),
      "assets/materials/hull/rough.png": pngBytes(1, 1, [5, 6, 7, 8]),
    });

    const material = await loader.loadMaterial("materials/hull/material.json");
    const source = materialSource(material);

    expect(source?.tiling).toBe(2);
    expect(source?.size).toBe(512);
    expect(source?.colorSpace).toEqual({ roughness: "linear" });
  });

  it("rejects a document missing its required fields, as a decode error", async () => {
    const { loader, announced } = loaderOver({
      "assets/materials/bad/material.json": JSON.stringify({ name: "no maps" }),
    });

    await expect(
      loader.loadMaterial("materials/bad/material.json"),
    ).rejects.toThrow(/missing its required fields/);

    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]?.payload).toMatchObject({
      url: "assets/materials/bad/material.json",
    });
  });

  it("rejects a document naming an unknown map, listing the channels it knows", async () => {
    const { loader } = loaderOver({
      "assets/materials/bad/material.json": JSON.stringify({
        maps: [{ name: "glossiness", path: "g.png" }],
      }),
    });

    await expect(
      loader.loadMaterial("materials/bad/material.json"),
    ).rejects.toThrow(/unknown map "glossiness".*base-color/);
  });

  it("rejects a document naming the same channel twice", async () => {
    const { loader } = loaderOver({
      "assets/materials/bad/material.json": JSON.stringify({
        maps: [
          { name: "normal", path: "a.png" },
          { name: "normal", path: "b.png" },
        ],
      }),
    });

    await expect(
      loader.loadMaterial("materials/bad/material.json"),
    ).rejects.toThrow(/"normal" map twice/);
  });

  it("fails the whole load when a map fails, with the reason naming the map and the document's url on the event", async () => {
    const { loader, announced } = loaderOver({
      "assets/materials/hull/material.json": DOCUMENT,
      "assets/materials/hull/base.png": pngBytes(1, 1, [0, 0, 0, 255]),
      // rough.png is deliberately not served.
    });

    await expect(
      loader.loadMaterial("materials/hull/material.json"),
    ).rejects.toThrow(
      /material map "roughness" \("rough\.png"\) failed to load/,
    );

    expect(announced).toHaveLength(1);
    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]?.payload).toMatchObject({
      path: "materials/hull/material.json",
      url: "assets/materials/hull/material.json",
      reason: expect.stringMatching(
        /"roughness".*HTTP 404/,
      ) as unknown as string,
    });
  });

  it("fails the whole load when a map's body is not a PNG, naming the map over the decode error", async () => {
    const { loader } = loaderOver({
      "assets/materials/hull/material.json": DOCUMENT,
      "assets/materials/hull/base.png": "not a png",
      "assets/materials/hull/rough.png": pngBytes(1, 1, [0, 0, 0, 255]),
    });

    await expect(
      loader.loadMaterial("materials/hull/material.json"),
    ).rejects.toThrow(/material map "baseColor".*PNG signature/);
  });
});

describe("AssetLoader shape", () => {
  it("holds no record: every load is announced and then forgotten", async () => {
    const { loader } = loaderOver({ "assets/a.json": "{}" });

    for (let i = 0; i < 50; i += 1) await loader.load("a.json");

    // Counted without naming a field, so the claim survives a rename: no own
    // value of the loader is a collection with anything in it.
    const held = Object.values(
      loader as unknown as Record<string, unknown>,
    ).reduce<number>((total, value) => {
      if (Array.isArray(value)) return total + value.length;
      if (value instanceof Map || value instanceof Set)
        return total + value.size;
      return total;
    }, 0);
    expect(held).toBe(0);
  });

  it("announces every loader's refusal identically, because resolve is the shared first step", async () => {
    const { loader, announced } = loaderOver({});
    const calls = [
      loader.load("/x"),
      loader.loadTexture("/x"),
      loader.loadMesh("/x"),
      loader.loadMaterial("/x"),
      loader.loadAudio("/x"),
    ];

    for (const call of calls)
      await expect(call).rejects.toThrow(/escapes the asset root/);

    expect(announced).toHaveLength(5);
    for (const entry of announced) {
      expect(entry.event).toBe("asset:failed");
      expect(entry.payload).toMatchObject({ path: "/x", url: "" });
    }
  });

  it("works without an emitter, so a loader nobody subscribed to still loads", async () => {
    const loader = new AssetLoader({
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          blob: () => Promise.resolve(new Blob(["{}"])),
        } as unknown as Response),
    });

    await expect(loader.load("a.json")).resolves.toBeInstanceOf(Blob);
  });
});
