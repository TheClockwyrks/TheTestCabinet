import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createAssetCache,
  createResolverAssetCaches,
  useCachedAsset,
  type AssetCache,
} from "./assetCache";

/**
 * The cache every immutable produced asset is read through.
 *
 * What is checked here is the four properties the app leans on, because each of
 * them is a user-visible outcome rather than an implementation detail: a URL is
 * fetched once, concurrent mounts share one request, a failure is not remembered,
 * and — the property the whole thing exists for — what is already resolved can be
 * read back SYNCHRONOUSLY, so a component can render it without a loading state.
 * The bound is checked too: the cache is never invalidated, so a bound that did not
 * hold would make a console left open all day a leak with a lookup on it.
 */

/** A loader that counts its calls and resolves to `value(key)`. */
function counting(value: (key: string) => string = (key) => `body:${key}`) {
  const calls: string[] = [];
  return {
    calls,
    load: (key: string) => {
      calls.push(key);
      return Promise.resolve(value(key));
    },
  };
}

/** A loader whose promises the test settles by hand. */
function deferred<T>() {
  const settlers: {
    resolve: (value: T) => void;
    reject: (cause: unknown) => void;
  }[] = [];
  const calls: string[] = [];
  return {
    calls,
    settlers,
    load: (key: string) => {
      calls.push(key);
      return new Promise<T>((resolve, reject) => {
        settlers.push({ resolve, reject });
      });
    },
  };
}

describe("resolving through the cache", () => {
  it("fetches a URL once and serves every later ask from memory", async () => {
    const loader = counting();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: loader.load,
    });

    expect(await cache.load("a")).toBe("body:a");
    expect(await cache.load("a")).toBe("body:a");
    expect(await cache.load("a")).toBe("body:a");
    expect(loader.calls).toEqual(["a"]);
  });

  it("shares one in-flight request between callers that arrive together", async () => {
    // Two surfaces mounting for the same asset in the same tick is the ordinary
    // case — a validation pair, a proof shown beside a reference — and the second
    // must join the first fetch rather than start a second.
    const loader = deferred<string>();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: loader.load,
    });

    const first = cache.load("a");
    const second = cache.load("a");
    expect(loader.calls).toEqual(["a"]);

    loader.settlers[0]!.resolve("shared");
    expect(await first).toBe("shared");
    expect(await second).toBe("shared");
  });

  it("reads a resolved value back synchronously, which is what removes the spinner", async () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: counting().load,
    });

    // Nothing yet: a component seeded from this renders its loading state.
    expect(cache.peek("a")).toBeUndefined();
    await cache.load("a");
    // Held: a component seeded from this renders the asset on its first frame.
    expect(cache.peek("a")).toBe("body:a");
  });

  it("reports an in-flight fetch as nothing held, not as a value", async () => {
    const loader = deferred<string>();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: loader.load,
    });

    const pending = cache.load("a");
    expect(cache.peek("a")).toBeUndefined();
    loader.settlers[0]!.resolve("landed");
    await pending;
    expect(cache.peek("a")).toBe("landed");
  });

  it("keeps a legitimately null value, telling it from nothing held", async () => {
    // The catalog resolvers answer `null` for "this host has no such case", which
    // is an answer worth caching — it is `undefined` that means "not asked yet".
    const cache = createAssetCache<string | null>({
      name: "test asset",
      maxEntries: 8,
      load: () => Promise.resolve(null),
    });

    await cache.load("a");
    expect(cache.peek("a")).toBeNull();
    expect(cache.peek("b")).toBeUndefined();
  });
});

describe("a fetch that fails", () => {
  it("is not remembered, so the next mount retries", async () => {
    let attempt = 0;
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error("HTTP 503"))
          : Promise.resolve("second time");
      },
    });

    await expect(cache.load("a")).rejects.toThrow("HTTP 503");
    expect(cache.peek("a")).toBeUndefined();
    expect(await cache.load("a")).toBe("second time");
    expect(attempt).toBe(2);
  });

  it("rejects every caller that was sharing it", async () => {
    const loader = deferred<string>();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: loader.load,
    });

    const first = cache.load("a");
    const second = cache.load("a");
    loader.settlers[0]!.reject(new Error("HTTP 500"));

    await expect(first).rejects.toThrow("HTTP 500");
    await expect(second).rejects.toThrow("HTTP 500");
    expect(cache.peek("a")).toBeUndefined();
  });

  it("names the cache when a key has no loader at all", async () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
    });
    await expect(cache.load("a")).rejects.toThrow(/test asset/);
  });
});

describe("the bound", () => {
  it("evicts the least recently used entry past the count", async () => {
    const loader = counting();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 2,
      load: loader.load,
    });

    await cache.load("a");
    await cache.load("b");
    await cache.load("c");

    expect(cache.size).toBe(2);
    expect(cache.peek("a")).toBeUndefined();
    expect(cache.peek("b")).toBe("body:b");
    expect(cache.peek("c")).toBe("body:c");
  });

  it("counts a use, so the asset a reviewer keeps returning to survives", async () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 2,
      load: counting().load,
    });

    await cache.load("a");
    await cache.load("b");
    // `a` is used again, so `b` is now the oldest and `c` evicts it rather than `a`.
    await cache.load("a");
    await cache.load("c");

    expect(cache.peek("a")).toBe("body:a");
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("c")).toBe("body:c");
  });

  it("evicts by weight where a byte budget is declared", async () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 100,
      maxBytes: 10,
      weigh: (value) => value.length,
      load: (key) => Promise.resolve(key),
    });

    await cache.load("aaaaaa"); // 6 bytes
    await cache.load("bbbb"); // 6 + 4 = 10, at the budget
    expect(cache.bytes).toBe(10);
    expect(cache.size).toBe(2);

    await cache.load("cccc"); // 14 over the budget: the oldest goes
    expect(cache.peek("aaaaaa")).toBeUndefined();
    expect(cache.peek("bbbb")).toBe("bbbb");
    expect(cache.peek("cccc")).toBe("cccc");
    expect(cache.bytes).toBe(8);
  });

  it("still serves an asset larger than the whole budget to the view that asked", async () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 100,
      maxBytes: 4,
      weigh: (value) => value.length,
      load: (key) => Promise.resolve(key),
    });

    await cache.load("an asset far over the budget");
    expect(cache.peek("an asset far over the budget")).toBe(
      "an asset far over the budget",
    );
    expect(cache.size).toBe(1);
  });

  it("never evicts a fetch a caller is still waiting on", async () => {
    const loader = deferred<string>();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 1,
      load: loader.load,
    });

    const slow = cache.load("slow");
    const alsoSlow = cache.load("also slow");
    // Both are in flight and the count is over its bound; dropping either would buy
    // a duplicate request and nothing else.
    expect(cache.size).toBe(2);

    loader.settlers[0]!.resolve("first");
    loader.settlers[1]!.resolve("second");
    expect(await slow).toBe("first");
    expect(await alsoSlow).toBe("second");
    // Once both have landed the bound applies again.
    expect(cache.size).toBe(1);
    expect(cache.peek("also slow")).toBe("second");
  });
});

describe("recording a value the cache did not fetch", () => {
  it("holds it, and reading it back needs no fetch", async () => {
    const loader = counting();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: loader.load,
    });

    cache.put("a", "already painted");
    expect(cache.peek("a")).toBe("already painted");
    expect(await cache.load("a")).toBe("already painted");
    expect(loader.calls).toEqual([]);
  });

  it("replaces what was held and re-weighs it", () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      maxBytes: 100,
      weigh: (value) => value.length,
    });

    cache.put("a", "aaaa");
    expect(cache.bytes).toBe(4);
    cache.put("a", "aa");
    expect(cache.bytes).toBe(2);
    expect(cache.size).toBe(1);
  });
});

describe("a cache per resolver", () => {
  /** A distinct resolver per host, as each console builds one of its own. */
  function host(prefix: string) {
    return (key: string) => Promise.resolve(`${prefix}:${key}`);
  }

  it("keeps one host's answers out of another's", async () => {
    const caches = createResolverAssetCaches<
      (key: string) => Promise<string>,
      string
    >({
      name: "catalog read",
      maxEntries: 8,
      load: (resolver, key) => resolver(key),
    });

    const staging = host("staging");
    const production = host("production");

    expect(await caches.for(staging).load("carom")).toBe("staging:carom");
    // Pointing the console at another backend must not serve this one's answer.
    expect(caches.for(production).peek("carom")).toBeUndefined();
    expect(await caches.for(production).load("carom")).toBe("production:carom");
  });

  it("hands the same resolver the same cache", async () => {
    const caches = createResolverAssetCaches<
      (key: string) => Promise<string>,
      string
    >({
      name: "catalog read",
      maxEntries: 8,
      load: (resolver, key) => resolver(key),
    });
    const resolver = host("one");
    const first: AssetCache<string> = caches.for(resolver);
    await first.load("carom");
    expect(caches.for(resolver).peek("carom")).toBe("one:carom");
  });

  it("takes a loader per call where the key is a composite", async () => {
    // The variant caches key on `slug@version/variant/engine`, which the resolver
    // cannot be handed as a single string — so the hook supplies the loader.
    const caches = createResolverAssetCaches<
      (ref: { slug: string }) => Promise<string>,
      string
    >({ name: "case variant", maxEntries: 8 });
    const resolver = vi.fn((ref: { slug: string }) =>
      Promise.resolve(`resolved:${ref.slug}`),
    );

    const cache = caches.for(resolver);
    const key = "carom@v3/default/none";
    expect(await cache.load(key, () => resolver({ slug: "carom" }))).toBe(
      "resolved:carom",
    );
    // The second ask is the cache, whatever loader it is offered.
    expect(await cache.load(key, () => resolver({ slug: "carom" }))).toBe(
      "resolved:carom",
    );
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});

/**
 * The hook a component reads an asset through.
 *
 * The whole point of the test below is the frame count: a component that finds its
 * asset in the cache must render it on its FIRST frame, never a frame of spinner
 * first. Every tab of a run's detail page is its own route, so a reviewer clicking
 * away and back remounts the body — and a spinner over an asset the session already
 * holds is exactly what a reviewer on a slow link reported.
 */
describe("reading an asset through the hook", () => {
  /** What `useCachedAsset` reported, in render order, for `url`. */
  function probe(cache: AssetCache<string>) {
    const frames: string[] = [];
    function Probe({ url }: { url: string | null }) {
      const { data, loading, error } = useCachedAsset(cache, url);
      const shown = loading ? "loading" : (error ?? data ?? "nothing");
      frames.push(shown);
      return <p data-testid="asset">{shown}</p>;
    }
    return { frames, Probe };
  }

  it("shows a loading state on a cold mount and the asset once it lands", async () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: (key) => Promise.resolve(`body:${key}`),
    });
    const { frames, Probe } = probe(cache);

    render(<Probe url="https://example.test/a" />);
    expect(frames[0]).toBe("loading");
    await screen.findByText("body:https://example.test/a");
  });

  it("renders a cached asset on the first frame, with no loading state", async () => {
    const loads: string[] = [];
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: (key) => {
        loads.push(key);
        return Promise.resolve(`body:${key}`);
      },
    });
    const url = "https://example.test/a";

    // The first visit: a spinner, then the asset.
    const first = probe(cache);
    const mounted = render(<first.Probe url={url} />);
    await screen.findByText(`body:${url}`);
    expect(first.frames[0]).toBe("loading");
    mounted.unmount();

    // Clicking away and back. THIS is the reported bug: the remount must not show a
    // loading state at all, and must not fetch again.
    const again = probe(cache);
    render(<again.Probe url={url} />);
    expect(again.frames[0]).toBe(`body:${url}`);
    expect(again.frames).not.toContain("loading");
    expect(screen.getByTestId("asset")).toHaveTextContent(`body:${url}`);
    // Let the effect's own `load` settle, and check it changed nothing.
    await act(async () => {
      await Promise.resolve();
    });
    expect(again.frames).not.toContain("loading");
    expect(loads).toEqual([url]);
  });

  it("renders a cached asset on the first frame when the key changes too", async () => {
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: (key) => Promise.resolve(`body:${key}`),
    });
    await cache.load("https://example.test/b");

    const { frames, Probe } = probe(cache);
    const view = render(<Probe url="https://example.test/a" />);
    await screen.findByText("body:https://example.test/a");
    const before = frames.length;

    // Moving to an asset already held — the pane beside this one, a clip already
    // watched — must swap the picture rather than blank to a spinner and back.
    view.rerender(<Probe url="https://example.test/b" />);
    expect(frames.slice(before)).not.toContain("loading");
    expect(screen.getByTestId("asset")).toHaveTextContent(
      "body:https://example.test/b",
    );
  });

  it("settles immediately with nothing when there is no key", () => {
    const load = vi.fn();
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load,
    });
    const { frames, Probe } = probe(cache);

    render(<Probe url={null} />);
    expect(frames).toEqual(["nothing"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("reports a failure as a failure, and retries on the next mount", async () => {
    let attempt = 0;
    const cache = createAssetCache<string>({
      name: "test asset",
      maxEntries: 8,
      load: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error("asset fetch failed: HTTP 503"))
          : Promise.resolve("second time");
      },
    });

    const first = probe(cache);
    const mounted = render(<first.Probe url="https://example.test/a" />);
    await screen.findByText("asset fetch failed: HTTP 503");
    mounted.unmount();

    const again = probe(cache);
    render(<again.Probe url="https://example.test/a" />);
    await screen.findByText("second time");
    expect(attempt).toBe(2);
  });
});
