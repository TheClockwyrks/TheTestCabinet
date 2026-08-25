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

// --- The console stream -----------------------------------------------------

// A stand-in for the browser's EventSource that lets a test drive the connection:
// deliver frames, raise errors, and settle into either readyState. Every instance
// is recorded so a test can assert on reconnects.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  // --- Test drivers ---

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  emit(type: string, data?: unknown) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data: data === undefined ? "" : JSON.stringify(data) });
    }
  }

  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }
}

function useFakeEventSource() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return FakeEventSource;
}

describe("engine dimension", () => {
  // The engines a version supports are what the new-run form's picker offers. A
  // resolved version that drops them offers nothing, so no case can be run on an
  // engine at all.
  it("carries a version's supported engines through resolution", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({
        slug: "carom",
        version: "v3.0.0",
        name: "Carom",
        difficulty: "easy",
        tags: [],
        summary: null,
        description: null,
        changelog: "",
        maxRuntimeSeconds: 1800,
        testType: "end-to-end",
        engines: [{ slug: "none" }, { slug: "simple-2d", minVersion: "1.0.0" }],
        variants: [],
        checks: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const info = await createHttpBackend(BACKEND).resolveVersion(
      "carom",
      "v3.0.0",
      "simple-2d",
    );

    // The range is the host's gate, not the picker's, so only the slugs travel on.
    expect(info.engines).toEqual(["none", "simple-2d"]);
    // The engine names which branch of the case's templates the per-variant prompt
    // is rendered from, so it has to reach the backend on the read itself.
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${BACKEND}/test-cases/carom/versions/v3.0.0?engine=simple-2d`,
    );
  });

  // The spec bodies branch on the engine exactly as the prompt does, so the run's
  // Inputs tab has to name the engine on this read too — otherwise the specs and
  // the prompt beside them could describe different deliverables.
  it("renders seeded specs for the requested engine", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({
        slug: "carom",
        version: "v3.0.0",
        variant: "base",
        description: null,
        specs: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createHttpBackend(BACKEND).readSpecs(
      "carom",
      "v3.0.0",
      "base",
      "simple-2d",
    );

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${BACKEND}/test-cases/carom/versions/v3.0.0/specs/base?engine=simple-2d`,
    );
  });

  // The launch body is the only place a collected engine reaches the backend. A
  // run enqueued without it is an engineless run, whatever the operator picked.
  it("puts the selected engine on the enqueued launch body", async () => {
    // The mock declares its parameters so the recorded call is typed, which is
    // what lets the assertion read the enqueued body back off it.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ runId: "run-9" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createBackendExec(BACKEND, AUTH, ARTIFACTS).launchRun(
      {
        testCase: "carom",
        version: "v3.0.0",
        variant: "base",
        harness: "claude",
        modelId: "claude-opus-4-8",
        orchestrator: "one-shot",
        engine: "simple-2d",
        maxRuntimeOverride: null,
      },
      "token",
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.engine).toBe("simple-2d");
  });

  // Omitted rather than sent as an empty value, which is how the backend spells
  // the `none` default.
  it("omits the engine when the caller pinned none", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ runId: "run-10" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createBackendExec(BACKEND, AUTH, ARTIFACTS).launchRun(
      {
        testCase: "carom",
        version: "v1.0.0",
        variant: "base",
        harness: "claude",
        modelId: "claude-opus-4-8",
        orchestrator: "one-shot",
        maxRuntimeOverride: null,
      },
      "token",
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body).not.toHaveProperty("engine");
  });
});

describe("createBackendExec console stream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-applies the wanted topics to each new stream", async () => {
    // The backend mints a fresh stream id per connection with default topics, so a
    // console that was watching in-flight runs must say so again after any
    // reconnect — otherwise it comes back subscribed to nothing, silently.
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const sources = useFakeEventSource();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({ onNotification: () => {} });
    const first = sources.instances[0]!;
    first.open();
    first.emit("stream", { streamId: "s1" });
    await client.setRunLifecycleEnabled(true);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BACKEND}/notifications/s1/topics`,
      expect.objectContaining({ method: "PUT" }),
    );

    // A reconnect under a new id: the transport must re-apply, unprompted.
    fetchMock.mockClear();
    first.emit("stream", { streamId: "s2" });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${BACKEND}/notifications/s2/topics`,
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ runs: true }),
        }),
      ),
    );
  });

  it("records the wanted topic even with no stream connected", async () => {
    // The console toggles this on navigation, which easily happens before the
    // stream connects or during a reconnect. Failing there would leave the page
    // subscribed to nothing.
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const sources = useFakeEventSource();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({ onNotification: () => {} });
    await client.setRunLifecycleEnabled(true);
    expect(fetchMock).not.toHaveBeenCalled();

    // ...and it is applied as soon as a stream announces itself.
    sources.instances[0]!.emit("stream", { streamId: "s1" });
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${BACKEND}/notifications/s1/topics`,
        expect.objectContaining({ body: JSON.stringify({ runs: true }) }),
      ),
    );
  });

  it("reopens a stream the browser has given up on", async () => {
    // readyState CLOSED means the browser will not retry, ever. With no polling
    // left, nothing but this reopen would recover the console.
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const sources = useFakeEventSource();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({ onNotification: () => {} });
    sources.instances[0]!.open();
    expect(sources.instances).toHaveLength(1);

    sources.instances[0]!.fail(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sources.instances).toHaveLength(2);
  });

  it("leaves a stream the browser is already retrying alone", async () => {
    // readyState CONNECTING means a retry is under way; opening a second stream
    // would race it and leave two connections fighting over the topic state.
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const sources = useFakeEventSource();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({ onNotification: () => {} });
    sources.instances[0]!.open();
    sources.instances[0]!.fail(FakeEventSource.CONNECTING);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sources.instances).toHaveLength(1);
  });

  it("reopens a stream that has gone silent", async () => {
    // The failure no EventSource API reports: it believes it is connected and is
    // not. The backend's heartbeat is what makes silence meaningful, and this
    // watchdog is what acts on it.
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const sources = useFakeEventSource();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({ onNotification: () => {} });
    sources.instances[0]!.open();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sources.instances.length).toBeGreaterThan(1);
    expect(sources.instances[0]!.closed).toBe(true);
  });

  it("keeps a heartbeating stream open indefinitely", async () => {
    // The other half of the same rule: an idle queue must not be mistaken for a
    // dead connection, however long nothing happens.
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const sources = useFakeEventSource();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({ onNotification: () => {} });
    const source = sources.instances[0]!;
    source.open();

    for (let i = 0; i < 20; i += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
      source.emit("heartbeat");
    }

    expect(sources.instances).toHaveLength(1);
    expect(source.closed).toBe(false);
  });

  it("stops supervising once unsubscribed", async () => {
    // A torn-down subscription must not resurrect itself on a timer.
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const sources = useFakeEventSource();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    const unsubscribe = client.subscribeToNotifications({
      onNotification: () => {},
    });
    sources.instances[0]!.open();
    unsubscribe();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(sources.instances).toHaveLength(1);
    expect(sources.instances[0]!.closed).toBe(true);
  });

  it("delivers each frame kind to its handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const sources = useFakeEventSource();
    const onNotification = vi.fn();
    const onRunLifecycle = vi.fn();
    const onResync = vi.fn();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({
      onNotification,
      onRunLifecycle,
      onResync,
    });
    const source = sources.instances[0]!;
    source.open();
    source.emit("notification", { kind: "run-completed", jobId: "j1" });
    source.emit("run", { kind: "enqueued", runId: "j2" });
    source.emit("resync", { dropped: 4 });

    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1" }),
    );
    expect(onRunLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "j2" }),
    );
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("survives a malformed frame", async () => {
    // One bad payload must not tear down a connection the whole console depends on.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const sources = useFakeEventSource();
    const onNotification = vi.fn();

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    client.subscribeToNotifications({ onNotification });
    const source = sources.instances[0]!;
    source.open();
    for (const handler of ["notification"]) {
      source.emit(handler);
    }
    source.emit("notification", { kind: "run-completed", jobId: "j1" });

    expect(source.closed).toBe(false);
    expect(onNotification).toHaveBeenCalledTimes(1);
  });
});

// The live NDJSON stream (`GET /jobs/{id}/live`) as the browser hands it to the
// reader: each chunk is delivered, then the body either closes cleanly or fails
// mid-read the way a reset connection does (Chromium: `TypeError: Error in input
// stream`).
function liveBody(lines: string[], dropAfter: boolean): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
    },
    // Called once the queued chunks are drained — so, as on the wire, the bytes
    // that made it through are read before the drop (or the close) is seen.
    pull(controller) {
      if (dropAfter) controller.error(new TypeError("Error in input stream"));
      else controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

function event(n: number): string {
  return JSON.stringify({
    timestamp: `2026-01-01T00:00:0${n}Z`,
    type: "system",
    message: `e${n}`,
  });
}

// Drive `subscribeToRun` to its terminal handler, resolving with the outcome.
function subscribe(client: ReturnType<typeof createBackendExec>) {
  const onEvent = vi.fn();
  const onError = vi.fn();
  const done = new Promise<unknown>((resolve) => {
    client.subscribeToRun("job-1", {
      onEvent,
      onError: (e) => {
        onError(e);
        resolve({ error: e });
      },
      onDone: resolve,
    });
  });
  return { onEvent, onError, done };
}

describe("subscribeToRun over a dropped live stream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The regression: a gg run that refused its configuration exited within a
  // minute, the live connection was reset mid-body, and the monitor surfaced
  // the browser's `TypeError: Error in input stream` as a UI error instead of
  // the run's own failed outcome.
  it("resolves a run that has already ended to its outcome, not the transport error", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/jobs/job-1/live")) return liveBody([event(1)], true);
      if (url.endsWith("/jobs/job-1"))
        return Response.json({
          id: "job-1",
          state: "failed",
          recordId: "run-1",
          detail: "run failed: gg exited with code 1 (session ended `error`)",
        });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    const { onEvent, onError, done } = subscribe(client);

    await expect(done).resolves.toEqual({
      kind: "failed",
      message: "run failed: gg exited with code 1 (session ended `error`)",
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("re-joins a still-running job and skips the replayed backlog", async () => {
    vi.useFakeTimers();
    let liveOpens = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/jobs/job-1/live")) {
        liveOpens += 1;
        // First connection: two events, then the drop. Second: the backend
        // replays both, adds a third, and closes because the run ended.
        return liveOpens === 1
          ? liveBody([event(1), event(2)], true)
          : liveBody([event(1), event(2), event(3)], false);
      }
      if (url.endsWith("/jobs/job-1"))
        return Response.json(
          liveOpens === 1
            ? { id: "job-1", state: "running" }
            : { id: "job-1", state: "succeeded", recordId: "run-1" },
        );
      if (url.endsWith("/runs/run-1"))
        return Response.json(storedRunBody("run-1"));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    const { onEvent, onError, done } = subscribe(client);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(done).resolves.toMatchObject({ kind: "completed" });
    expect(onError).not.toHaveBeenCalled();
    expect(liveOpens).toBe(2);
    expect(onEvent.mock.calls.map(([e]) => e.message)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
  });

  it("reports the drop once the job stays unreachable past the reconnect budget", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/jobs/job-1/live")) return liveBody([], true);
      if (url.endsWith("/jobs/job-1"))
        return Response.json({ id: "job-1", state: "running" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createBackendExec(BACKEND, AUTH, ARTIFACTS);
    const { onError, done } = subscribe(client);
    await vi.advanceTimersByTimeAsync(60_000);

    await done;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![0])).toContain(
      "Error in input stream",
    );
  });
});
