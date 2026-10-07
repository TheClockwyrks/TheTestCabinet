import { describe, expect, it, vi } from "vitest";
import { AssetLoader, type AssetLoaderOptions } from "./assets";
import type { EngineEventMap } from "./contract";

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
 * versions. Only the audio path reads bytes, so only it needs this.
 */
function bytes(): Blob {
  return {
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
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

describe("AssetLoader.resolve", () => {
  it("resolves a plain path under the default root", () => {
    expect(new AssetLoader().resolve("sprites/ball.png")).toBe(
      "assets/sprites/ball.png",
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
      "sprites/../../secret.png",
      "https://cdn.example.com/x.png",
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
    expect(loader.resolve("sprites/hero..idle.png")).toBe(
      "assets/sprites/hero..idle.png",
    );
    expect(loader.resolve("./ball.png")).toBe("assets/./ball.png");
  });

  it("announces nothing — resolving is URL arithmetic, not a load", () => {
    const { loader, announced, fetcher } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    loader.resolve("ball.png");
    expect(() => loader.resolve("../ball.png")).toThrow();

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

    const blob = await loader.load("sprites/ball.png");

    expect(blob).toBe(asset.body);
    expect(fetcher).toHaveBeenCalledWith("assets/sprites/ball.png");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "sprites/ball.png", url: "assets/sprites/ball.png" },
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

    await loader.load("a.png");

    expect(fetcher).toHaveBeenCalledWith("build/media/a.png");
  });

  it("announces exactly one event per call, in request order", async () => {
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await loader.load("a.png");
    await loader.load("b.png");

    expect(announced.map((a) => [a.event, a.payload.path])).toEqual([
      ["asset:loaded", "a.png"],
      ["asset:loaded", "b.png"],
    ]);
  });
});

describe("AssetLoader.loadImage", () => {
  it("decodes the body to a bitmap and announces the arrival", async () => {
    const decoded = bitmap();
    const decoder = vi.fn(() => Promise.resolve(decoded));
    vi.stubGlobal("createImageBitmap", decoder);
    const asset = ok();
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(asset.response),
    );

    await expect(loader.loadImage("sprites/ball.png")).resolves.toBe(decoded);

    expect(decoder).toHaveBeenCalledWith(asset.body);
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "sprites/ball.png", url: "assets/sprites/ball.png" },
      },
    ]);
    vi.unstubAllGlobals();
  });

  it("fails by name on a host that cannot decode images", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(ok().response),
    );

    await expect(loader.loadImage("ball.png")).rejects.toThrow(
      /createImageBitmap/,
    );

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "ball.png",
          url: "assets/ball.png",
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

    await expect(loader.loadImage("ball.png")).rejects.toThrow(/not a PNG/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "ball.png",
          url: "assets/ball.png",
          reason: "not a PNG",
        },
      },
    ]);
    vi.unstubAllGlobals();
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
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(bitmap())),
    );
    for (const call of [
      (l: AssetLoader) => l.load("../../etc/passwd"),
      (l: AssetLoader) => l.loadImage("../../etc/passwd"),
      (l: AssetLoader) => l.loadAudio("../../etc/passwd"),
    ]) {
      const { loader, fetcher, announced } = loaderWith(
        () => Promise.resolve(ok().response),
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

  it("both announces and throws, so the game learns its texture never arrived", async () => {
    const { loader, announced } = loaderWith(() => Promise.resolve(missing()));

    const rejection = await loader.load("ball.png").then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(announced).toHaveLength(1);
    expect(announced[0]?.payload.path).toBe("ball.png");
  });

  it("names the status of a response the server refused", async () => {
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(missing(503)),
    );

    await expect(loader.load("ball.png")).rejects.toThrow(/503/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "ball.png",
          url: "assets/ball.png",
          reason: expect.stringContaining("503"),
        },
      },
    ]);
  });

  it("rejects a network failure with the original error, announcing it once", async () => {
    const failure = new TypeError("Failed to fetch");
    const { loader, announced } = loaderWith(() => Promise.reject(failure));

    await expect(loader.load("ball.png")).rejects.toBe(failure);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "ball.png",
          url: "assets/ball.png",
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

    await expect(loader.load("ball.png")).rejects.toThrow(/stream closed/);

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });

  it("survives a thrown value that is not an Error", async () => {
    const { loader, announced } = loaderWith(() => Promise.reject("offline"));

    await expect(loader.load("ball.png")).rejects.toBe("offline");

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
      await loader.load(`sprite-${i}.png`).catch(() => undefined);
    }

    expect(announced).toHaveLength(200);
    expect(retained(loader)).toBe(0);
  });

  it("holds nothing after repeated loads of the same path either", async () => {
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    for (let i = 0; i < 200; i += 1) {
      await loader.load("ball.png");
    }

    expect(retained(loader)).toBe(0);
  });
});
