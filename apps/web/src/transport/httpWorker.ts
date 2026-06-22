// The WorkerClient over HTTP, against a worker's REST API
// (components/worker/overview.md). A worker only executes runs and publishes
// them — it never serves the catalog. The review carried with a publish travels
// inline (the worker keeps no review store); the case-declared checklist items a
// reviewer works through are catalog data, read from the backend instead.
// Enumerating produced runs reads the worker's `GET /runs`, which lists the run
// records it has written to its output directory.
import type {
  WorkerClient,
  RunSubscription,
  NotificationSubscription,
} from "@test-cabinet/ui/client";
import type {
  AssetPreview,
  AuthResult,
  HarnessEvent,
  InProgressRun,
  LaunchConfig,
  ProgressCallback,
  PublishResult,
  PushResult,
  RawOutputLine,
  ReviewDocumentInput,
  RunEventStreams,
  RunJob,
  RunNotification,
  StoredRun,
  WorkerIdentity,
} from "@test-cabinet/ui/client";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  getJson,
  getNdjson,
  getNdjsonStreamed,
  joinUrl,
  postJson,
} from "./http";

// The worker's `202 Accepted` ack for `POST /runs`: the job id plus the URLs to
// observe it (`components/worker/overview.md`). Only the id is needed here; the
// status/events URLs are reconstructed from it.
interface SubmitResponse {
  jobId: string;
  statusUrl?: string;
  eventsUrl?: string;
}

// The worker's `GET /runs/{job}` status (`components/worker/overview.md`):
// `state` is the job lifecycle (`running` | `succeeded` | `failed`), `record` is
// present once it succeeded, and `detail` carries the reason when it failed.
interface JobResponse {
  state: string;
  record?: RunRecord | null;
  detail?: string | null;
}

// The worker's `POST /push` ack. `PushResult` drops the echoed `runId`.
interface PushAck {
  runId: string;
  // Absent for an asset-generation run, which releases no code.
  sourceRepo?: string | null;
  playableBuild?: string | null;
  newlyPushed: boolean;
}

// The worker's `POST /publish` ack. `PublishResult` drops the echoed `runId`.
interface PublishAck {
  runId: string;
  newlyPublished: boolean;
}

// `GET /healthz` on a worker. Best-effort: used only to learn which backend the
// worker is bound to for the consistency check.
interface WorkerHealth {
  version?: string | null;
  backendId?: string | null;
  backendUrl?: string | null;
}

function mapState(status: string): RunJob["state"] {
  if (status === "completed" || status === "succeeded") return "completed";
  if (status === "failed" || status === "error") return "failed";
  return "running";
}

// A produced run's playable build is served by the worker itself, so the worker
// reports the link root-relative (`/runs/{id}/build/`). Resolve it against the
// worker's own base URL — the origin the browser actually reached it on — so the
// console can embed the build directly. A link that is already absolute (an
// already-published run the worker happens to hold) is left as-is.
function resolveBuildLink(record: RunRecord, baseUrl: string): RunRecord {
  const link = record.links.playableBuild;
  if (!link || !link.startsWith("/")) return record;
  return {
    ...record,
    links: { ...record.links, playableBuild: joinUrl(baseUrl, link) },
  };
}

export function createHttpWorker(baseUrl: string): WorkerClient {
  return {
    async identity(): Promise<WorkerIdentity> {
      // Probe the worker's /healthz; fall back to an unverified identity when it
      // can't be reached (e.g. a misconfigured or unreachable worker).
      try {
        const h = await getJson<WorkerHealth>(baseUrl, "/healthz");
        return {
          url: baseUrl,
          version: h.version ?? null,
          backendId: h.backendId ?? h.backendUrl ?? null,
        };
      } catch {
        return { url: baseUrl, version: null, backendId: null };
      }
    },

    async launchRun(config: LaunchConfig): Promise<string> {
      const body = {
        testCase: config.testCase,
        version: config.version,
        variant: config.variant,
        harness: config.harness,
        model: config.modelId,
        orchestrator: config.orchestrator,
        ...(config.maxRuntimeOverride != null
          ? { maxRuntimeSeconds: config.maxRuntimeOverride }
          : {}),
      };
      const res = await postJson<SubmitResponse>(baseUrl, "/runs", body);
      return res.jobId;
    },

    async getRun(runId: string): Promise<RunJob> {
      const r = await getJson<JobResponse>(
        baseUrl,
        `/runs/${encodeURIComponent(runId)}`,
      );
      return {
        runId,
        state: mapState(r.state),
        record: r.record ?? null,
        message: r.detail ?? null,
      };
    },

    subscribeToRun(runId: string, handlers: RunSubscription): () => void {
      const controller = new AbortController();
      void streamEvents(baseUrl, runId, handlers, controller);
      return () => controller.abort();
    },

    async listActiveRuns(): Promise<InProgressRun[]> {
      // The worker reports its still-running jobs by launch identity; the row
      // shape is the console's in-progress run verbatim.
      return getJson<InProgressRun[]>(baseUrl, "/runs/active");
    },

    subscribeToNotifications(handlers: NotificationSubscription): () => void {
      // An EventSource holds one long-lived SSE connection and reconnects on its
      // own if it drops — exactly what an always-on notifications channel wants.
      const source = new EventSource(joinUrl(baseUrl, "/notifications"));
      source.onmessage = (event) => {
        try {
          handlers.onNotification(JSON.parse(event.data) as RunNotification);
        } catch {
          // A malformed payload shouldn't tear down the channel; drop it.
        }
      };
      // EventSource surfaces a connection drop as an error and then retries; pass
      // it on for visibility but keep the connection open for the auto-reconnect.
      source.onerror = (event) => handlers.onError?.(event);
      return () => source.close();
    },

    async listRuns(): Promise<StoredRun[]> {
      // The worker lists the run records under its output directory as produced
      // (unpublished) runs — record plus a null review.
      const runs = await getJson<StoredRun[]>(baseUrl, "/runs");
      return runs.map((run) => ({
        ...run,
        record: resolveBuildLink(run.record, baseUrl),
      }));
    },

    async readRun(id: string): Promise<StoredRun> {
      const job = await getJson<JobResponse>(
        baseUrl,
        `/runs/${encodeURIComponent(id)}`,
      );
      if (!job.record) throw new Error(`Run ${id} has no record yet.`);
      // A worker job read carries only the record; reviews and publish state are
      // resolved through the gallery's stored-run listing instead.
      return {
        id,
        record: resolveBuildLink(job.record, baseUrl),
        reviews: [],
        published: false,
      };
    },

    async readRunEvents(
      id: string,
      onProgress?: ProgressCallback,
    ): Promise<RunEventStreams> {
      // The worker serves a finished run's recorded streams from disk as NDJSON,
      // keyed by run-record id. The raw log can be absent (older runs) — treat a
      // failed raw read as "no raw available" so the tab just hides the toggle,
      // while a failed events read is a real error worth surfacing. Progress
      // tracks the normalized stream — the payload the tab renders by default;
      // the raw log loads alongside it without its own progress.
      const enc = encodeURIComponent(id);
      const [events, raw] = await Promise.all([
        getNdjsonStreamed<HarnessEvent>(
          baseUrl,
          `/runs/${enc}/events.jsonl`,
          onProgress,
        ),
        getNdjson<RawOutputLine>(baseUrl, `/runs/${enc}/raw.jsonl`).catch(
          () => null,
        ),
      ]);
      return { events, raw };
    },

    // --- Accounts (the worker proxies the standalone auth service) ---

    async register(
      username: string,
      password: string,
      displayName: string,
    ): Promise<AuthResult> {
      return postJson<AuthResult>(baseUrl, "/auth/register", {
        username,
        password,
        displayName,
      });
    },

    async login(username: string, password: string): Promise<AuthResult> {
      return postJson<AuthResult>(baseUrl, "/auth/login", {
        username,
        password,
      });
    },

    // --- Run lifecycle: push -> review -> publish ---

    async push(id: string, token: string): Promise<PushResult> {
      // `POST /push` releases the run's source + build and stores the record
      // privately (no review, not yet published).
      const ack = await postJson<PushAck>(
        baseUrl,
        "/push",
        { runId: id },
        token,
      );
      return {
        sourceRepo: ack.sourceRepo ?? null,
        playableBuild: ack.playableBuild ?? null,
        newlyPushed: ack.newlyPushed,
      };
    },

    async submitReview(
      id: string,
      review: ReviewDocumentInput,
      token: string,
    ): Promise<void> {
      // `POST /review` attributes the review to the token's account; a run can
      // carry one review per account.
      await postJson<{ runId: string }>(
        baseUrl,
        "/review",
        {
          runId: id,
          ratings: review.ratings,
          writeup: review.writeup,
          checklist: review.checklist,
        },
        token,
      );
    },

    async publish(id: string, token: string): Promise<PublishResult> {
      // `POST /publish` is the gate — the backend refuses a run with zero reviews.
      const ack = await postJson<PublishAck>(
        baseUrl,
        "/publish",
        { runId: id },
        token,
      );
      return { newlyPublished: ack.newlyPublished };
    },
  };
}

// Reads the worker's NDJSON event stream, forwarding one normalized event per
// line, then resolves the run's outcome from its final job state.
async function streamEvents(
  baseUrl: string,
  runId: string,
  handlers: RunSubscription,
  controller: AbortController,
): Promise<void> {
  try {
    const res = await fetch(
      joinUrl(baseUrl, `/runs/${encodeURIComponent(runId)}/events`),
      { headers: { accept: "application/x-ndjson" }, signal: controller.signal },
    );
    if (!res.ok || !res.body) {
      throw new Error(`event stream failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) emit(line, handlers);
      }
    }
    const tail = buffer.trim();
    if (tail) emit(tail, handlers);

    // The stream closes when the run reaches a terminal state; read it back.
    const job = await getJson<JobResponse>(
      baseUrl,
      `/runs/${encodeURIComponent(runId)}`,
    );
    if (mapState(job.state) === "completed" && job.record) {
      handlers.onDone({ kind: "completed", record: job.record });
    } else {
      handlers.onDone({
        kind: "failed",
        message: job.detail ?? "Run did not complete.",
      });
    }
  } catch (e) {
    if (controller.signal.aborted) return;
    handlers.onError?.(e);
  }
}

function emit(line: string, handlers: RunSubscription): void {
  let parsed: { type?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    // A malformed line shouldn't tear down the stream; surface it as an
    // unclassified event carrying the raw text (the contract's `unknown` kind).
    handlers.onEvent({ timestamp: "", type: "unknown", raw: line });
    return;
  }
  // Live asset-generation frames share the event stream, tagged `asset_preview`;
  // every other line is a normalized harness event (whose `type` is one of the
  // closed set of event kinds, never `asset_preview`).
  if (parsed.type === "asset_preview") {
    handlers.onPreview?.(parsed as unknown as AssetPreview);
    return;
  }
  handlers.onEvent(parsed as HarnessEvent);
}
