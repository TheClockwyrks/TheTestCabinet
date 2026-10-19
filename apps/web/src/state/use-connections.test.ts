import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBackendConnection, useExecConnection } from "./use-connections";

/**
 * The console's two connections, read the way the gallery reads them.
 *
 * The backend's answers are stubbed at `fetch`, so what is asserted is what
 * the console asks for and the state it arrives at: the status the settings
 * screen shows, and the one execution target the run launcher uses.
 */

/** An address the console once let an operator store, which it no longer reads. */
const BACKEND = "https://backend.test";

/** A request's address, resolved the way the browser resolves it. */
function resolve(input: RequestInfo | URL): URL {
  return new URL(
    input instanceof Request ? input.url : String(input),
    location.href,
  );
}

/** Every address a request was made to, resolved against the page's origin. */
function requested(fetch: ReturnType<typeof vi.fn>): URL[] {
  return fetch.mock.calls.map((call) => resolve(call[0] as RequestInfo | URL));
}

/**
 * Answers the backend's `/healthz` at `/api` of the page's own origin when
 * `up`, and refuses every request otherwise.
 */
function serve(up: boolean): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) =>
    up
      ? Promise.resolve(answer(resolve(input)))
      : Promise.reject(new TypeError("Failed to fetch")),
  );
}

/** What a backend at `/api` of the page's own origin answers at `url`. */
function answer(url: URL): Response {
  return url.origin === location.origin && url.pathname === "/api/healthz"
    ? Response.json({ id: "backend-id", version: "1.2.3", storeReady: true })
    : Response.json({}, { status: 404 });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the backend connection", () => {
  it("probes /api of the console's own origin and reports its identity", async () => {
    const fetch = serve(true);
    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useBackendConnection());

    expect(result.current.url).toBe("/api");
    expect(result.current.status).toBe("connecting");
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.identity).toEqual({
      id: "backend-id",
      url: "/api",
      version: "1.2.3",
      storeReady: true,
    });
    expect(result.current.error).toBeNull();
    for (const url of requested(fetch)) {
      expect(url.origin).toBe(location.origin);
      expect(url.pathname.startsWith("/api/")).toBe(true);
    }
  });

  it("names no other backend, whatever the browser has stored", async () => {
    // The console once read an operator's override from this key; nothing
    // reads it now, so a stale one points the console nowhere else.
    localStorage.setItem("tcab.web.backendUrl", JSON.stringify(BACKEND));
    const fetch = serve(true);
    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useBackendConnection());

    expect(result.current.url).toBe("/api");
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(requested(fetch).map((url) => url.origin)).not.toContain(BACKEND);
    expect(result.current).not.toHaveProperty("setUrl");
  });

  it("reports the error a backend that does not answer gives", async () => {
    vi.stubGlobal("fetch", serve(false));

    const { result } = renderHook(() => useBackendConnection());

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.identity).toBeNull();
    expect(result.current.error).toContain("Failed to fetch");
  });
});

describe("the execution connection", () => {
  it("offers no target without a backend", () => {
    vi.stubGlobal("fetch", serve(true));

    const { result } = renderHook(() => useExecConnection(null));

    expect(result.current.workers).toEqual([]);
    expect(result.current.active).toBeNull();
  });

  it("offers the backend itself as the one target", () => {
    const fetch = serve(true);
    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useExecConnection("/api"));

    expect(result.current.workers).toHaveLength(1);
    expect(result.current.activeId).toBe("backend");
    expect(result.current.active?.url).toBe("/api");
    expect(result.current.active?.backendMatch).toBe("match");
  });

  it("reads a run's media from the artifacts path of its own origin", () => {
    const fetch = serve(true);
    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useExecConnection("/api"));

    // Nothing is fetched to learn where the artifacts service is: it is a path
    // of the origin the console is served from.
    expect(result.current.active?.client.runArchiveUrl?.("run-1")).toBe(
      "/artifacts/runs/run-1/archive.tar.gz",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
