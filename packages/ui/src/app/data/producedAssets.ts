// The shared caches for the produced and vendored files a player downloads before
// it can start: a wasm engine module, a sprite sheet, a scenario or replay document.
//
// These live together rather than beside each player because the two in-browser
// players (the adversarial foray player and the Lattice factory player) load the
// same shapes the same way, and because a cache is only a cache if there is one of
// it: two modules each holding their own copy of a run's engine module would hold
// the bytes twice and evict them independently.
//
// Every file reached here is immutable — a vendored asset is fixed by the bundle it
// was emitted into, and a run's own module and scenario cannot change once the run
// has produced them — so what is fetched once is kept and reused, per "Immutable
// asset caching" in the UI component doc. Relaunching a match the reviewer just
// watched, or stepping to the next scenario of the same run, re-reads the cache.

import { createAssetCache } from "./assetCache";

/**
 * Read a `data:` URL's own bytes.
 *
 * Vite inlines any asset under its `assetsInlineLimit` (4 KB by default) as a
 * base64 `data:` URL — a small sprite sheet is one, while a larger wasm module is
 * emitted as a file. WebKit's WKWebView (the macOS Tauri webview) cannot `fetch()`
 * a `data:` URL: it rejects with `TypeError: Load failed`. Decoding them here keeps
 * the inlining, which is a win for the browser hosts, while letting both players
 * work in the desktop shell too.
 */
function decodeDataUrl(url: string): {
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
} {
  const comma = url.indexOf(",");
  const meta = url.slice("data:".length, comma);
  const isBase64 = /;base64$/i.test(meta);
  const mime = meta.replace(/;base64$/i, "") || "application/octet-stream";
  const data = url.slice(comma + 1);
  const source = isBase64
    ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(data));
  // Copied into a fresh, plain-`ArrayBuffer`-backed view: `TextEncoder`/`atob`
  // results are typed as `ArrayBufferLike`, but the wasm and Blob consumers want a
  // concrete `ArrayBuffer`.
  return { mime, bytes: new Uint8Array(source) };
}

/**
 * The response at `url`, or throw naming what was being fetched.
 *
 * The status is checked before any body is read, for the reason every fetch in the
 * players checks it: an error page is bytes and valid JSON too, and handing one on
 * unchecked reports a file that was never served as a document the engine refused —
 * "failed to match magic number" for a module that does not exist — which sends the
 * reader looking at the wrong thing entirely.
 */
async function served(url: string, subject: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${subject} fetch failed: HTTP ${response.status} (${url})`,
    );
  }
  return response;
}

// Engine modules and other binary payloads, by URL.
//
// Bounded by bytes rather than by count because the entries are not alike: a
// vendored sprite sheet is a couple of kilobytes and a submission's compiled
// `engine.wasm` is megabytes. 64 MB holds every module a reviewer has in play while
// working through one run's scenarios — the module is the same for all of them —
// plus the handful of runs they flip between, and is a small fraction of what the
// decoded frames of a single playback already cost. The entry cap is the backstop
// for a page of small assets.
const binaryAssets = createAssetCache<ArrayBuffer>({
  name: "binary asset",
  maxEntries: 32,
  maxBytes: 64 * 1024 * 1024,
  weigh: (buffer) => buffer.byteLength,
});

// Sprite sheets and other blobs, by URL. Both players load one vendored sheet each
// and a sheet is kilobytes, so the count bound alone is the whole story here; the
// byte budget is a guard against a caller that one day hands this a produced file.
const blobAssets = createAssetCache<Blob>({
  name: "blob asset",
  maxEntries: 16,
  maxBytes: 32 * 1024 * 1024,
  weigh: (blob) => blob.size,
});

// Parsed documents a player steps: a match's `replay.json`, a scenario window.
//
// A parsed document has no portable size, so this is bounded by count. 24 covers
// every match of one adversarial run and every scored scenario of one Lattice run
// with room to flip between two runs, which is what a reviewer comparing
// submissions actually does.
const jsonAssets = createAssetCache<unknown>({
  name: "json asset",
  maxEntries: 24,
});

/**
 * The bytes at `url`, fetched once per session.
 *
 * Handles a `data:` URL itself (see {@link decodeDataUrl}), so a caller can hand it
 * a Vite `?url` import without caring which form the bundler chose. `subject` names
 * the file in the failure a reviewer reads — "engine module", "sprite sheet".
 */
export function fetchAssetBytes(
  url: string,
  subject: string,
): Promise<ArrayBuffer> {
  return binaryAssets.load(url, async (target) => {
    if (target.startsWith("data:")) return decodeDataUrl(target).bytes.buffer;
    return (await served(target, subject)).arrayBuffer();
  });
}

/** The blob at `url`, fetched once per session. Handles a `data:` URL itself. */
export function fetchAssetBlob(url: string, subject: string): Promise<Blob> {
  return blobAssets.load(url, async (target) => {
    if (target.startsWith("data:")) {
      const { mime, bytes } = decodeDataUrl(target);
      return new Blob([bytes], { type: mime });
    }
    return (await served(target, subject)).blob();
  });
}

/** The JSON document at `url`, fetched and parsed once per session. */
export function fetchAssetJson<T>(url: string, subject: string): Promise<T> {
  return jsonAssets.load(url, async (target) =>
    (await served(target, subject)).json(),
  ) as Promise<T>;
}

/** Drop every cached asset. For tests; nothing in the app invalidates one. */
export function clearProducedAssetCaches(): void {
  binaryAssets.clear();
  blobAssets.clear();
  jsonAssets.clear();
}
