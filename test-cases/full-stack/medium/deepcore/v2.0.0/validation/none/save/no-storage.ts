// Deepcore — a browser with nowhere to save, for the checks that are about that.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// specs/expedition.md: "The save is held in the browser. The game runs correctly
// when that storage is unavailable, simply without saving." A browser refuses the
// storage in ordinary circumstances — a private window, third-party cookies
// blocked, a quota already spent — so this is a path real players walk.
//
// HOW THE STORAGE IS TAKEN AWAY. Every door the browser offers is shut before a
// line of the build's script runs, and shut the way a browser shuts them: reading
// `localStorage` or `sessionStorage` throws a `SecurityError`, which is what
// Chromium itself does when site data is blocked, and `indexedDB` is simply not
// there. The page is then reloaded so the build initializes against that, since
// what the two points that use this read is whether the build survives having no
// storage FROM THE START rather than losing it midway.

import { HANDLE, type Harness } from "../harness";

/** How long the surface is waited for after the page comes back. */
const RELOAD_TIMEOUT_MS = 20_000;

/**
 * Shut every browser store the save could be held in, then reload onto that.
 *
 * The init script runs before any of the page's own script, and survives the
 * reload, so the build initializes in a browser that has never had storage.
 */
export async function withoutStorage(h: Harness): Promise<void> {
  await h.page.addInitScript(() => {
    const deny = (name: string): void => {
      Object.defineProperty(window, name, {
        configurable: true,
        get(): never {
          throw new DOMException("storage is unavailable", "SecurityError");
        },
      });
    };
    deny("localStorage");
    deny("sessionStorage");
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get: () => undefined,
    });
  });
  await h.page.reload({ waitUntil: "load" });
  await h.page.waitForFunction(
    (handle) => (window as unknown as Record<string, unknown>)[handle] != null,
    HANDLE,
    { timeout: RELOAD_TIMEOUT_MS },
  );
}

/**
 * What the page threw or logged, with the noise a static site makes left out.
 *
 * A browser asks every page it opens for a favicon and a static build is free to
 * ship none, so a resource that 404s is the page's network log rather than the
 * build failing.
 */
export function thrownBy(h: Harness): string[] {
  return h.pageErrors.filter(
    (message) => !/failed to load resource/i.test(message),
  );
}
