import { describe, expect, it, vi } from "vitest";
import {
  createStaticFiles,
  REQUEST_RETRY_MS,
  type CaseVersionFile,
} from "./staticFiles";

const SHELL = "<!doctype html><div id=root></div>";

/** A deployment over `files`, which answers a path it does not hold as its host does. */
function deployment(
  files: Record<string, unknown>,
  missing: "404" | "shell" = "shell",
) {
  const requests: string[] = [];
  const failing = new Set<string>();
  return {
    requests,
    failing,
    fetch: (url: string): Promise<Response> => {
      requests.push(url);
      if (failing.has(url)) {
        return Promise.resolve(
          new Response("", { status: 503, statusText: "Unavailable" }),
        );
      }
      if (url in files) {
        return Promise.resolve(
          new Response(JSON.stringify(files[url]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        missing === "404"
          ? new Response("", { status: 404, statusText: "Not Found" })
          : new Response(SHELL, {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
      );
    },
  };
}

const MEDIA = {
  proof: {},
  asset: {},
  validation: { "item__shot.png": "https://bucket/val/item__shot.png" },
  validationStorePrefix: null,
  showcase: {},
  codeAnalysisUrl: null,
};

const VERSION: CaseVersionFile = {
  variants: [],
  media: {
    baselines: {},
    baselineStorePrefixes: {},
    showcase: {},
    reference: {},
  },
};

describe("createStaticFiles", () => {
  it("reads a run's file and answers for its media from then on", async () => {
    const host = deployment({
      "/runs/r1.json": { record: { id: "r1" }, reviews: [], media: MEDIA },
    });
    const files = createStaticFiles("/", host.fetch);

    expect(files.runMedia("r1")).toBeUndefined();
    const run = await files.loadRun("r1");

    expect(run?.record).toEqual({ id: "r1" });
    expect(files.runMedia("r1")).toEqual(MEDIA);
  });

  it("reads the application shell served for a missing file as absence", async () => {
    const files = createStaticFiles("/", deployment({}, "shell").fetch);

    expect(await files.loadRun("nope")).toBeNull();
    expect(await files.loadCaseDetail("nope")).toBeNull();
    expect(await files.loadCaseVersion("nope", "v1")).toBeNull();
    expect(await files.response("run-events/nope.json", "events")).toBeNull();
  });

  it("reads a 404 as absence", async () => {
    const files = createStaticFiles("/", deployment({}, "404").fetch);

    expect(await files.loadRun("nope")).toBeNull();
  });

  it("fails a read the host could not answer", async () => {
    const host = deployment({});
    host.failing.add("/runs/r1.json");
    const files = createStaticFiles("/", host.fetch);

    await expect(files.loadRun("r1")).rejects.toThrow("run r1: HTTP 503");
  });

  it("encodes each path segment under the base path", async () => {
    const host = deployment({});
    const files = createStaticFiles("/gallery/", host.fetch);

    await files.loadCaseVersion("a b", "v1/2");

    expect(host.requests).toEqual(["/gallery/cases/a%20b/v1%2F2.json"]);
  });

  it("shares one request for a case version and tells its subscribers", async () => {
    const host = deployment({ "/cases/alpha/v1.json": VERSION });
    const files = createStaticFiles("/", host.fetch);
    let told = 0;
    const unsubscribe = files.subscribe(() => {
      told += 1;
    });

    expect(files.caseVersion("alpha", "v1")).toBeUndefined();
    const [first, second] = await Promise.all([
      files.loadCaseVersion("alpha", "v1"),
      files.loadCaseVersion("alpha", "v1"),
    ]);
    await files.loadCaseVersion("alpha", "v1");

    expect(first).toEqual(VERSION);
    expect(second).toBe(first);
    expect(host.requests).toHaveLength(1);
    expect(files.caseVersion("alpha", "v1")).toEqual(VERSION);
    expect(files.revision()).toBe(1);
    expect(told).toBe(1);

    unsubscribe();
    host.requests.length = 0;
    await files.loadCaseVersion("beta", "v1");
    expect(told).toBe(1);
    // An absent version changes nothing a resolver could answer.
    expect(files.revision()).toBe(1);
  });

  it("tries a failed case version again when it is asked for by name", async () => {
    const host = deployment({ "/cases/alpha/v1.json": VERSION });
    host.failing.add("/cases/alpha/v1.json");
    const files = createStaticFiles("/", host.fetch);

    await expect(files.loadCaseVersion("alpha", "v1")).rejects.toThrow(
      "version v1 of case alpha: HTTP 503",
    );
    host.failing.clear();

    expect(await files.loadCaseVersion("alpha", "v1")).toEqual(VERSION);
  });

  it("requests an unloaded case version once, and again only after a wait", async () => {
    vi.useFakeTimers();
    try {
      const host = deployment({ "/cases/alpha/v1.json": VERSION });
      host.failing.add("/cases/alpha/v1.json");
      const files = createStaticFiles("/", host.fetch);

      files.requestCaseVersion("alpha", "v1");
      files.requestCaseVersion("alpha", "v1");
      await vi.advanceTimersByTimeAsync(0);
      files.requestCaseVersion("alpha", "v1");
      await vi.advanceTimersByTimeAsync(REQUEST_RETRY_MS - 1);
      files.requestCaseVersion("alpha", "v1");
      await vi.advanceTimersByTimeAsync(0);

      expect(host.requests).toHaveLength(1);
      expect(files.caseVersion("alpha", "v1")).toBeUndefined();

      host.failing.clear();
      await vi.advanceTimersByTimeAsync(1);
      files.requestCaseVersion("alpha", "v1");
      await vi.advanceTimersByTimeAsync(0);

      expect(host.requests).toHaveLength(2);
      expect(files.caseVersion("alpha", "v1")).toEqual(VERSION);
      expect(files.revision()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
