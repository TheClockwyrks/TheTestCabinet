import { describe, expect, it, vi } from "vitest";
import { AssetLoader } from "./assets";

/**
 * A response that carries a body, as a successful `fetch` would. The blob is
 * created once and handed back by identity, so a test can prove the loader
 * returned *that* body rather than one it constructed itself (jsdom's `Blob` has
 * no readable text).
 */
function ok(body: Blob = new Blob(["pixels"])): { response: Response; body: Blob } {
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

/** A loader over a scripted fetcher, plus the spy so requested URLs can be read back. */
function loaderWith(response: () => Promise<Response>, root?: string) {
  const fetcher = vi.fn(response);
  return { loader: new AssetLoader(root, fetcher), fetcher };
}

describe("AssetLoader.resolve", () => {
  it("resolves a plain path under the default root", () => {
    expect(new AssetLoader().resolve("sprites/ball.png")).toBe("assets/sprites/ball.png");
  });

  it("takes a custom root, with or without its trailing slash", () => {
    expect(new AssetLoader("media").resolve("a.png")).toBe("media/a.png");
    expect(new AssetLoader("media/").resolve("a.png")).toBe("media/a.png");
  });

  it("refuses every way a path could name something outside the root", () => {
    const loader = new AssetLoader();
    for (const path of [
      "/etc/passwd",
      "//cdn.example.com/x.png",
      "../secret.png",
      "sprites/../../secret.png",
      "https://cdn.example.com/x.png",
      "data:image/png;base64,AAAA",
      "",
    ]) {
      expect(() => loader.resolve(path), path).toThrow();
    }
  });

  it("does not mistake dots inside a name for an escape", () => {
    const loader = new AssetLoader();
    expect(loader.resolve("sprites/hero..idle.png")).toBe("assets/sprites/hero..idle.png");
    expect(loader.resolve("./ball.png")).toBe("assets/./ball.png");
  });

  it("logs nothing on its own — the log records loads, not URL arithmetic", () => {
    const loader = new AssetLoader();
    loader.resolve("ball.png");
    expect(() => loader.resolve("../ball.png")).toThrow();
    expect(loader.log()).toEqual([]);
  });
});

describe("AssetLoader.load", () => {
  it("fetches the resolved URL, returns the body, and logs the request as ok", async () => {
    const asset = ok();
    const { loader, fetcher } = loaderWith(() => Promise.resolve(asset.response));

    const blob = await loader.load("sprites/ball.png");

    expect(blob).toBe(asset.body);
    expect(fetcher).toHaveBeenCalledWith("assets/sprites/ball.png");
    expect(loader.log()).toEqual([
      { path: "sprites/ball.png", url: "assets/sprites/ball.png", ok: true },
    ]);
  });

  it("logs one entry per load, in request order", async () => {
    const { loader } = loaderWith(() => Promise.resolve(ok().response));

    await loader.load("a.png");
    await loader.load("b.png");

    expect(loader.log().map((e) => e.path)).toEqual(["a.png", "b.png"]);
  });

  it("rejects an escaping path, logging the attempt with no URL", async () => {
    const { loader, fetcher } = loaderWith(() => Promise.resolve(ok().response));

    await expect(loader.load("../../etc/passwd")).rejects.toThrow(/escapes the asset root/);

    expect(fetcher).not.toHaveBeenCalled();
    expect(loader.log()).toEqual([{ path: "../../etc/passwd", url: "", ok: false }]);
  });

  it("rejects a missing asset and logs it against the URL it tried", async () => {
    const { loader } = loaderWith(() => Promise.resolve(missing()));

    await expect(loader.load("ball.png")).rejects.toThrow(/404/);

    expect(loader.log()).toEqual([{ path: "ball.png", url: "assets/ball.png", ok: false }]);
  });

  it("rejects a network failure with the original error, and logs it once", async () => {
    const failure = new TypeError("Failed to fetch");
    const { loader } = loaderWith(() => Promise.reject(failure));

    await expect(loader.load("ball.png")).rejects.toBe(failure);

    expect(loader.log()).toEqual([{ path: "ball.png", url: "assets/ball.png", ok: false }]);
  });

  it("is not ok until the body has actually been read", async () => {
    const truncated = {
      ok: true,
      status: 200,
      blob: () => Promise.reject(new Error("stream closed")),
    } as unknown as Response;
    const { loader } = loaderWith(() => Promise.resolve(truncated));

    await expect(loader.load("ball.png")).rejects.toThrow(/stream closed/);

    expect(loader.log()[0]?.ok).toBe(false);
  });

  it("hands out a copy of the log a caller cannot rewrite", async () => {
    const { loader } = loaderWith(() => Promise.resolve(ok().response));
    await loader.load("ball.png");

    const taken = loader.log();
    taken.push({ path: "forged.png", url: "assets/forged.png", ok: true });
    taken.length = 0;

    expect(loader.log()).toEqual([{ path: "ball.png", url: "assets/ball.png", ok: true }]);
  });
});
