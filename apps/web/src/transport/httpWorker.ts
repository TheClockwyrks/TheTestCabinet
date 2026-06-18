// The WorkerClient over HTTP, against a worker's REST API
// (components/worker/overview.md). A worker only executes runs and publishes
// them — it never serves the catalog. The review carried with a publish travels
// inline (the worker keeps no review store); the case-declared checklist items a
// reviewer works through are catalog data, read from the backend instead.
// Enumerating produced runs reads the worker's `GET /runs`, which lists the run
// records it has written to its output directory.
import type { WorkerClient, RunSubscription } from "@test-cabinet/ui/client";
import type {
  HarnessEvent,
  LaunchConfig,
  PublishResult,
  RawOutputLine,
  ReviewDocumentInput,
  RunEventStreams,
  RunJob,
  StoredRun,
  WorkerIdentity,
} from "@test-cabinet/ui/client";
import type { RunRecord } from "@test-cabinet/run-record";
import { getJson, getNdjson, joinUrl, postJson } from "./http";

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

// The worker's `POST /publish` ack. `PublishResult` drops the echoed `runId`.
interface PublishAck {
  runId: string;
  sourceRepo: string;
  playableBuild?: string | null;
  newlyPublished: boolean;
}

// `GET /healthz` on a worker, if it offers one. Best-effort: used only to learn
// which backend the worker is bound to for the consistency check.
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
      // The worker has no defined info endpoint yet; probe /healthz and fall back
      // to an unverified identity when it isn't there.
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
      return { id, record: resolveBuildLink(job.record, baseUrl), review: null };
    },

    async readRunEvents(id: string): Promise<RunEventStreams> {
      // The worker serves a finished run's recorded streams from disk as NDJSON,
      // keyed by run-record id. The raw log can be absent (older runs) — treat a
      // failed raw read as "no raw available" so the tab just hides the toggle,
      // while a failed events read is a real error worth surfacing.
      const enc = encodeURIComponent(id);
      const [events, raw] = await Promise.all([
        getNdjson<HarnessEvent>(baseUrl, `/runs/${enc}/events.jsonl`),
        getNdjson<RawOutputLine>(baseUrl, `/runs/${enc}/raw.jsonl`).catch(
          () => null,
        ),
      ]);
      return { events, raw };
    },

    async publish(
      id: string,
      review: ReviewDocumentInput,
    ): Promise<PublishResult> {
      // The worker holds no review store, so `POST /publish` carries the review
      // inline alongside the run id (`components/worker/overview.md`).
      const ack = await postJson<PublishAck>(baseUrl, "/publish", {
        runId: id,
        rating: review.rating,
        writeup: review.writeup,
        checklist: review.checklist,
      });
      return {
        sourceRepo: ack.sourceRepo,
        playableBuild: ack.playableBuild ?? null,
        newlyPublished: ack.newlyPublished,
      };
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
  try {
    handlers.onEvent(JSON.parse(line) as HarnessEvent);
  } catch {
    // A malformed line shouldn't tear down the stream; surface it as a raw event.
    handlers.onEvent({
      timestamp: "",
      type: "raw",
      raw: line,
    } as HarnessEvent);
  }
}
