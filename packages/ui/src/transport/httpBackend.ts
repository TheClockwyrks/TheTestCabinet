// The HTTP transport for the web console, against the backend's REST API
// (components/backend/api.md). The backend is the single URL the console talks
// to: it serves the catalog, definitions, and published results (the
// `BackendClient` below), and — since the per-run-Job refactor — it is also the
// control plane for *executing* runs (the `WorkerClient` built by
// `createBackendExec`). A console enqueues a run on the backend's `/jobs` queue;
// a dispatcher claims it and a per-run driver pod streams the run's progress and
// pushes the produced record back through the backend. There is no separate
// worker the console registers or talks to anymore.
import type {
  BackendClient,
  BatchLaunchResult,
  WorkerClient,
  RunSubscription,
  NotificationSubscription,
} from "../client";
import type {
  AssetKind,
  AssetPreview,
  AuthResult,
  BackendIdentity,
  Domain,
  Erratum,
  HarnessConfigEntry,
  HarnessEvent,
  InProgressRun,
  LaunchConfig,
  LogoFetchResult,
  Model,
  ModelInput,
  ModelSeed,
  MyReviewsPage,
  ProgressCallback,
  PublishProgress,
  PublishResult,
  ReviewDocumentInput,
  ReviewItem,
  ReviewStats,
  RunEventStreams,
  RunJob,
  RunNotification,
  RunPage,
  RunSummaryPage,
  Specification,
  SpecDocument,
  SpecRole,
  StoredReview,
  StoredRun,
  TestCase,
  TestType,
  VersionInfo,
  WorkerIdentity,
} from "../client";
import type {
  AssetSheet,
  ModelSpec,
  RunRecord,
} from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type {
  CoverageGroup,
  CoverageGroupInput,
  CoverageMatrix,
  CoveragePlan,
  CoveragePlanInput,
  CoveragePlanSummary,
} from "@test-cabinet/run-record/coverage";
import {
  delJson,
  delVoid,
  getJson,
  getJsonStreamed,
  getText,
  joinUrl,
  postJson,
  putBytes,
  putJson,
} from "./http";
import {
  applyScoreExclusions,
  excludedVerdictIds,
  mergeReviewItems,
} from "../ratings";

// `GET /healthz` — the shape the backend reports.
interface HealthzResponse {
  status?: string;
  version?: string | null;
  storeReady?: boolean;
  // An optional stable backend instance id, used for the worker-consistency
  // check when present.
  id?: string | null;
}

// `GET /test-cases` — the catalog, wrapped in `{ testCases }`.
interface CatalogResponse {
  testCases: CatalogEntry[];
}

// One entry of `GET /test-cases`.
interface CatalogEntry {
  slug: string;
  versions: string[];
}

// `GET /test-cases/{slug}/versions` — the versions for one case, wrapped in
// `{ slug, versions }`.
interface VersionsResponse {
  slug: string;
  versions: string[];
}

// A spec descriptor in a resolved version (its store-relative `source` key and
// seeded `dest` path).
interface SpecDescriptor {
  source: string;
  dest: string;
  template?: boolean;
  // The seeded file's role (`spec`/`script`), so the Inputs tab can tag it. Absent
  // on a backend that predates the field; treated as "spec".
  kind?: SpecRole;
}

// A runtime package the case ships into its runs, as the version endpoint reports
// it: its npm name and the UI-only description of what it provides.
interface PackageDescriptor {
  name: string;
  description: string;
}

// A reference in a resolved version: the view it depicts, how it is produced
// (rendered mockup, static image, or static video), and the backend-relative URL
// its media is served at.
interface ReferenceDescriptor {
  view: string;
  kind: "rendered" | "image" | "video";
  mediaUrl: string;
}

// The subset of `GET /test-cases/{slug}/versions/{version}` we consume.
interface ResolvedVersion {
  slug: string;
  version: string;
  name: string;
  difficulty: string;
  tags: string[];
  summary: string | null;
  description: string | null;
  // This version's changelog entry (its `changelog.md` body); required.
  changelog: string;
  maxRuntimeSeconds: number;
  testType: TestType;
  // The asset shape an asset-generation case produces (camelCase `AssetKind`),
  // carried through verbatim so the catalog can split Sprite vs Voxel tabs.
  assetKind?: AssetKind | null;
  commonSpecs?: SpecDescriptor[];
  // The runtime packages this case ships into every run (case-level), each with a
  // UI-only description. Absent on a backend that predates the field.
  packages?: PackageDescriptor[];
  commonReviewItems?: ReviewItem[];
  // References every variant shares (rendered from the `_common` scope).
  commonReferences?: ReferenceDescriptor[];
  // The case's COMMON scoring domains (every variant is rated on these; a variant
  // may add its own — carried on each variant's `domains`).
  domains?: Domain[];
  // The sprite-sheet frame grid and named sequences (camelCase `SheetSpec`),
  // present only for a sprite-sheet case. Its shape matches the run-record
  // `AssetSheet`, so it is carried through verbatim.
  sheet?: AssetSheet | null;
  // The rig (parts + joints) a voxel-animation case declares (camelCase
  // `ModelSpec`), present only for a voxel-animation case. Carried through
  // verbatim, the 3D analog of `sheet`.
  model?: ModelSpec | null;
  // Known-issue errata recorded for this version. Absent on a backend that
  // predates the field.
  errata?: Erratum[];
  variants: {
    slug: string;
    name: string;
    description: string | null;
    // The variant's prompt, rendered by the backend as a real run receives it.
    prompt: string;
    specs?: SpecDescriptor[];
    reviewItems?: ReviewItem[];
    references?: ReferenceDescriptor[];
    // The variant's own additive scoring domains (rated only when this variant is
    // selected, on top of the case's common ones).
    domains?: Domain[];
    // The absolute URL of this variant's reference implementation, recorded in the
    // backend's `case_reference_build` table. Null when the variant declares none;
    // absent on a backend that predates the field.
    referenceBuild?: string | null;
  }[];
}

// One review entry of `GET /runs/{id}` — the reviewer's verdict plus attribution
// (id, display name, and login username).
interface ReviewResponse {
  reviewerId: string;
  reviewer: string;
  username?: string | null;
  ratings: StoredReview["ratings"];
  writeup: string;
  checklist: StoredReview["checklist"];
  reviewedAt?: string | null;
  editedAt?: string | null;
  revisions?: StoredReview["revisions"];
}

// `GET /runs/{id}` (and each entry of `GET /runs`): a stored run — its full
// record (links populated), every review submitted against it, whether it is
// published, and the resolved links.
interface StoredRunResponse {
  record: RunRecord;
  reviews?: ReviewResponse[] | null;
  published?: boolean;
  links?: { sourceRepo: string | null; playableBuild: string | null };
}

// `GET /runs`: a page of stored runs plus the cursor for the next page. The
// backend names the cursor `nextBefore` (the `before` value for the next page);
// it maps to the transport-neutral `nextCursor` on `RunPage`.
interface RunPageResponse {
  runs: StoredRunResponse[];
  nextBefore?: string | null;
}

// `GET /runs?fields=summary`: a page of bounded run summary cards plus the same
// `nextBefore` cursor as `RunPageResponse`. The cards are the backend's
// `RunSummary` contract shape verbatim (camelCase), so they pass through
// unmapped; only the cursor is renamed to the transport-neutral `nextCursor`.
// `total` is present only on the numbered-pager (offset) path — the count of all
// matching rows ignoring the page window; the cursor path omits it.
interface RunSummaryPageResponse {
  runs: RunSummary[];
  nextBefore?: string | null;
  total?: number | null;
}

// Map one wire review (`ReviewResponse`) to the transport-neutral `StoredReview`.
// The reviewer avatar URL is attached separately (it needs the auth service base
// URL, which only the exec transport holds); left absent here.
function toStoredReview(rv: ReviewResponse): StoredReview {
  return {
    reviewerId: rv.reviewerId,
    reviewer: rv.reviewer,
    username: rv.username ?? null,
    ratings: rv.ratings,
    writeup: rv.writeup,
    checklist: rv.checklist,
    reviewedAt: rv.reviewedAt ?? null,
    editedAt: rv.editedAt ?? null,
    revisions: rv.revisions ?? [],
  };
}

// The backend serves the record with its links already populated, so the run's
// id and links are taken from the record itself. Every review is carried through
// with its attribution; a backend-served run is always a published one.
function toStoredRun(r: StoredRunResponse): StoredRun {
  const record = r.links
    ? { ...r.record, links: { ...r.record.links, ...r.links } }
    : r.record;
  const reviews: StoredReview[] = (r.reviews ?? []).map(toStoredReview);
  return { id: record.id, record, reviews, published: r.published ?? true };
}

// Resolve an account/reviewer id to its profile-picture URL on the auth service
// (`GET /auth/users/{id}/picture`). `version` (the account's `pictureUpdatedAt`)
// cache-busts a replaced picture; omitted for a reviewer whose version is unknown,
// in which case the avatar simply relies on the endpoint's short cache.
function pictureUrlFor(
  authUrl: string,
  id: string,
  version?: string | null,
): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  return joinUrl(
    authUrl,
    `/auth/users/${encodeURIComponent(id)}/picture${query}`,
  );
}

// Attach the transport-resolved `pictureUrl` to an account: a ready-to-use avatar
// URL when the account has a picture (`pictureUpdatedAt` set), else null. Every
// consumer (top bar, profile) then reads one field rather than re-deriving the URL.
function accountWithPicture(
  authUrl: string,
  account: AuthResult["account"],
): AuthResult["account"] {
  return {
    ...account,
    pictureUrl: account.pictureUpdatedAt
      ? pictureUrlFor(authUrl, account.id, account.pictureUpdatedAt)
      : null,
  };
}

// Attach a reviewer's avatar URL to a review for display. Emitted unconditionally
// (the wire review carries no "has picture" flag): a reviewer with no picture
// simply 404s and the avatar falls back to their initials.
function reviewWithPicture(
  authUrl: string,
  review: StoredReview,
): StoredReview {
  return {
    ...review,
    reviewerPictureUrl: pictureUrlFor(authUrl, review.reviewerId),
  };
}

// One `GET /account/reviews` entry (`MyReviewOut`) and the page envelope.
interface MyReviewResponse {
  run: RunSummary;
  review: ReviewResponse;
}
interface MyReviewsResponseBody {
  reviews: MyReviewResponse[];
  total: number;
}

export function createHttpBackend(baseUrl: string): BackendClient {
  return {
    async identity(): Promise<BackendIdentity> {
      const h = await getJson<HealthzResponse>(baseUrl, "/healthz");
      return {
        id: h.id ?? normalizeUrl(baseUrl),
        url: baseUrl,
        version: h.version ?? null,
        storeReady: Boolean(h.storeReady),
      };
    },

    async listTestCases(): Promise<TestCase[]> {
      const { testCases } = await getJson<CatalogResponse>(
        baseUrl,
        "/test-cases",
      );
      return testCases.map((e) => ({ slug: e.slug, versions: e.versions }));
    },

    async listVersions(slug: string): Promise<string[]> {
      const { versions } = await getJson<VersionsResponse>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions`,
      );
      return versions;
    },

    async resolveVersion(slug: string, version: string): Promise<VersionInfo> {
      const r = await getJson<ResolvedVersion>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
      );
      return {
        slug: r.slug,
        version: r.version,
        name: r.name,
        difficulty: r.difficulty,
        tags: r.tags,
        summary: r.summary,
        description: r.description,
        changelog: r.changelog,
        maxRuntimeSeconds: r.maxRuntimeSeconds,
        testType: r.testType,
        assetKind: r.assetKind ?? null,
        // Case-level runtime packages (shared by every variant), each with a
        // UI-only description. Absent on a backend that predates the field.
        packages: r.packages ?? [],
        domains: r.domains ?? [],
        sheet: r.sheet ?? null,
        model: r.model ?? null,
        // Known-issue errata for this version; empty on a backend that predates it.
        errata: r.errata ?? [],
        variants: r.variants.map((v) => ({
          slug: v.slug,
          name: v.name,
          description: v.description,
          // The backend renders the prompt as a real run receives it.
          prompt: v.prompt,
          // The common references apply to every variant; the variant's own
          // references follow. The backend serves them as backend-relative URLs,
          // so resolve each to an absolute URL the gallery can load directly (the
          // console and the backend are not necessarily the same origin).
          references: [
            ...(r.commonReferences ?? []),
            ...(v.references ?? []),
          ].map((ref) => ({
            view: ref.view,
            kind: ref.kind === "video" ? "video" : "image",
            url: joinUrl(baseUrl, ref.mediaUrl),
          })),
          // The common checklist items apply to every variant; the variant's own
          // follow, merged by id so a variant that reuses a common category's id
          // extends that category rather than forming a duplicate group. They
          // carry the point weights used to score runs. Points the version's errata
          // exclude from scoring (`excludeFromScore`) are marked non-scoring here so
          // every consumer scores this effective list uniformly (mirrors the Rust
          // `review_items_for`).
          reviewItems: applyScoreExclusions(
            mergeReviewItems(r.commonReviewItems ?? [], v.reviewItems ?? []),
            excludedVerdictIds(r.errata ?? [], v.slug),
          ),
          // The common scoring domains apply to every variant; the variant's own
          // additive domains follow. This effective set is what a run of this
          // variant is rated against.
          domains: [...(r.domains ?? []), ...(v.domains ?? [])],
          // The variant's reference-implementation build URL, carried through
          // verbatim (already an absolute Cloudflare Pages URL — the backend
          // records exactly what `tcab publish-reference` deployed). Null when the
          // variant declares none.
          referenceBuild: v.referenceBuild ?? null,
        })),
      };
    },

    async readSpecs(
      slug: string,
      version: string,
      variant: string,
    ): Promise<Specification> {
      // The backend serves spec bodies as artifacts by key, not as one bundle,
      // so resolve the version and fetch each seeded spec for the variant.
      const r = await getJson<ResolvedVersion>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
      );
      const chosen = r.variants.find((v) => v.slug === variant);
      const descriptors = [...(r.commonSpecs ?? []), ...(chosen?.specs ?? [])];
      const specs: SpecDocument[] = await Promise.all(
        descriptors.map(async (d) => ({
          dest: d.dest,
          body: await getText(
            baseUrl,
            `/test-cases/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/artifacts/${d.source}`,
          ),
          kind: (d.kind ?? "spec") as SpecRole,
        })),
      );
      return {
        slug: r.slug,
        version: r.version,
        variant,
        description: r.description,
        specs,
      };
    },

    async readReviewItems(
      slug: string,
      version: string,
      variant: string,
    ): Promise<ReviewItem[]> {
      // The checklist items are declared in the version manifest: the common
      // items every variant shares, plus the selected variant's own additions.
      const r = await getJson<ResolvedVersion>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
      );
      const chosen = r.variants.find((v) => v.slug === variant);
      return applyScoreExclusions(
        mergeReviewItems(r.commonReviewItems ?? [], chosen?.reviewItems ?? []),
        excludedVerdictIds(r.errata ?? [], variant),
      );
    },

    async listModels(): Promise<Model[]> {
      // The merged model catalog: curated configs ⋃ models derived from recorded
      // runs, each with its observed price history.
      const body = await getJson<{ models: Model[] }>(baseUrl, "/models");
      return body.models;
    },

    async createModel(input: ModelInput, token: string): Promise<Model> {
      return postJson<Model>(baseUrl, "/models", input, token);
    },

    async updateModel(
      slug: string,
      input: ModelInput,
      token: string,
    ): Promise<Model> {
      return putJson<Model>(
        baseUrl,
        `/models/${encodeURIComponent(slug)}`,
        input,
        token,
      );
    },

    async deleteModel(slug: string, token: string): Promise<void> {
      await delVoid(baseUrl, `/models/${encodeURIComponent(slug)}`, token);
    },

    async fetchModelLogo(url: string, token: string): Promise<LogoFetchResult> {
      return postJson<LogoFetchResult>(baseUrl, "/models/logo", { url }, token);
    },

    async listHarnessConfigs(): Promise<HarnessConfigEntry[]> {
      return getJson<HarnessConfigEntry[]>(baseUrl, "/harness-config");
    },

    async setHarnessMaxParallelism(
      slug: string,
      maxParallelism: number | null,
      token: string,
    ): Promise<HarnessConfigEntry[]> {
      return postJson<HarnessConfigEntry[]>(
        baseUrl,
        `/harness-config/${encodeURIComponent(slug)}`,
        { maxParallelism },
        token,
      );
    },

    async seedModelFromRun(runId: string): Promise<ModelSeed> {
      return getJson<ModelSeed>(
        baseUrl,
        `/models/seed?runId=${encodeURIComponent(runId)}`,
      );
    },

    async listCoverageGroups(token: string): Promise<CoverageGroup[]> {
      return getJson<CoverageGroup[]>(baseUrl, "/coverage-groups", token);
    },

    async createCoverageGroup(
      input: CoverageGroupInput,
      token: string,
    ): Promise<CoverageGroup> {
      return postJson<CoverageGroup>(baseUrl, "/coverage-groups", input, token);
    },

    async updateCoverageGroup(
      id: string,
      input: CoverageGroupInput,
      token: string,
    ): Promise<CoverageGroup> {
      return putJson<CoverageGroup>(
        baseUrl,
        `/coverage-groups/${encodeURIComponent(id)}`,
        input,
        token,
      );
    },

    async deleteCoverageGroup(id: string, token: string): Promise<void> {
      await delVoid(
        baseUrl,
        `/coverage-groups/${encodeURIComponent(id)}`,
        token,
      );
    },

    async listCoveragePlans(token: string): Promise<CoveragePlan[]> {
      return getJson<CoveragePlan[]>(baseUrl, "/coverage-plans", token);
    },

    async createCoveragePlan(
      input: CoveragePlanInput,
      token: string,
    ): Promise<CoveragePlan> {
      return postJson<CoveragePlan>(baseUrl, "/coverage-plans", input, token);
    },

    async updateCoveragePlan(
      id: string,
      input: CoveragePlanInput,
      token: string,
    ): Promise<CoveragePlan> {
      return putJson<CoveragePlan>(
        baseUrl,
        `/coverage-plans/${encodeURIComponent(id)}`,
        input,
        token,
      );
    },

    async deleteCoveragePlan(id: string, token: string): Promise<void> {
      await delVoid(
        baseUrl,
        `/coverage-plans/${encodeURIComponent(id)}`,
        token,
      );
    },

    async getCoveragePlansSummary(
      token: string,
    ): Promise<CoveragePlanSummary[]> {
      return getJson<CoveragePlanSummary[]>(
        baseUrl,
        "/coverage-plans/summary",
        token,
      );
    },

    async getCoveragePlanCoverage(
      id: string,
      token: string,
    ): Promise<CoverageMatrix> {
      return getJson<CoverageMatrix>(
        baseUrl,
        `/coverage-plans/${encodeURIComponent(id)}/coverage`,
        token,
      );
    },

    async listMyReviews(
      opts: { limit?: number; offset?: number } | undefined,
      token: string,
    ): Promise<MyReviewsPage> {
      // `GET /account/reviews` — the signed-in account's own reviews, newest-first,
      // with a numbered pager (limit + offset) and the total count. Each row is a
      // reviewed run's summary card plus this account's review of it.
      const params = new URLSearchParams();
      if (opts?.limit != null) params.set("limit", String(opts.limit));
      if (opts?.offset != null) params.set("offset", String(opts.offset));
      const query = params.toString();
      const body = await getJson<MyReviewsResponseBody>(
        baseUrl,
        `/account/reviews${query ? `?${query}` : ""}`,
        token,
      );
      return {
        reviews: body.reviews.map((entry) => ({
          run: entry.run,
          review: toStoredReview(entry.review),
        })),
        total: body.total,
      };
    },

    async getReviewStats(token: string): Promise<ReviewStats> {
      // `GET /account/review-stats` — the signed-in account's recent-review
      // breakdowns. The wire shape matches `ReviewStats` field-for-field (camelCase),
      // so it needs no mapping.
      return getJson<ReviewStats>(baseUrl, "/account/review-stats", token);
    },

    async listRuns(opts): Promise<RunPage> {
      const params = new URLSearchParams();
      if (opts?.before) params.set("before", opts.before);
      if (opts?.limit != null) params.set("limit", String(opts.limit));
      const query = params.toString();
      const body = await getJson<RunPageResponse>(
        baseUrl,
        `/runs${query ? `?${query}` : ""}`,
      );
      return {
        runs: body.runs.map(toStoredRun),
        nextCursor: body.nextBefore ?? null,
      };
    },

    async listRunSummaries(opts): Promise<RunSummaryPage> {
      // Always the summary projection. Every provided param is forwarded (omitting
      // the undefined ones); an `offset` (even 0) selects the backend's
      // numbered-pager path, which is the only one that returns `total`.
      const params = new URLSearchParams({ fields: "summary" });
      if (opts?.before) params.set("before", opts.before);
      if (opts?.limit != null) params.set("limit", String(opts.limit));
      if (opts?.offset != null) params.set("offset", String(opts.offset));
      if (opts?.state) params.set("state", opts.state);
      if (opts?.testCase) params.set("testCase", opts.testCase);
      if (opts?.model) params.set("model", opts.model);
      if (opts?.harness) params.set("harness", opts.harness);
      if (opts?.q) params.set("q", opts.q);
      if (opts?.sort) params.set("sort", opts.sort);
      if (opts?.dir) params.set("dir", opts.dir);
      const body = await getJson<RunSummaryPageResponse>(
        baseUrl,
        `/runs?${params.toString()}`,
      );
      return {
        summaries: body.runs,
        nextCursor: body.nextBefore ?? null,
        total: body.total ?? null,
      };
    },

    async readRun(id: string): Promise<StoredRun> {
      const body = await getJson<StoredRunResponse>(
        baseUrl,
        `/runs/${encodeURIComponent(id)}`,
      );
      return toStoredRun(body);
    },

    async readRunEvents(
      id: string,
      onProgress?: ProgressCallback,
    ): Promise<RunEventStreams> {
      // The backend serves the published run's normalized event stream as a JSON
      // array (empty when the run recorded none). It can be large, so stream it
      // with transfer progress. Raw harness output is never published, so it is
      // unavailable here.
      const events = await getJsonStreamed<HarnessEvent[]>(
        baseUrl,
        `/runs/${encodeURIComponent(id)}/events`,
        onProgress,
      );
      return { events, raw: null };
    },
  };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

// One page of a backend run worklist filtered by `state` (`GET /runs?state=…`).
// Shape-identical to the default `GET /runs`, so every filter reuses the same row
// mapping and `nextBefore` cursor; only the `state` value differs.
async function listRunsPage(
  baseUrl: string,
  state: string,
  opts: { before?: string },
): Promise<RunPage> {
  const params = new URLSearchParams({ state });
  if (opts.before) params.set("before", opts.before);
  const body = await getJson<RunPageResponse>(
    baseUrl,
    `/runs?${params.toString()}`,
  );
  return {
    runs: body.runs.map(toStoredRun),
    nextCursor: body.nextBefore ?? null,
  };
}

// Walk every page of a `state`-filtered run worklist, resolving each run's
// pre-publish build link for inline playback as it goes.
async function listAllRuns(
  baseUrl: string,
  state: string,
  resolveBuild: (run: StoredRun) => Promise<StoredRun>,
): Promise<StoredRun[]> {
  const acc: StoredRun[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await listRunsPage(baseUrl, state, { before });
    for (const run of page.runs) acc.push(await resolveBuild(run));
    if (!page.nextCursor || page.runs.length === 0) break;
    before = page.nextCursor;
  }
  return acc;
}

// --- Run execution (the backend's `/jobs` control plane) --------------------

// The backend's `GET /config` body (mirrors `ClientConfig`). `artifactsUrl` is
// the artifact service's public base URL — non-null when a pre-publish run's
// build and media are served separately from the control-plane backend — or null
// when artifacts are not served separately (a single-box dev setup).
interface ClientConfigResponse {
  artifactsUrl?: string | null;
  // The arena service's public base URL — non-null when adversarial matches and
  // tournaments are executed separately from the control-plane backend — or null
  // when adversarial execution is not served (a single-box dev setup).
  arenaUrl?: string | null;
  // Grafana's base URL — non-null when the deployment runs the observability
  // stack — or null when it does not (local/desktop, or any overlay without the
  // observability component). Used to link a run to the traces it emitted.
  grafanaUrl?: string | null;
}

// The backend's `POST /jobs` ack (`LaunchAck`): the enqueued job id plus the URLs
// to observe it. Only the id is needed here; the status/live URLs are
// reconstructed from it.
interface LaunchAckResponse {
  jobId: string;
  statusUrl?: string;
  liveUrl?: string;
}

// The backend's `POST /jobs/batch` ack (`LaunchBatchAck`): one result per
// submitted run, aligned by index — the enqueued job id, or the reason it was
// rejected.
interface LaunchBatchAckResponse {
  jobs: { jobId?: string; error?: string }[];
}

// The backend's `LaunchBody` (camelCase) for one run. Shared by the single
// (`POST /jobs`) and batch (`POST /jobs/batch`) enqueue paths so the two never
// drift on how a `LaunchConfig` is put on the wire.
function launchBodyOf(config: LaunchConfig) {
  return {
    testCase: config.testCase,
    version: config.version,
    variant: config.variant,
    harness: config.harness,
    model: config.modelId,
    orchestrator: config.orchestrator,
    ...(config.maxRuntimeOverride != null
      ? { maxRuntimeSeconds: config.maxRuntimeOverride }
      : {}),
    ...(config.retryCount != null ? { retryCount: config.retryCount } : {}),
  };
}

// The backend's `GET /jobs/{id}` status (`JobStatusOut`): the job's lifecycle
// state, the produced run record's id once it succeeded, and the reason on
// failure. Unlike the old worker status, this carries the record *id* (the
// record itself is read back from `GET /runs/{id}`), since the driver pushes the
// record to the backend's run store directly.
interface JobStatusResponse {
  state: string;
  recordId?: string | null;
  detail?: string | null;
}

// The auth service's register/login result (`AuthnResponse`). The console reaches
// the standalone auth service directly now — the worker that used to proxy it is
// gone.
interface AuthResultResponse {
  token: string;
  account: AuthResult["account"];
}

// Map a backend job state (`JobStatusOut.state`) to the console's coarse run
// outcome. A `succeeded` job produced a record (its own `status.state` may still
// be a failure); anything terminal-but-not-succeeded is a failure for the
// console's purposes.
function mapJobState(state: string): RunJob["state"] {
  if (state === "succeeded") return "completed";
  if (state === "failed" || state === "canceled") return "failed";
  return "running";
}

// Map a backend job state to the console's coarser in-progress *phase* for the
// active-run list. `dispatched` (claimed, the driver pod being created) and
// `starting` (the pod up, running pre-run setup) both read as "starting"; a
// harness-capped hold reads as "pending", a free-but-unclaimed job as "queued".
// A terminal job never appears in the active list, so it falls back to "running".
function mapActiveState(state: string): InProgressRun["state"] {
  switch (state) {
    case "queued":
      return "queued";
    case "pending":
      return "pending";
    case "dispatched":
    case "starting":
      return "starting";
    case "running":
      return "running";
    default:
      return "running";
  }
}

// The artifact service's base URL as the execution client consumes it. It is
// fetched (`GET /config`), so a host that hands over only the value it happens to
// hold at construction time forces every consumer to cope with "not known yet" —
// which the synchronous, re-rendered media resolvers do fine but the record's
// build link cannot (see `resolveBuild`). Supplying both forms lets each consumer
// take the one it can actually use.
export interface ArtifactsUrlSource {
  /** The resolved URL if the config fetch has landed, else null. */
  current: string | null;
  /** Resolves to the URL (or null) once the config fetch has settled. */
  settled: Promise<string | null>;
}

// Resolve the artifact service's base URL from the backend's `GET /config`, or
// null when artifacts are not served separately. Best-effort: a backend that
// can't be reached resolves null, so pre-publish build/media links are simply
// left unresolved (the same behavior as before the artifact service existed).
export async function fetchArtifactsUrl(
  backendUrl: string,
): Promise<string | null> {
  try {
    const config = await getJson<ClientConfigResponse>(backendUrl, "/config");
    return config.artifactsUrl ?? null;
  } catch {
    return null;
  }
}

// Resolve the arena service's base URL from the backend's `GET /config`, or null
// when adversarial execution is not served separately. Best-effort: a backend that
// can't be reached resolves null, so the adversarial run UI simply degrades (the
// same behavior as before the arena service existed).
export async function fetchArenaUrl(
  backendUrl: string,
): Promise<string | null> {
  try {
    const config = await getJson<ClientConfigResponse>(backendUrl, "/config");
    return config.arenaUrl ?? null;
  } catch {
    return null;
  }
}

// Resolve Grafana's base URL from the backend's `GET /config`, or null when the
// deployment runs no observability stack. Best-effort: a backend that can't be
// reached resolves null, which reads the same as "no Grafana" — the run's link to
// its traces is simply not offered, which is the correct degradation for a
// convenience link.
export async function fetchGrafanaUrl(
  backendUrl: string,
): Promise<string | null> {
  try {
    const config = await getJson<ClientConfigResponse>(backendUrl, "/config");
    return config.grafanaUrl ?? null;
  } catch {
    return null;
  }
}

// The web console's run-execution client: the `WorkerClient` interface the shared
// UI drives, implemented against the backend's `/jobs` control plane (launch /
// live stream / active list / completion feed), the backend's run-lifecycle
// endpoints (review, publish), and the standalone auth service (register/login).
//
// `backendUrl` is the single backend the console talks to; `authUrl` is the auth
// service it registers/logs in against; `artifacts` is the artifact service's base
// URL used to resolve a pre-publish run's build and media links.
// The driver pushes a finished run's record to the backend itself, so there is no
// `POST /push` here — `push` is a no-op that echoes the run's already-resolved
// links.
export function createBackendExec(
  backendUrl: string,
  authUrl: string,
  artifacts: ArtifactsUrlSource | string | null,
): WorkerClient {
  const backend = createHttpBackend(backendUrl);
  // The artifact service's base URL is itself fetched (`GET /config`), so it has
  // two forms here and they are not interchangeable. `artifactsNow` is the
  // best-known value *this instant*, for the synchronous media resolvers below —
  // they are called during render, so a null early on is corrected when the host
  // re-renders with the resolved URL. `artifactsSettled` resolves once the config
  // fetch has actually finished, for the link resolution that snapshots a URL into
  // a fetched record — that one must await, because nothing re-renders it later.
  const artifactsNow =
    typeof artifacts === "string" || artifacts === null
      ? artifacts
      : artifacts.current;
  const artifactsSettled =
    typeof artifacts === "string" || artifacts === null
      ? Promise.resolve(artifacts)
      : artifacts.settled;

  // Prefix the artifact service's base URL to a root-relative media path. When no
  // artifact service is configured the path is left unresolved (null), matching
  // the unpublished-run behavior before artifacts were served separately.
  const mediaUrl = (
    runId: string,
    kind: string,
    file: string,
  ): string | null => {
    if (!artifactsNow) return null;
    const path = `/runs/${encodeURIComponent(runId)}/${kind}/${encodeURIComponent(file)}`;
    return joinUrl(artifactsNow, path);
  };

  // Resolve a run's root-relative playable-build link (`/runs/{id}/build/`)
  // against the artifact service, which serves a pre-publish run's build (the
  // control-plane backend is not in the artifact path). A link that is already
  // absolute (a published run whose build the snapshot pipeline placed) is left
  // as-is; with no artifact service configured a root-relative link is left
  // unresolved, exactly as today's unpublished-run behavior.
  //
  // This **awaits** the artifact URL rather than reading whatever is known now.
  // The resolved link is snapshotted into the returned record, and the run-detail
  // chrome fetches that record exactly once per run id, so a link left unresolved
  // because the config fetch had not landed yet is never corrected — the Play tab
  // then loads `/runs/{id}/build/` against the console's own origin, which serves
  // the SPA shell instead of the build. That is only observable on a cold
  // deep-link to /runs/:id/play (opened in a new tab, reloaded, or duplicated),
  // where the record fetch races the config fetch; arriving via another tab gives
  // the config time to land, which is why switching to Verdict and back "fixed"
  // it. Awaiting removes the race outright.
  const resolveBuild = async (run: StoredRun): Promise<StoredRun> => {
    const link = run.record.links.playableBuild;
    if (!link || !link.startsWith("/")) return run;
    const artifactsUrl = await artifactsSettled;
    if (!artifactsUrl) return run;
    return {
      ...run,
      record: {
        ...run.record,
        links: {
          ...run.record.links,
          playableBuild: joinUrl(artifactsUrl, link),
        },
      },
    };
  };

  return {
    async identity(): Promise<WorkerIdentity> {
      // There is no separate worker to identify; the console talks to one backend
      // URL. Report it as the execution identity, with the backend it is itself
      // pointed at (always a match — they are the same service).
      return { url: backendUrl, version: null, backendId: backendUrl };
    },

    async launchRun(
      config: LaunchConfig,
      token?: string | null,
    ): Promise<string> {
      // Enqueue a run on the backend's job queue; the dispatcher creates the
      // driver Job. The body is the backend's `LaunchBody` (camelCase). The
      // backend gates `POST /jobs` on the launching account, so the signed-in
      // account's token rides along as `Authorization: Bearer` — without it the
      // enqueue is rejected `401`.
      const ack = await postJson<LaunchAckResponse>(
        backendUrl,
        "/jobs",
        launchBodyOf(config),
        token,
      );
      return ack.jobId;
    },

    async launchRunBatch(
      configs: LaunchConfig[],
      token?: string | null,
    ): Promise<BatchLaunchResult[]> {
      // Enqueue the whole set in one `POST /jobs/batch` (same account gate as
      // `POST /jobs`) instead of a request per run — the fan-out a coverage
      // "trigger all missing" or a multi-combination new-run submit produces. An
      // empty set needs no round-trip. The ack returns one entry per run, aligned
      // by index, each an enqueued job id or a per-run rejection reason.
      if (configs.length === 0) return [];
      const ack = await postJson<LaunchBatchAckResponse>(
        backendUrl,
        "/jobs/batch",
        { runs: configs.map(launchBodyOf) },
        token,
      );
      return ack.jobs.map((entry) => ({
        runId: entry.jobId,
        error: entry.error,
      }));
    },

    async getRun(runId: string): Promise<RunJob> {
      // The job status carries the record *id*, not the record; read the record
      // back from the run store when the job succeeded so the caller still gets a
      // populated `RunJob`.
      const status = await getJson<JobStatusResponse>(
        backendUrl,
        `/jobs/${encodeURIComponent(runId)}`,
      );
      const state = mapJobState(status.state);
      let record: RunRecord | null = null;
      if (state === "completed" && status.recordId) {
        record = (await resolveBuild(await backend.readRun(status.recordId)))
          .record;
      }
      return {
        runId,
        state,
        record,
        message: status.detail ?? null,
      };
    },

    subscribeToRun(runId: string, handlers: RunSubscription): () => void {
      const controller = new AbortController();
      void streamLive(backendUrl, resolveBuild, runId, handlers, controller);
      return () => controller.abort();
    },

    async listActiveRuns(): Promise<InProgressRun[]> {
      // The backend reports its in-flight jobs by launch identity; the row shape
      // (`ActiveJobOut`) is the console's in-progress run verbatim except for the
      // fine-grained `state`, which is mapped to the console's coarser live phases
      // so a held-back ("pending") or spinning-up ("starting") run reads as such.
      const jobs = await getJson<
        (Omit<InProgressRun, "state"> & { state: string })[]
      >(backendUrl, "/jobs/active");
      return jobs.map((job) => ({ ...job, state: mapActiveState(job.state) }));
    },

    subscribeToNotifications(handlers: NotificationSubscription): () => void {
      // An EventSource holds one long-lived SSE connection and reconnects on its
      // own if it drops — exactly what an always-on notifications channel wants.
      const source = new EventSource(joinUrl(backendUrl, "/notifications"));
      // Fires on the initial connect and on every automatic reconnect. Because the
      // feed carries no backlog, a completion that fired while the channel was down
      // is gone; the console reconciles against the active list on each open to
      // recover it.
      source.onopen = () => handlers.onOpen?.();
      source.onmessage = (event) => {
        try {
          handlers.onNotification(JSON.parse(event.data) as RunNotification);
        } catch {
          // A malformed payload shouldn't tear down the channel; drop it.
        }
      };
      source.onerror = (event) => handlers.onError?.(event);
      return () => source.close();
    },

    async listRuns(): Promise<StoredRun[]> {
      // The console's "produced" worklist: every pushed-but-unpublished run the
      // backend holds, whatever its terminal state — completed (awaiting review),
      // a publishable failure (awaiting publish), or an infrastructure failure
      // (retained for inspection, in no other worklist). Published runs come from
      // the separate published listing, so this stays disjoint from it (no run is
      // flagged both unpublished and published). Walk every page and resolve each
      // run's pre-publish build link for inline playback.
      return listAllRuns(backendUrl, "unpublished", resolveBuild);
    },

    async listFailures(): Promise<StoredRun[]> {
      // The publishable failures (catastrophic, timed-out;
      // pending and published)
      // for the dedicated publish-failures worklist. `listRuns` already carries the
      // unpublished ones, but this filtered view (which also includes the published
      // ones) is what the publish page reads.
      return listAllRuns(backendUrl, "failures", resolveBuild);
    },

    async readRun(id: string): Promise<StoredRun> {
      // Resolve the pre-publish build link, and attach each reviewer's avatar URL
      // (the run-detail Verdict tab shows a reviewer's picture beside their name).
      const run = await resolveBuild(await backend.readRun(id));
      return {
        ...run,
        reviews: run.reviews.map((review) =>
          reviewWithPicture(authUrl, review),
        ),
      };
    },

    readRunEvents(
      id: string,
      onProgress?: ProgressCallback,
    ): Promise<RunEventStreams> {
      // A produced run's recorded events are served by the backend's run store
      // (TTC events only; raw harness output is never retained off the ephemeral
      // driver), the same read a published run uses.
      return backend.readRunEvents(id, onProgress);
    },

    // --- Accounts (the standalone auth service, reached directly) ---

    async register(
      username: string,
      password: string,
      displayName: string,
    ): Promise<AuthResult> {
      const result = await postJson<AuthResultResponse>(
        authUrl,
        "/auth/register",
        { username, password, displayName },
      );
      return {
        ...result,
        account: accountWithPicture(authUrl, result.account),
      };
    },

    async login(username: string, password: string): Promise<AuthResult> {
      const result = await postJson<AuthResultResponse>(
        authUrl,
        "/auth/login",
        {
          username,
          password,
        },
      );
      return {
        ...result,
        account: accountWithPicture(authUrl, result.account),
      };
    },

    async setProfilePicture(
      picture: Blob,
      token: string,
    ): Promise<AuthResult["account"]> {
      // `PUT /auth/profile/picture` — the body is the (already downscaled) image
      // bytes and the `Content-Type` names their type; the auth service stores them
      // and returns the updated account. Attach the fresh avatar URL so the caller
      // can update the session immediately.
      const account = await putBytes<AuthResultResponse["account"]>(
        authUrl,
        "/auth/profile/picture",
        picture,
        picture.type || "application/octet-stream",
        token,
      );
      return accountWithPicture(authUrl, account);
    },

    async removeProfilePicture(token: string): Promise<AuthResult["account"]> {
      // `DELETE /auth/profile/picture` — clear the account's picture; the auth
      // service returns the updated (picture-less) account.
      const account = await delJson<AuthResultResponse["account"]>(
        authUrl,
        "/auth/profile/picture",
        token,
      );
      return accountWithPicture(authUrl, account);
    },

    // --- Run lifecycle: review -> publish ---
    //
    // There is no console-driven push: the driver pushes a finished run's record
    // to the backend itself, so by the time the console sees a produced run it is
    // already stored and reviewable (its own links resolve the build/media).

    async submitReview(
      id: string,
      review: ReviewDocumentInput,
      token: string,
    ): Promise<void> {
      // `POST /runs/{id}/reviews` attributes the review to the token's account; a
      // run can carry one review per account.
      await postJson<{ id: string; published: boolean }>(
        backendUrl,
        `/runs/${encodeURIComponent(id)}/reviews`,
        {
          ratings: review.ratings,
          writeup: review.writeup,
          checklist: review.checklist,
          // Only meaningful on an edit; the backend ignores it on a first submission.
          editNote: review.editNote,
        },
        token,
      );
    },

    async publish(
      id: string,
      token: string,
      onProgress?: (progress: PublishProgress) => void,
    ): Promise<PublishResult> {
      // Publishing is asynchronous. `POST /runs/{id}/publish` is the gate (the
      // backend refuses a run with zero reviews / an infra failure) and the
      // *enqueue*: it answers `202` with the publish-job id and the live URL to
      // observe the gh/wrangler release on. Subscribe to that NDJSON stream and
      // resolve once it reports the terminal result — never poll.
      const ack = await postJson<{ publishJobId: string; liveUrl: string }>(
        backendUrl,
        `/runs/${encodeURIComponent(id)}/publish`,
        {},
        token,
      );
      return streamPublish(backendUrl, ack.liveUrl, onProgress);
    },

    async deleteRun(id: string, token: string): Promise<void> {
      // `DELETE /runs/{id}` removes the run, its reviews, and its stored media.
      // The backend refuses a published run (`422`), so this only ever applies to
      // an unpublished produced run.
      await delJson<{ id: string; deleted: boolean }>(
        backendUrl,
        `/runs/${encodeURIComponent(id)}`,
        token,
      );
    },

    async killRun(id: string, token: string): Promise<void> {
      // `POST /jobs/{id}/cancel` moves an in-flight run to the terminal `canceled`
      // state and closes its live stream; the driver polls its own state, notices
      // the cancellation, and tears its sandbox down. The backend gates it on the
      // launching account, so the signed-in token rides along; it refuses a run
      // that already finished (`409`).
      await postJson<JobStatusResponse>(
        backendUrl,
        `/jobs/${encodeURIComponent(id)}/cancel`,
        {},
        token,
      );
    },

    // A pre-publish run's proof / asset media is served by the artifact service
    // (the data plane), so resolve those root-relative paths against its base URL
    // rather than the control-plane backend. Null when no artifact service is
    // configured, in which case the UI shows presence without media.
    proofMediaUrl(runId: string, file: string): string | null {
      return mediaUrl(runId, "proof", file);
    },
    assetMediaUrl(runId: string, file: string): string | null {
      return mediaUrl(runId, "asset", file);
    },
    validationMediaUrl(runId: string, file: string): string | null {
      return mediaUrl(runId, "validation", file);
    },

    // The whole run tree as one gzip tar, served by the artifact service (which
    // holds the tree; the control-plane backend is not in the artifact path). Null
    // when no artifact service is configured, in which case the console offers no
    // download rather than linking somewhere that 404s.
    runArchiveUrl(runId: string): string | null {
      if (!artifactsNow) return null;
      return joinUrl(
        artifactsNow,
        `/runs/${encodeURIComponent(runId)}/archive.tar.gz`,
      );
    },
  };
}

// Read the backend's live NDJSON stream for a job (`GET /jobs/{id}/live`),
// forwarding one normalized event (or asset-preview frame) per line, then
// resolving the run's outcome from its final job status. The same line-framing
// the old worker `/runs/{id}/events` consumer used. `resolveBuild` applies the
// artifact-service prefix to the completed run's build link.
async function streamLive(
  backendUrl: string,
  resolveBuild: (run: StoredRun) => Promise<StoredRun>,
  runId: string,
  handlers: RunSubscription,
  controller: AbortController,
): Promise<void> {
  const backend = createHttpBackend(backendUrl);
  try {
    const res = await fetch(
      joinUrl(backendUrl, `/jobs/${encodeURIComponent(runId)}/live`),
      {
        headers: { accept: "application/x-ndjson" },
        signal: controller.signal,
      },
    );
    if (!res.ok || !res.body) {
      throw new Error(`live stream failed: ${res.status}`);
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
        if (line) emitLine(line, handlers);
      }
    }
    const tail = buffer.trim();
    if (tail) emitLine(tail, handlers);

    // The stream closes when the run reaches a terminal state; read the job back
    // to learn how it ended and (on success) the produced record to open.
    const status = await getJson<JobStatusResponse>(
      backendUrl,
      `/jobs/${encodeURIComponent(runId)}`,
    );
    if (mapJobState(status.state) === "completed" && status.recordId) {
      const record = (
        await resolveBuild(await backend.readRun(status.recordId))
      ).record;
      handlers.onDone({ kind: "completed", record });
    } else if (status.state === "canceled") {
      // An operator killed the run. Report it as an intentional stop rather than a
      // fault, so the monitor shows "canceled" instead of "failed".
      handlers.onDone({
        kind: "canceled",
        message: status.detail ?? "Run canceled.",
      });
    } else {
      handlers.onDone({
        kind: "failed",
        message: status.detail ?? "Run did not complete.",
      });
    }
  } catch (e) {
    if (controller.signal.aborted) return;
    handlers.onError?.(e);
  }
}

// Forward one NDJSON line from the live stream: an `asset_preview`-tagged line is
// a live drawing frame; every other line is a normalized harness event (whose
// `type` is one of the closed set of event kinds, never `asset_preview`).
function emitLine(line: string, handlers: RunSubscription): void {
  let parsed: { type?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    // A malformed line shouldn't tear down the stream; surface it as an
    // unclassified event carrying the raw text (the contract's `unknown` kind).
    handlers.onEvent({ timestamp: "", type: "unknown", raw: line });
    return;
  }
  if (parsed.type === "asset_preview") {
    handlers.onPreview?.(parsed as unknown as AssetPreview);
    return;
  }
  handlers.onEvent(parsed as HarnessEvent);
}

// One line of the publish live stream (`GET /publish-jobs/{id}/live`), hand-typed
// here rather than from a generated contract: the publish-queue wire types are
// deliberately internal (backend↔dispatcher↔publisher), so the console binds the
// few fields it needs by hand. Each line is tagged with a `type` discriminator: a
// `progress` line carries a human-readable `message`, the terminal `result` line
// carries the release outcome (`succeeded`/`failed`, the produced links, or the
// failure reason). The stream ends with the `result`.
type PublishStreamLine =
  | { type: "progress"; message: string }
  | {
      type: "result";
      state: "succeeded" | "failed";
      sourceRepo?: string | null;
      playableBuild?: string | null;
      detail?: string | null;
    };

// Read the backend's live publish stream (`GET /publish-jobs/{id}/live`, NDJSON),
// forwarding each progress line to `onProgress` and resolving with the terminal
// {@link PublishResult} once the release succeeds — or rejecting with the
// publisher's reason on failure. `liveUrl` is the root-relative URL the enqueue
// ack returned (`/publish-jobs/{id}/live`). Same line-framing as `streamLive`.
async function streamPublish(
  backendUrl: string,
  liveUrl: string,
  onProgress?: (progress: PublishProgress) => void,
): Promise<PublishResult> {
  const res = await fetch(joinUrl(backendUrl, liveUrl), {
    headers: { accept: "application/x-ndjson" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`publish stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: PublishResult | null = null;

  const handle = (line: string): void => {
    let parsed: PublishStreamLine;
    try {
      parsed = JSON.parse(line) as PublishStreamLine;
    } catch {
      // A malformed line shouldn't tear down the stream silently; treat it as a
      // terminal failure carrying the raw text so the publish ends legibly.
      terminal = {
        published: false,
        sourceRepo: null,
        playableBuild: null,
      };
      throw new Error(`unrecognized publish stream line: ${line}`);
    }
    if (parsed.type === "progress") {
      onProgress?.({ message: parsed.message });
      return;
    }
    if (parsed.type === "result") {
      if (parsed.state === "failed") {
        throw new Error(parsed.detail ?? "Publish failed.");
      }
      terminal = {
        published: true,
        sourceRepo: parsed.sourceRepo ?? null,
        playableBuild: parsed.playableBuild ?? null,
      };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) handle(line);
    }
  }
  const tail = buffer.trim();
  if (tail) handle(tail);

  // The stream closes only after the terminal result; its absence means the
  // connection dropped before the publish reported an outcome.
  if (!terminal) {
    throw new Error(
      "The publish stream ended before reporting a result — retry to observe it.",
    );
  }
  return terminal;
}
