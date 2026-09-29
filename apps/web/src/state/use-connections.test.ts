import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBackendConnection, useExecConnection } from "./use-connections";

/**
 * The console's two connections, read the way the gallery reads them.
 *
 * The backend's answers are stubbed at `fetch`, so what is asserted is what
 * the console asks for and the state it arrives at: the status the settings
 * screen shows, and the one execution target the run launcher uses.
 */

const BACKEND = "https://backend.test";
const OTHER = "https://other.test";

/** Answers `/healthz` and `/config` for each backend in `up`, refusing the rest. */
function serve(up: readonly string[]): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!up.includes(url.origin)) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    const body =
      url.pathname === "/healthz"
        ? { id: `${url.host}-id`, version: "1.2.3", storeReady: true }
        : { artifactsUrl: `${url.origin}/artifacts` };
    return Promise.resolve(Response.json(body));
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the backend connection", () => {
  it("is unconfigured and asks nothing while no URL is set", () => {
    const fetch = serve([BACKEND]);
    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useBackendConnection());

    expect(result.current.status).toBe("unconfigured");
    expect(result.current.client).toBeNull();
    expect(result.current.identity).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("probes the stored URL and reports the backend's identity", async () => {
    vi.stubGlobal("fetch", serve([BACKEND]));
    localStorage.setItem("tcab.web.backendUrl", JSON.stringify(BACKEND));

    const { result } = renderHook(() => useBackendConnection());

    expect(result.current.status).toBe("connecting");
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.identity).toEqual({
      id: "backend.test-id",
      url: BACKEND,
      version: "1.2.3",
      storeReady: true,
    });
    expect(result.current.error).toBeNull();
  });

  it("reports the error a backend that does not answer gives", async () => {
    vi.stubGlobal("fetch", serve([]));
    localStorage.setItem("tcab.web.backendUrl", JSON.stringify(BACKEND));

    const { result } = renderHook(() => useBackendConnection());

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.identity).toBeNull();
    expect(result.current.error).toContain("Failed to fetch");
  });

  it("reads as connecting again the moment the URL changes", async () => {
    vi.stubGlobal("fetch", serve([BACKEND, OTHER]));
    localStorage.setItem("tcab.web.backendUrl", JSON.stringify(BACKEND));
    const { result } = renderHook(() => useBackendConnection());
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    act(() => {
      result.current.setUrl(` ${OTHER} `);
    });

    // The answer in hand is the old backend's, which says nothing of this one.
    expect(result.current.url).toBe(OTHER);
    expect(result.current.status).toBe("connecting");
    expect(result.current.identity).toBeNull();
    await waitFor(() => {
      expect(result.current.identity?.id).toBe("other.test-id");
    });
    expect(localStorage.getItem("tcab.web.backendUrl")).toBe(
      JSON.stringify(OTHER),
    );
  });

  it("clears the URL when it is set to blank", () => {
    vi.stubGlobal("fetch", serve([BACKEND]));
    localStorage.setItem("tcab.web.backendUrl", JSON.stringify(BACKEND));
    const { result } = renderHook(() => useBackendConnection());

    act(() => {
      result.current.setUrl(" ".repeat(3));
    });

    expect(result.current.url).toBeNull();
    expect(result.current.status).toBe("unconfigured");
  });
});

describe("the execution connection", () => {
  it("offers no target without a backend", () => {
    vi.stubGlobal("fetch", serve([BACKEND]));

    const { result } = renderHook(() => useExecConnection(null));

    expect(result.current.workers).toEqual([]);
    expect(result.current.active).toBeNull();
  });

  it("offers the backend itself as the one target", async () => {
    const fetch = serve([BACKEND]);
    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useExecConnection(BACKEND));

    expect(result.current.workers).toHaveLength(1);
    expect(result.current.activeId).toBe("backend");
    expect(result.current.active?.url).toBe(BACKEND);
    expect(result.current.active?.backendMatch).toBe("match");
    // The artifact service's address is read from the backend's `/config`.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `${BACKEND}/config`,
        expect.anything(),
      );
    });
  });
});
