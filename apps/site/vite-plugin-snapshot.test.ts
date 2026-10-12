import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSnapshotFetcher, type SnapshotFetch } from "./snapshot-fetch";
import { loadSnapshot, serialize } from "./vite-plugin-snapshot";

const BASE = "https://snapshot.example";
const RUNS = 12;
const CASES = ["alpha", "beta", "gamma"];

function runId(index: number): string {
  return `run-${String(index).padStart(2, "0")}`;
}

function caseOf(index: number): string {
  return CASES[index % CASES.length] as string;
}

/** A small published snapshot: every object by its key, as the bucket serves it. */
function snapshotObjects(): Map<string, unknown> {
  const objects = new Map<string, unknown>();
  objects.set("index.json", {
    schemaVersion: 1,
    snapshotId: "s1",
    generatedAt: "2026-10-12T00:00:00Z",
    runCount: RUNS,
    runsKey: "s1/runs.json",
    runDocumentsPrefix: "docs/",
    casesPrefix: "s1/cases/",
    modelsKey: "s1/models.json",
  });
  objects.set("s1/runs.json", {
    schemaVersion: 1,
    runs: Array.from({ length: RUNS }, (_unused, index) => ({
      id: runId(index),
      documentKey: `docs/${runId(index)}.json`,
      subject: { testCaseSlug: caseOf(index), testCaseVersion: "1.0.0" },
    })),
  });
  for (let index = 0; index < RUNS; index += 1) {
    objects.set(`docs/${runId(index)}.json`, {
      schemaVersion: 1,
      record: { id: runId(index), payload: index },
      reviews: [],
      proofMedia: [
        { id: "p", kind: "image", key: `media/${runId(index)}/proof.png` },
      ],
      // Every third run has no event log, so the two emitters interleave unevenly.
      ...(index % 3 === 0 ? {} : { events: [{ seq: index }] }),
    });
  }
  for (const slug of CASES) {
    objects.set(`s1/cases/${slug}/1.0.0.json`, {
      schemaVersion: 1,
      slug,
      version: "1.0.0",
      name: slug,
      difficulty: "easy",
      tags: [],
      summary: null,
      description: null,
      variants: [],
    });
  }
  objects.set("s1/models.json", { schemaVersion: 1, models: [{ id: "m1" }] });
  return objects;
}

interface Bucket {
  fetch: SnapshotFetch;
  requests: string[];
  peak: () => number;
}

/**
 * A bucket over `objects`. `delay` is how long a key's response takes, and
 * `failures` how many times a key answers with `failWith` before it is served.
 */
function bucket(
  objects: Map<string, unknown>,
  options: {
    delay?: (key: string) => number;
    failures?: Map<string, number>;
    failWith?: () => Promise<Response>;
  } = {},
): Bucket {
  const requests: string[] = [];
  const remaining = new Map(options.failures);
  let inFlight = 0;
  let peak = 0;
  return {
    requests,
    peak: () => peak,
    fetch: async (url) => {
      const key = url.slice(BASE.length + 1);
      requests.push(key);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, options.delay?.(key) ?? 1);
        });
        const left = remaining.get(key) ?? 0;
        if (left > 0) {
          remaining.set(key, left - 1);
          return await (
            options.failWith ??
            (() => Promise.reject(new TypeError("terminated")))
          )();
        }
        if (!objects.has(key)) {
          return new Response("", { status: 404, statusText: "Not Found" });
        }
        return new Response(JSON.stringify(objects.get(key)), { status: 200 });
      } finally {
        inFlight -= 1;
      }
    },
  };
}

interface Loaded {
  module: string | null;
  emitted: string[];
  fetched: number;
  retried: number;
}

/** One whole load, driven to its end on the fake clock. */
async function load(source: Bucket, concurrency: number): Promise<Loaded> {
  const emitted: string[] = [];
  const fetcher = createSnapshotFetcher({ fetch: source.fetch });
  const pending = loadSnapshot(
    BASE,
    (id, json) => emitted.push(`events ${id} ${json}`),
    (id, json) => emitted.push(`record ${id} ${json}`),
    fetcher,
    concurrency,
  ).then(
    (data) => ({ data }),
    (error: unknown) => ({ error: error as Error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await pending;
  if ("error" in outcome) throw outcome.error;
  return {
    module: outcome.data === null ? null : serialize(outcome.data),
    emitted,
    fetched: fetcher.fetched,
    retried: fetcher.retried,
  };
}

/** A run document's delay that brings the newest runs back last. */
function reversed(key: string): number {
  const match = /^docs\/run-(\d+)\.json$/.exec(key);
  return match ? (RUNS - Number(match[1])) * 10 : 1;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadSnapshot", () => {
  it("assembles and emits the same bytes at any concurrency", async () => {
    const sequential = await load(bucket(snapshotObjects()), 1);
    const source = bucket(snapshotObjects(), { delay: reversed });
    const concurrent = await load(source, 8);

    expect(sequential.module).not.toBeNull();
    expect(concurrent.module).toBe(sequential.module);
    expect(concurrent.emitted).toEqual(sequential.emitted);
    expect(source.peak()).toBe(8);
  });

  it("emits a run's record before its events, one run after another", async () => {
    const { emitted } = await load(
      bucket(snapshotObjects(), { delay: reversed }),
      8,
    );

    const expected: string[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      expected.push(`record ${runId(index)}`);
      if (index % 3 !== 0) expected.push(`events ${runId(index)}`);
    }
    expect(
      emitted.map((line) => line.split(" ").slice(0, 2).join(" ")),
    ).toEqual(expected);
  });

  it("fetches one document at a time with a concurrency of one", async () => {
    const source = bucket(snapshotObjects());
    await load(source, 1);
    expect(source.peak()).toBe(1);
  });

  it("rides out a dropped connection and reports it", async () => {
    const clean = await load(bucket(snapshotObjects()), 8);
    const flaky = await load(
      bucket(snapshotObjects(), {
        delay: reversed,
        failures: new Map([
          ["index.json", 1],
          ["docs/run-04.json", 2],
          ["s1/cases/beta/1.0.0.json", 1],
        ]),
      }),
      8,
    );

    expect(flaky.module).toBe(clean.module);
    expect(flaky.emitted).toEqual(clean.emitted);
    // index, runs, twelve documents, three cases and the model catalog.
    expect(flaky.fetched).toBe(18);
    expect(flaky.retried).toBe(3);
    expect(clean.retried).toBe(0);
  });

  it("resolves to null when index.json is absent, on one request", async () => {
    const objects = snapshotObjects();
    objects.delete("index.json");
    const source = bucket(objects);

    const loaded = await load(source, 8);

    expect(loaded.module).toBeNull();
    expect(source.requests).toEqual(["index.json"]);
  });

  it("fails when index.json keeps failing", async () => {
    const source = bucket(snapshotObjects(), {
      failures: new Map([["index.json", 99]]),
      failWith: () =>
        Promise.resolve(
          new Response("", { status: 502, statusText: "Bad Gateway" }),
        ),
    });

    await expect(load(source, 8)).rejects.toThrow(
      `502 Bad Gateway for ${BASE}/index.json after 5 attempts`,
    );
  });

  it("fails on a run document that is absent, without retrying it", async () => {
    const objects = snapshotObjects();
    objects.delete("docs/run-05.json");
    const source = bucket(objects);

    await expect(load(source, 8)).rejects.toThrow(
      `404 Not Found for ${BASE}/docs/run-05.json after 1 attempt`,
    );
    expect(
      source.requests.filter((key) => key === "docs/run-05.json"),
    ).toHaveLength(1);
  });

  it("fails on a run document that keeps dropping, naming it", async () => {
    const source = bucket(snapshotObjects(), {
      failures: new Map([["docs/run-07.json", 99]]),
    });

    await expect(load(source, 8)).rejects.toThrow(
      `terminated for ${BASE}/docs/run-07.json after 5 attempts`,
    );
  });

  it("fails on a summary with no documentKey before fetching a document", async () => {
    const objects = snapshotObjects();
    const runs = objects.get("s1/runs.json") as {
      runs: Array<{ documentKey?: string }>;
    };
    delete runs.runs[9]?.documentKey;
    const source = bucket(objects);

    await expect(load(source, 8)).rejects.toThrow(
      "snapshot run summary run-09 carries no documentKey",
    );
    expect(source.requests).toEqual(["index.json", "s1/runs.json"]);
  });

  it("leaves out a case file and a catalog that cannot be fetched", async () => {
    const objects = snapshotObjects();
    objects.delete("s1/cases/beta/1.0.0.json");
    const source = bucket(objects, {
      failures: new Map([["s1/models.json", 99]]),
    });

    const loaded = await load(source, 8);

    expect(loaded.module).toContain("export const models = [];");
    const cases = /export const testCases = (.*);/.exec(loaded.module ?? "");
    expect(
      (JSON.parse(cases?.[1] ?? "[]") as Array<{ slug: string }>).map(
        (entry) => entry.slug,
      ),
    ).toEqual(["alpha", "gamma"]);
    expect(
      loaded.emitted.filter((line) => line.startsWith("record")),
    ).toHaveLength(RUNS);
  });
});
