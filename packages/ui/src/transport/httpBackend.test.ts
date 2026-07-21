import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackendExec } from "./httpBackend";

const BACKEND = "https://backend.example";
const AUTH = "https://auth.example";
const ARTIFACTS = "https://artifacts.example";

// A stored run as the backend serves it, with the root-relative build link a
// pre-publish run carries (the artifact service, not the control-plane backend,
// serves the build itself).
function storedRunBody(runId: string) {
  return {
    record: {
      id: runId,
      links: { sourceRepo: null, playableBuild: `/runs/${runId}/build/` },
    },
    reviews: [],
    published: false,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBackendExec build-link resolution", () => {
  it("resolves a pre-publish build link against the artifact service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(storedRunBody("run-1"))),
    );

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    const run = await client.readRun("run-1");

    expect(run.record.links.playableBuild).toBe(
      `${ARTIFACTS}/runs/run-1/build/`,
    );
  });

  // The regression: the artifact base URL is itself fetched (`GET /config`), and
  // the resolved link is snapshotted into the record the run-detail chrome fetches
  // exactly once per run id. Reading whatever URL was known at construction time
  // meant a cold deep-link to /runs/:id/play — where the record fetch beats the
  // config fetch — stored an unresolved `/runs/{id}/build/`, which the console's
  // own origin then served as the SPA shell instead of the build. Nothing
  // re-fetches the record, so the broken link stuck until the tab was remounted
  // (which is why switching to Verdict and back appeared to fix it).
  it("awaits a not-yet-resolved artifacts URL rather than leaving the link unresolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(storedRunBody("run-2"))),
    );

    let settle: (url: string | null) => void = () => {};
    const settled = new Promise<string | null>((resolve) => {
      settle = resolve;
    });

    // `current: null` is exactly the cold-deep-link state: the config fetch is
    // still in flight when the record is read.
    const client = createBackendExec(BACKEND, AUTH, { current: null, settled });
    const pending = client.readRun("run-2");
    settle(ARTIFACTS);

    const run = await pending;
    expect(run.record.links.playableBuild).toBe(
      `${ARTIFACTS}/runs/run-2/build/`,
    );
  });

  it("leaves the link unresolved when no artifact service is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(storedRunBody("run-3"))),
    );

    const client = createBackendExec(BACKEND, AUTH, {
      current: null,
      settled: Promise.resolve(null),
    });
    const run = await client.readRun("run-3");

    expect(run.record.links.playableBuild).toBe("/runs/run-3/build/");
  });

  it("leaves an already-absolute (published) build link as-is", async () => {
    const body = storedRunBody("run-4");
    body.record.links.playableBuild = "https://pages.example/run-4/";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    const run = await client.readRun("run-4");

    expect(run.record.links.playableBuild).toBe("https://pages.example/run-4/");
  });
});
