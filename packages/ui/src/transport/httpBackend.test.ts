import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackendExec, createHttpBackend } from "./httpBackend";

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

describe("createBackendExec catalog listing", () => {
  // The listing is what a catalog page renders from, and it must be ONE request:
  // the fan-out this endpoint's metadata replaced (resolve every version of every
  // case, then every variant's specs) is the whole reason the fields are here.
  it("reads the whole listing from a single request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        testCases: [
          {
            slug: "carom",
            versions: ["v1.0.0", "v1.0.1"],
            name: "Carom",
            testType: "end-to-end",
            assetKind: "sprite",
            difficulty: "easy",
            tags: ["arcade"],
            summary: "A duel of angles.",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const cases = await createHttpBackend(BACKEND).listTestCases();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cases).toEqual([
      {
        slug: "carom",
        versions: ["v1.0.0", "v1.0.1"],
        name: "Carom",
        testType: "end-to-end",
        assetKind: "sprite",
        difficulty: "easy",
        tags: ["arcade"],
        summary: "A duel of angles.",
      },
    ]);
  });

  // A backend that predates the asset-shape field must not make the catalog's
  // asset tabs undefined-sensitive; it reads as "no asset shape" instead.
  it("reports a missing asset shape as null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          testCases: [
            {
              slug: "carom",
              versions: ["v1.0.0"],
              name: "Carom",
              testType: "end-to-end",
              difficulty: "easy",
              tags: [],
              summary: null,
            },
          ],
        }),
      ),
    );

    const cases = await createHttpBackend(BACKEND).listTestCases();

    expect(cases[0]!.assetKind).toBeNull();
  });
});
