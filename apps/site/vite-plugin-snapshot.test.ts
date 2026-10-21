import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSnapshotFetcher, type SnapshotFetch } from "./snapshot-fetch";
import {
  loadSnapshot,
  PAGES_FILE_LIMIT_BYTES,
  reportSizes,
  serialize,
} from "./vite-plugin-snapshot";

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
    {
      run: (id, json) => emitted.push(`run ${id} ${json}`),
      events: (id, json) => emitted.push(`events ${id} ${json}`),
      caseDetail: (slug, json) => emitted.push(`case ${slug} ${json}`),
      caseVersion: (slug, version, json) =>
        emitted.push(`version ${slug}/${version} ${json}`),
    },
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

/** What one kind of file was emitted with, by the id its line names. */
function emittedAs<T>(loaded: Loaded, kind: string): Map<string, T> {
  const files = new Map<string, T>();
  for (const line of loaded.emitted) {
    const [lineKind, id, ...json] = line.split(" ");
    if (lineKind === kind && id !== undefined) {
      files.set(id, JSON.parse(json.join(" ")) as T);
    }
  }
  return files;
}

/** One exported constant of the serialized index. */
function exported<T>(loaded: Loaded, name: string): T {
  const match = new RegExp(`^export const ${name} = (.*);$`, "m").exec(
    loaded.module ?? "",
  );
  if (!match?.[1]) throw new Error(`the index exports no ${name}`);
  return JSON.parse(match[1]) as T;
}

/** A case version's snapshot file with one variant that declares a showcase. */
function caseFile(
  slug: string,
  version: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    slug,
    version,
    name: slug,
    difficulty: "easy",
    tags: ["t"],
    summary: "a summary",
    description: `${slug} ${version} described`,
    changelog: `${version} changed`,
    domains: [{ id: "play", name: "Play", description: "" }],
    variants: [
      {
        slug: "base",
        name: "Base",
        description: null,
        prompt: `${version} prompt`,
        engineRenderings: { tide: { prompt: `${version} prompt for tide` } },
        showcase: {
          description: "shown",
          media: [
            {
              file: "clip.webm",
              name: "Clip",
              kind: "video",
              key: `media/${slug}/${version}/clip.mp4`,
            },
          ],
        },
        referenceSheet: { frames: [2] },
      },
    ],
    validationBaselines: [
      {
        engine: "tide",
        variant: "base",
        file: "item__shot.png",
        key: `base/${slug}/${version}/item__shot.png`,
      },
      {
        engine: "tide",
        variant: "base",
        file: "img.abc.png",
        key: `base/${slug}/${version}/store/img.abc.png`,
      },
    ],
    ...extra,
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

  it("emits a run's file before its events, then each case before its versions", async () => {
    const { emitted } = await load(
      bucket(snapshotObjects(), { delay: reversed }),
      8,
    );

    const expected: string[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      expected.push(`run ${runId(index)}`);
      if (index % 3 !== 0) expected.push(`events ${runId(index)}`);
    }
    for (const slug of CASES) {
      expected.push(`case ${slug}`, `version ${slug}/1.0.0`);
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
      loaded.emitted.filter((line) => line.startsWith("run ")),
    ).toHaveLength(RUNS);
    // A case whose file was left out has no file of its own to ask for either.
    expect([...emittedAs(loaded, "case").keys()]).toEqual(["alpha", "gamma"]);
    expect([...emittedAs(loaded, "version").keys()]).toEqual([
      "alpha/1.0.0",
      "gamma/1.0.0",
    ]);
  });

  it("writes a run's record, reviews and media to the run's own file", async () => {
    const objects = snapshotObjects();
    objects.set("docs/run-01.json", {
      schemaVersion: 1,
      record: { id: "run-01", payload: 1 },
      reviews: [
        {
          reviewer: "Ada",
          ratings: [{ domain: "play", rating: "great" }],
          aesthetics: [
            { domain: "play", rating: "good" },
            { domain: "feel", rating: "okay" },
          ],
          writeup: "Plays well.",
        },
      ],
      proofMedia: [{ id: "p", kind: "image", key: "media/run-01/proof.png" }],
      assetMedia: [{ file: "preview.png", key: "media/run-01/preview.png" }],
      validationMedia: [
        { file: "item__clip.webm", key: "val/run-01/item__clip.mp4" },
        { file: "img.one.png", key: "val/run-01/store/img.one.png" },
        { file: "img.two.png", key: "val/run-01/store/img.two.png" },
      ],
      showcaseMedia: [{ file: "hero.png", key: "show/run-01/hero.png" }],
      codeAnalysisKey: "code/run-01/7.json",
      events: [{ seq: 1 }],
    });

    const loaded = await load(bucket(objects), 8);

    expect(emittedAs(loaded, "run").get("run-01")).toEqual({
      record: { id: "run-01", payload: 1 },
      reviews: [
        {
          reviewer: "Ada",
          ratings: [{ domain: "play", rating: "great" }],
          aesthetic: "okay",
          aesthetics: [
            { domain: "play", rating: "good" },
            { domain: "feel", rating: "okay" },
          ],
          writeup: "Plays well.",
          checklist: [],
          reviewedAt: null,
        },
      ],
      media: {
        proof: { "proof.png": `${BASE}/media/run-01/proof.png` },
        asset: { "preview.png": `${BASE}/media/run-01/preview.png` },
        validation: {
          "item__clip.webm": `${BASE}/val/run-01/item__clip.mp4`,
        },
        validationStorePrefix: `${BASE}/val/run-01/store/`,
        showcase: { "hero.png": `${BASE}/show/run-01/hero.png` },
        codeAnalysisUrl: `${BASE}/code/run-01/7.json`,
      },
    });
    // A run that published none of it still has every field, empty.
    expect(emittedAs(loaded, "run").get("run-00")).toEqual({
      record: { id: "run-00", payload: 0 },
      reviews: [],
      media: {
        proof: { "proof.png": `${BASE}/media/run-00/proof.png` },
        asset: {},
        validation: {},
        validationStorePrefix: null,
        showcase: {},
        codeAnalysisUrl: null,
      },
    });
  });

  it("keeps the index independent of what any one run carries", async () => {
    const plain = await load(bucket(snapshotObjects()), 8);
    const objects = snapshotObjects();
    for (let index = 0; index < RUNS; index += 1) {
      const key = `docs/${runId(index)}.json`;
      objects.set(key, {
        ...(objects.get(key) as object),
        reviews: [{ reviewer: "Ada", ratings: [], writeup: "x".repeat(4096) }],
        validationMedia: Array.from({ length: 64 }, (_unused, item) => ({
          file: `item-${item}__shot.png`,
          key: `val/${runId(index)}/item-${item}__shot.png`,
        })),
        showcaseMedia: [{ file: "hero.png", key: `show/${runId(index)}.png` }],
        codeAnalysisKey: `code/${runId(index)}.json`,
      });
    }

    const heavy = await load(bucket(objects), 8);

    expect(heavy.module).toBe(plain.module);
  });

  it("splits a case into its listing card, its detail and a file per version", async () => {
    const objects = snapshotObjects();
    const runs = objects.get("s1/runs.json") as {
      runs: Array<{
        subject: { testCaseSlug: string; testCaseVersion: string };
      }>;
    };
    // The oldest alpha run was of an older version, referenced after the newer.
    const oldest = runs.runs[9];
    if (oldest) oldest.subject.testCaseVersion = "0.9.0";
    objects.set("s1/cases/alpha/1.0.0.json", caseFile("alpha", "1.0.0"));
    objects.set(
      "s1/cases/alpha/0.9.0.json",
      caseFile("alpha", "0.9.0", { changelog: null }),
    );

    const loaded = await load(bucket(objects), 8);

    // The index: the listing card alone, and the media that card previews.
    expect(
      exported<Array<{ slug: string }>>(loaded, "testCases").find(
        (entry) => entry.slug === "alpha",
      ),
    ).toEqual({
      slug: "alpha",
      name: "alpha",
      testType: "end-to-end",
      assetKind: null,
      difficulty: "easy",
      tags: ["t"],
      summary: "a summary",
      versions: ["1.0.0", "0.9.0"],
      latestVersion: "1.0.0",
      showcase: {
        version: "1.0.0",
        variant: "base",
        media: [{ file: "clip.webm", name: "Clip", kind: "video" }],
      },
    });
    expect(exported(loaded, "catalogShowcaseMediaUrls")).toEqual({
      "alpha/1.0.0/base": {
        "clip.webm": `${BASE}/media/alpha/1.0.0/clip.mp4`,
      },
    });
    expect(loaded.module).not.toContain("prompt");
    expect(loaded.module).not.toContain("described");

    // The case's own file: what spans its versions.
    expect(emittedAs(loaded, "case").get("alpha")).toEqual({
      description: "alpha 1.0.0 described",
      descriptionsByVersion: {
        "1.0.0": "alpha 1.0.0 described",
        "0.9.0": "alpha 0.9.0 described",
      },
      changelog: [{ version: "1.0.0", body: "1.0.0 changed" }],
      errata: [],
      variantsByVersion: {
        "1.0.0": [{ slug: "base", name: "Base" }],
        "0.9.0": [{ slug: "base", name: "Base" }],
      },
      enginesByVersion: {
        "1.0.0": ["none", "tide"],
        "0.9.0": ["none", "tide"],
      },
      domains: [{ id: "play", name: "Play", description: "" }],
      sheet: null,
    });

    // One file per version, each with its own variants and media.
    const versions = emittedAs<{
      variants: Array<{
        prompt: string;
        engineRenderings: Record<string, { prompt: string }>;
      }>;
      media: unknown;
    }>(loaded, "version");
    expect(
      [...versions.keys()].filter((id) => id.startsWith("alpha/")),
    ).toEqual(["alpha/1.0.0", "alpha/0.9.0"]);
    const older = versions.get("alpha/0.9.0");
    expect(older?.variants[0]?.prompt).toBe("0.9.0 prompt");
    expect(older?.variants[0]?.engineRenderings.tide?.prompt).toBe(
      "0.9.0 prompt for tide",
    );
    expect(older?.media).toEqual({
      baselines: {
        "tide/base": {
          "item__shot.png": `${BASE}/base/alpha/0.9.0/item__shot.png`,
        },
      },
      baselineStorePrefixes: {
        "tide/base": `${BASE}/base/alpha/0.9.0/store/`,
      },
      showcase: {
        base: { "clip.webm": `${BASE}/media/alpha/0.9.0/clip.mp4` },
      },
      reference: {
        base: {
          "frames/2.png": `${BASE}/media/references/alpha/0.9.0/base/frames/2.png`,
          "frames/2.actions.json": `${BASE}/media/references/alpha/0.9.0/base/frames/2.actions.json`,
        },
      },
    });
  });

  // A case is listed once any run of it is published, and previews its NEWEST
  // showcase from `case-showcases.json` — even when that version has no published
  // run, and so no case file of its own.
  describe("with the case showcases", () => {
    function withShowcases(objects: Map<string, unknown>) {
      const index = objects.get("index.json") as Record<string, unknown>;
      index.caseShowcasesKey = "s1/case-showcases.json";
      const entry = (slug: string, version: string, variants: string[]) => ({
        slug,
        version,
        variants: variants.map((variant) => ({
          variant,
          showcase: {
            description: "shown",
            media: [
              {
                file: "play.json.gz",
                name: `${version} play`,
                kind: "replay",
                key: `media/cases/${slug}/${version}/showcase/${variant}/d-play.json.gz`,
              },
            ],
          },
        })),
      });
      objects.set("s1/case-showcases.json", {
        schemaVersion: 2,
        showcases: [
          entry("alpha", "1.0.0", ["base"]),
          // Newer than any run of alpha, and listed out of order: the newest wins
          // by version, not by position.
          entry("alpha", "10.0.0", ["second", "base"]),
          entry("alpha", "2.0.0", ["base"]),
          // A case no published run built: it stays unlisted.
          entry("unlisted", "1.0.0", ["base"]),
        ],
      });
      objects.set("s1/cases/alpha/1.0.0.json", caseFile("alpha", "1.0.0"));
      return objects;
    }

    it("previews a case with its newest showcase, run or no run", async () => {
      const loaded = await load(bucket(withShowcases(snapshotObjects())), 8);
      const alpha = exported<
        Array<{ slug: string; latestVersion: string; showcase: unknown }>
      >(loaded, "testCases").find((entry) => entry.slug === "alpha");
      // Listed at the version its runs built, previewed from the newest showcase,
      // first variant in manifest order.
      expect(alpha?.latestVersion).toBe("1.0.0");
      expect(alpha?.showcase).toEqual({
        version: "10.0.0",
        variant: "second",
        media: [{ file: "play.json.gz", name: "10.0.0 play", kind: "replay" }],
      });
      const urls = exported<Record<string, Record<string, string>>>(
        loaded,
        "catalogShowcaseMediaUrls",
      );
      expect(urls["alpha/10.0.0/second"]).toEqual({
        "play.json.gz": `${BASE}/media/cases/alpha/10.0.0/showcase/second/d-play.json.gz`,
      });
      expect(
        Object.keys(urls).some((key) => key.startsWith("alpha/1.0.0")),
      ).toBe(false);
    });

    it("lists no case that only the showcases name", async () => {
      const loaded = await load(bucket(withShowcases(snapshotObjects())), 8);
      const slugs = exported<Array<{ slug: string }>>(loaded, "testCases").map(
        (entry) => entry.slug,
      );
      expect(slugs).not.toContain("unlisted");
      expect(loaded.module).not.toContain("media/cases/unlisted");
    });

    it("previews nothing for a listed case with no showcase in the file", async () => {
      // The file is authoritative when present: a case it carries no showcase for
      // previews the placeholder rather than an older case file's showcase.
      const objects = withShowcases(snapshotObjects());
      const file = objects.get("s1/case-showcases.json") as {
        showcases: Array<{ slug: string }>;
      };
      file.showcases = file.showcases.filter((entry) => entry.slug !== "alpha");
      const loaded = await load(bucket(objects), 8);
      const alpha = exported<Array<{ slug: string; showcase: unknown }>>(
        loaded,
        "testCases",
      ).find((entry) => entry.slug === "alpha");
      expect(alpha?.showcase).toBeNull();
    });

    it("passes over a newer version whose showcase has no media", async () => {
      // A showcase whose media the publisher could not find in its store reaches
      // the file empty; the preview takes the next version down instead.
      const objects = withShowcases(snapshotObjects());
      const file = objects.get("s1/case-showcases.json") as {
        showcases: Array<{
          version: string;
          variants: Array<{ showcase: { media: unknown[] } }>;
        }>;
      };
      for (const entry of file.showcases) {
        if (entry.version === "10.0.0") {
          for (const variant of entry.variants) variant.showcase.media = [];
        }
      }
      const loaded = await load(bucket(objects), 8);
      const alpha = exported<
        Array<{ slug: string; showcase: { version: string } | null }>
      >(loaded, "testCases").find((entry) => entry.slug === "alpha");
      expect(alpha?.showcase?.version).toBe("2.0.0");
    });

    it("falls back to the case files when the showcases cannot be read", async () => {
      const objects = withShowcases(snapshotObjects());
      objects.delete("s1/case-showcases.json");
      const loaded = await load(bucket(objects), 8);
      const alpha = exported<Array<{ slug: string; showcase: unknown }>>(
        loaded,
        "testCases",
      ).find((entry) => entry.slug === "alpha");
      expect(alpha?.showcase).toEqual({
        version: "1.0.0",
        variant: "base",
        media: [{ file: "clip.webm", name: "Clip", kind: "video" }],
      });
    });
  });
});

describe("reportSizes", () => {
  const files = [
    { fileName: "assets/index-abc.js", bytes: 4_000_000 },
    { fileName: "assets/VoxelViewer-def.js", bytes: 1_300 },
    { fileName: "assets/index-abc.css", bytes: 9_000_000 },
    { fileName: "runs/r1.json", bytes: 150_000 },
    { fileName: "run-events/r1.json", bytes: 60_000 },
    { fileName: "cases/alpha/1.0.0.json", bytes: 900_000 },
    { fileName: "cases/alpha.json", bytes: 20_000 },
  ];

  it("names the bundle and the largest data file", () => {
    expect(reportSizes(files)).toEqual({
      bundle: { fileName: "assets/index-abc.js", bytes: 4_000_000 },
      data: { fileName: "cases/alpha/1.0.0.json", bytes: 900_000 },
      oversized: [],
    });
  });

  it("accepts a file of exactly the limit and names every file over it", () => {
    const report = reportSizes([
      ...files,
      { fileName: "assets/exact.js", bytes: PAGES_FILE_LIMIT_BYTES },
      { fileName: "runs/r2.json", bytes: PAGES_FILE_LIMIT_BYTES + 1 },
      { fileName: "assets/huge.js", bytes: 32_000_000 },
    ]);

    expect(report.oversized).toEqual([
      { fileName: "assets/huge.js", bytes: 32_000_000 },
      { fileName: "runs/r2.json", bytes: PAGES_FILE_LIMIT_BYTES + 1 },
    ]);
  });
});
