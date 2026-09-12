import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson } from "./http";
import { httpStatusOf, isAbsence } from "../client/absence";

const BASE = "https://backend.example";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP read failures", () => {
  it("reports the path and status alongside the backend's own reason", async () => {
    // This layer wraps a message the backend already wrote as a sentence, so it
    // adds only what it uniquely knows — which request failed, and with what
    // status — and leaves the claim of failure to the reason it carries.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "not_found", message: "run `abc` not found" } },
          { status: 404, statusText: "Not Found" },
        ),
      ),
    );

    await expect(getJson(BASE, "/runs/abc")).rejects.toThrow(
      "/runs/abc: HTTP 404: run `abc` not found",
    );
  });

  it("falls back to the status text when the body carries no envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>gateway</html>", {
            status: 502,
            statusText: "Bad Gateway",
          }),
      ),
    );

    await expect(getJson(BASE, "/runs")).rejects.toThrow(
      "/runs: HTTP 502: Bad Gateway",
    );
  });

  it("names the path even when the response carries no URL of its own", async () => {
    // The regression the explicit `path` argument exists for: a synthesized
    // `Response` — every test double, and some polyfills — leaves `res.url` empty,
    // so reading the URL off the response reported the request as "".
    const res = new Response("{}", { status: 500, statusText: "Oops" });
    expect(res.url).toBe("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );

    await expect(getJson(BASE, "/models")).rejects.toThrow(
      "/models: HTTP 500:",
    );
  });
});

// The status the caller above decides absence on. It rides on the error as a
// number, not inside the sentence, because the sentence is partly the backend's
// own words.
describe("HTTP read failures carry their status as data", () => {
  it("puts the status on the thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "not_found", message: "run `abc` not found" } },
          { status: 404, statusText: "Not Found" },
        ),
      ),
    );

    const cause = await getJson(BASE, "/runs/abc").catch(
      (e: unknown) => e as unknown,
    );
    expect(httpStatusOf(cause)).toBe(404);
    expect(isAbsence(cause)).toBe(true);
  });

  // The defect this seam closes. The backend's envelope message is free text and
  // is free to quote an upstream's own failure; deciding absence by reading the
  // message back out turned this broken store into "No run found".
  it("reports a 500 whose envelope message quotes “HTTP 404” as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "internal",
              message:
                "artifact fetch https://artifacts.example/runs/abc failed: HTTP 404",
            },
          },
          { status: 500, statusText: "Internal Server Error" },
        ),
      ),
    );

    const cause = await getJson(BASE, "/runs/abc").catch(
      (e: unknown) => e as unknown,
    );
    expect(String(cause)).toContain("HTTP 404");
    expect(httpStatusOf(cause)).toBe(500);
    expect(isAbsence(cause)).toBe(false);
  });

  // A request that never reached the backend carries no status at all, and the
  // callers above must read that as a failure rather than as an absence.
  it("leaves a network failure statusless", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const cause = await getJson(BASE, "/runs/abc").catch(
      (e: unknown) => e as unknown,
    );
    expect(httpStatusOf(cause)).toBeNull();
    expect(isAbsence(cause)).toBe(false);
  });
});
