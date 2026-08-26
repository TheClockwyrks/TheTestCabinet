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
  ComparisonPublishOutcome,
  WorkerClient,
  RunSubscription,
  NotificationSubscription,
} from "../client";
import { runPhase } from "../client/runPhase";
import type {
  AssetKind,
  AssetPreview,
  AuthResult,
  BackendIdentity,
  CaseShowcase,
  CatalogShowcase,
  Domain,
  Erratum,
  HarnessConfigEntry,
  HarnessEvent,
  InProgressRun,
  LaunchConfig,
  LaunchOrigin,
  LogoFetchResult,
  Model,
  ModelAccuracy,
  ModelInput,
  ModelListing,
  ModelProbe,
  ModelProbeDetail,
  ModelProbeProviders,
  ModelProbeTriggerInput,
  ModelSeed,
  MyReviewsPage,
  ProgressCallback,
  ProviderStats,
  PublishEnqueued,
  PublishProgress,
  PublishResult,
  ReviewDocumentInput,
  ReviewItem,
  ReviewStats,
  RunEventStreams,
  RunJob,
  RunLifecycleEvent,
  RunNotification,
  RunPage,
  RunSummaryPage,
  Specification,
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
import type {
  RunScoreOut,
  RunSummary,
} from "@test-cabinet/run-record/snapshot";
import type {
  CabinetStatsResponse,
  TestCaseGroupOut,
  TestCaseGroupsResponse,
} from "@test-cabinet/run-record/backend-api";
import type {
  BulkCancelOut,
  GgRunRequest,
  LaunchAck,
  LaunchBody,
  StreamOpened,
} from "@test-cabinet/run-record/jobs-api";
import type {
  GgConfig,
  GgConfigInput,
  GgSavedAgent,
  GgSavedAgentInput,
  GgProgramLanguage,
} from "@test-cabinet/run-record/gg";
import type {
  GgReference,
  GgReferenceApi,
} from "@test-cabinet/run-record/gg-reference";
import type { CodeAnalysisDocument } from "@test-cabinet/run-record/code-analysis";
import type {
  GgDashboard,
  GgDashboardInput,
  GgFieldCatalog,
  GgQuery,
  GgQueryBatch,
  GgQueryBatchResponse,
  GgQueryResponse,
  GgSavedQuery,
  GgSavedQueryInput,
} from "@test-cabinet/run-record/gg-query";
import type {
  CoverageGroup,
  CoverageGroupInput,
  CoverageMatrix,
  CoveragePlanInput,
  CoveragePlanOut,
  CoveragePlanSummary,
  CoverageQueue,
  CoverageSchedule,
  CoverageSettings,
  CoverageSettingsInput,
  HaltResult,
  TopUpResult,
} from "@test-cabinet/run-record/coverage";
import type {
  Comparison,
  ComparisonInput,
} from "@test-cabinet/run-record/comparison";
import type {
  LadderClimberInput,
  LadderInput,
  LadderOut,
  LadderOverrideInput,
  LadderProgress,
  LadderRung,
  LadderRungOrderInput,
  LadderRungOutcome,
  LadderSchedule,
  StoredClimberOut,
} from "@test-cabinet/run-record/ladders";
import {
  delJson,
  delVoid,
  getJson,
  getJsonStreamed,
  joinUrl,
  postJson,
  putBytes,
  putJson,
  putVoid,
} from "./http";
import {
  applyScoreExclusions,
  excludedVerdictIds,
  mergeReviewItems,
  type AestheticRating,
  type Rating,
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

// One entry of `GET /test-cases`: the case's versions plus the display metadata
// a catalog card renders, resolved server-side from the latest visible version.
// It is what lets a listing render from this single request instead of resolving
// every version of every case first.
interface CatalogEntry {
  slug: string;
  versions: string[];
  name: string;
  testType: TestType;
  assetKind?: AssetKind | null;
  difficulty: string;
  tags: string[];
  summary: string | null;
  // The case's catalog showcase preview (the latest visible version's first
  // variant, in manifest order, that declares one), with the media list a card's
  // preview stage loops. The wire shape matches the client's `CatalogShowcase`
  // exactly, so it is carried through verbatim. Null when no variant of the
  // latest version declares one; absent on a backend that predates the field.
  showcase?: CatalogShowcase | null;
}

// `GET /test-cases/{slug}/versions` — the versions for one case, wrapped in
// `{ slug, versions }`.
interface VersionsResponse {
  slug: string;
  versions: string[];
}

// One starter-workspace file in a resolved version: its store-relative `source`
// artifact key (what the version artifacts route serves the bytes by) and the
// run-root-relative `dest` it is seeded at.
interface WorkspaceFileDescriptor {
  source: string;
  dest: string;
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
  // Whether the version is on the engine manifest format (see
  // `VersionInfo.engineFormat`); with the test type, whether it is validator-rated.
  engineFormat: boolean;
  // The engines a run of this version may select, each with the version range the
  // case accepts it at. Never empty — a version that declares none supports the
  // engineless run. The range is the host's business, so only the slug is carried
  // any further.
  engines: { slug: string }[];
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
  // The case's COMMON starter-workspace files, keyed by engine slug (the
  // engineless set under "none") — a starter project is written against a
  // runtime, so a case ships one set per engine. A variant that declares its own
  // `workspace` (below) replaces this set entirely. Absent on a backend that
  // predates the tables.
  workspace?: Record<string, WorkspaceFileDescriptor[]>;
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
    // The absolute URLs of this variant's reference implementations, keyed by the
    // engine each was built for, from the backend's `case_reference_build` table.
    // Absent on a backend that predates the field.
    referenceBuilds?: Record<string, string>;
    // An ASSET-GENERATION variant's published reference frames: the indices whose
    // rendered image + action log `tcab publish-reference` uploaded to the public
    // snapshot bucket. Null when none is published; absent on a backend that
    // predates the field (which is why the whole feature degrades to "no tab").
    referenceSheet?: { frames: number[] } | null;
    // The variant's own starter-workspace override (same per-engine keying as
    // the version-level `workspace`), replacing the common set for this variant
    // when declared. Null/absent when the variant inherits the common workspace.
    workspace?: Record<string, WorkspaceFileDescriptor[]> | null;
    // The variant's authored showcase: the description plus the media carousel,
    // each entry addressed by plain file name against the backend's case-scoped
    // showcase route. The wire shape matches the client's `CaseShowcase`
    // exactly, so it is carried through verbatim. Null when the variant declares
    // none; absent on a backend that predates the field.
    showcase?: CaseShowcase | null;
  }[];
}

// One review entry of `GET /runs/{id}` — the reviewer's verdict plus attribution
// (id, display name, and login username).
interface ReviewResponse {
  reviewerId: string;
  reviewer: string;
  username?: string | null;
  ratings: StoredReview["ratings"];
  // The reviewer's per-domain aesthetic ratings; absent on a legacy run's review.
  aesthetics?: StoredReview["aesthetics"];
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
  // The two rating channels the store decides (see `StoredRun`): the functional
  // `rating` (validator-decided on a validator-rated run, the review aggregate on
  // a legacy one), the aggregate `aesthetic`, and which way the functional one
  // was decided.
  rating: Rating | null;
  aesthetic: AestheticRating | null;
  validatorRated: boolean;
  // The run's score against its case version's checklist weights (see
  // `StoredRun.score`); null when the case version isn't ingested.
  score: RunScoreOut | null;
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
    aesthetics: rv.aesthetics ?? [],
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
  return {
    id: record.id,
    record,
    reviews,
    published: r.published ?? true,
    rating: r.rating,
    aesthetic: r.aesthetic,
    validatorRated: r.validatorRated,
    score: r.score,
  };
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

// The path of one coverage plan's resource, or of a sub-resource beneath it
// (`/schedule`, `/topup`, …). Every plan-scoped call routes through here so the id is
// escaped exactly once, in one place — a plan id is opaque and must survive the URL
// intact for the scoped controls (halt above all) to address the right plan.
function planPath(id: string, suffix = ""): string {
  return `/coverage-plans/${encodeURIComponent(id)}${suffix}`;
}

// The ladder equivalent of {@link planPath}. Ladders are a sibling surface, not a mode
// of a plan, so they get their own route family rather than a query flag.
function ladderPath(id: string, suffix = ""): string {
  return `/ladders/${encodeURIComponent(id)}${suffix}`;
}

// The backend route serving one raw artifact of a case version by its
// store-relative key. The key is a `{*path}` wildcard on the backend (it holds
// slashes), so each segment is escaped individually rather than the key whole.
function versionArtifactPath(
  slug: string,
  version: string,
  source: string,
): string {
  const key = source.split("/").map(encodeURIComponent).join("/");
  return `/test-cases/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/artifacts/${key}`;
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
      return testCases.map((e) => ({
        slug: e.slug,
        versions: e.versions,
        name: e.name,
        testType: e.testType,
        assetKind: e.assetKind ?? null,
        difficulty: e.difficulty,
        tags: e.tags,
        summary: e.summary,
        // The catalog showcase preview, verbatim (the wire shape is the
        // client's). Null on a backend that predates the field, so the catalog
        // simply renders its placeholder stage.
        showcase: e.showcase ?? null,
      }));
    },

    async listTestCaseGroups(): Promise<TestCaseGroupOut[]> {
      // Served already in display order (rank ascending then name, resolved at
      // ingest — rank never rides the wire); unwrapped from the `groups`
      // envelope and consumed as-is.
      const { groups } = await getJson<TestCaseGroupsResponse>(
        baseUrl,
        "/test-case-groups",
      );
      return groups;
    },

    async listVersions(slug: string): Promise<string[]> {
      const { versions } = await getJson<VersionsResponse>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions`,
      );
      return versions;
    },

    async resolveVersion(
      slug: string,
      version: string,
      engine: string,
    ): Promise<VersionInfo> {
      // `engine` selects which engine each variant's prompt is rendered for: a
      // case's `prompt.hbs` branches on it, so a run surface names the engine its
      // run recorded and a case surface names the engineless one.
      const r = await getJson<ResolvedVersion>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}?engine=${encodeURIComponent(engine)}`,
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
        engineFormat: r.engineFormat,
        // The engines this version supports, which is exactly what the run form's
        // engine picker offers.
        engines: r.engines.map((engine) => engine.slug),
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
          // The variant's reference-implementation build URLs, one per engine,
          // carried through verbatim (each already an absolute Cloudflare Pages URL
          // — the backend records exactly what `tcab publish-reference` deployed).
          // Empty when the variant declares none.
          referenceBuilds: v.referenceBuilds ?? {},
          // An asset-generation variant's published reference frames. Carried as
          // indices only — the frame images and action logs live in the public
          // snapshot bucket, addressed by key (see `referenceMediaKey`). Null on a
          // backend that predates the field, so the Reference tab simply never
          // appears rather than pointing at objects that were never published.
          referenceSheet: v.referenceSheet ?? null,
          // The variant's authored showcase, verbatim (the wire shape is the
          // client's); the media bytes are addressed separately through the
          // gallery's `caseShowcaseMediaUrl`. Null when the variant declares
          // none or the backend predates the field.
          showcase: v.showcase ?? null,
          // The variant's EFFECTIVE starter workspace: its own override when it
          // declares one, else the case's common set — the same fallback a
          // run's seed applies — selected for the engine this resolution named
          // (the backend keys the sets by engine slug, the engineless one under
          // "none", matching the `engine` a caller passes here). Each file
          // resolves to the version artifacts route on the backend base, so the
          // Inputs tree fetches a starter file lazily. Empty when the case
          // seeds no starter file for the engine or the backend predates the
          // tables.
          workspace: ((v.workspace ?? r.workspace)?.[engine] ?? []).map(
            (file) => ({
              path: file.dest,
              url: joinUrl(
                baseUrl,
                versionArtifactPath(r.slug, r.version, file.source),
              ),
            }),
          ),
        })),
      };
    },

    async readSpecs(
      slug: string,
      version: string,
      variant: string,
      engine: string,
    ): Promise<Specification> {
      // The backend renders each seeded spec for the selected variant and returns
      // the whole set as one bundle — a template spec's `{{#if (eq variant.slug …)}}`
      // branches already resolved server-side — so the Inputs tab shows the exact,
      // handlebars-free files the harness receives (the spec analogue of the
      // rendered prompt). This is why we no longer fetch the raw `/artifacts` bytes
      // per spec and stitch them here: those are the unrendered templates.
      // `engine` renders the spec bodies under that engine's branch, as it does the
      // prompt on the resolved version.
      return getJson<Specification>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/specs/${encodeURIComponent(variant)}?engine=${encodeURIComponent(engine)}`,
      );
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

    async lookupOpenrouterModel(
      slug: string,
      token: string,
    ): Promise<ModelListing> {
      return getJson<ModelListing>(
        baseUrl,
        `/models/openrouter?slug=${encodeURIComponent(slug)}`,
        token,
      );
    },

    async listModelProbes(slug: string): Promise<ModelProbe[]> {
      const body = await getJson<{ probes: ModelProbe[] }>(
        baseUrl,
        `/models/${encodeURIComponent(slug)}/probes`,
      );
      return body.probes;
    },

    async getModelProbe(id: string): Promise<ModelProbeDetail> {
      return getJson<ModelProbeDetail>(
        baseUrl,
        `/model-probes/${encodeURIComponent(id)}`,
      );
    },

    async triggerModelProbe(
      slug: string,
      input: ModelProbeTriggerInput,
      token: string,
    ): Promise<ModelProbe> {
      const body = await postJson<{ probe: ModelProbe }>(
        baseUrl,
        `/models/${encodeURIComponent(slug)}/probes`,
        input,
        token,
      );
      return body.probe;
    },

    async listModelProbeProviders(
      slug: string,
      token: string,
    ): Promise<ModelProbeProviders> {
      return getJson<ModelProbeProviders>(
        baseUrl,
        `/models/${encodeURIComponent(slug)}/probe-providers`,
        token,
      );
    },

    async getProviderStats(): Promise<ProviderStats> {
      // The wire shape matches `ProviderStats` field-for-field (camelCase),
      // no envelope to unwrap.
      return getJson<ProviderStats>(baseUrl, "/stats/providers");
    },

    async getModelAccuracy(): Promise<ModelAccuracy> {
      // The wire shape matches `ModelAccuracy` field-for-field (camelCase),
      // no envelope to unwrap.
      return getJson<ModelAccuracy>(baseUrl, "/stats/model-accuracy");
    },

    async getCabinetStats(): Promise<CabinetStatsResponse> {
      // The wire shape matches `CabinetStatsResponse` field-for-field
      // (camelCase), no envelope to unwrap.
      return getJson<CabinetStatsResponse>(baseUrl, "/stats/cabinet");
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

    async listCoveragePlans(token: string): Promise<CoveragePlanOut[]> {
      // Each plan arrives with its schedule flattened in (`CoveragePlanOut`), so the
      // plans list can show paused/axis/buffer state without a call per plan.
      return getJson<CoveragePlanOut[]>(baseUrl, "/coverage-plans", token);
    },

    async createCoveragePlan(
      input: CoveragePlanInput,
      token: string,
    ): Promise<CoveragePlanOut> {
      return postJson<CoveragePlanOut>(
        baseUrl,
        "/coverage-plans",
        input,
        token,
      );
    },

    async updateCoveragePlan(
      id: string,
      input: CoveragePlanInput,
      token: string,
    ): Promise<CoveragePlanOut> {
      return putJson<CoveragePlanOut>(baseUrl, planPath(id), input, token);
    },

    async deleteCoveragePlan(id: string, token: string): Promise<void> {
      await delVoid(baseUrl, planPath(id), token);
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
      return getJson<CoverageMatrix>(baseUrl, planPath(id, "/coverage"), token);
    },

    async getCoverageSettings(token: string): Promise<CoverageSettings> {
      return getJson<CoverageSettings>(baseUrl, "/coverage-settings", token);
    },

    async setCoverageSettings(
      input: CoverageSettingsInput,
      token: string,
    ): Promise<CoverageSettings> {
      // The backend clamps the target, so it echoes back what it actually stored
      // rather than what was asked for — display that, not the submitted value.
      return putJson<CoverageSettings>(
        baseUrl,
        "/coverage-settings",
        input,
        token,
      );
    },

    async getCoveragePlanSchedule(
      id: string,
      token: string,
    ): Promise<CoverageSchedule> {
      return getJson<CoverageSchedule>(
        baseUrl,
        planPath(id, "/schedule"),
        token,
      );
    },

    async setCoveragePlanSchedule(
      id: string,
      schedule: CoverageSchedule,
      token: string,
    ): Promise<CoverageSchedule> {
      return putJson<CoverageSchedule>(
        baseUrl,
        planPath(id, "/schedule"),
        schedule,
        token,
      );
    },

    async topUpCoveragePlan(id: string, token: string): Promise<TopUpResult> {
      // The top-up takes no body — every input (the plan, its schedule, the account's
      // buffer target, what is already outstanding) is server-side state it recomputes
      // per call, which is exactly what makes repeating the call harmless.
      return postJson<TopUpResult>(baseUrl, planPath(id, "/topup"), {}, token);
    },

    async getCoveragePlanQueue(
      id: string,
      token: string,
    ): Promise<CoverageQueue> {
      return getJson<CoverageQueue>(baseUrl, planPath(id, "/queue"), token);
    },

    async pauseCoveragePlan(
      id: string,
      paused: boolean,
      token: string,
    ): Promise<CoverageSchedule> {
      // The desired state travels in the body, so the control is idempotent and a
      // console can drive a switch without tracking which way it is going.
      return postJson<CoverageSchedule>(
        baseUrl,
        planPath(id, "/pause"),
        { paused },
        token,
      );
    },

    async haltCoveragePlan(id: string, token: string): Promise<HaltResult> {
      return postJson<HaltResult>(baseUrl, planPath(id, "/halt"), {}, token);
    },

    async haltAllCoveragePlan(id: string, token: string): Promise<HaltResult> {
      return postJson<HaltResult>(
        baseUrl,
        planPath(id, "/halt-all"),
        {},
        token,
      );
    },

    async listLadders(token: string): Promise<LadderOut[]> {
      return getJson<LadderOut[]>(baseUrl, "/ladders", token);
    },

    async getLadder(id: string, token: string): Promise<LadderOut> {
      return getJson<LadderOut>(baseUrl, ladderPath(id), token);
    },

    async createLadder(input: LadderInput, token: string): Promise<LadderOut> {
      // The response carries every rung's minted id — the stable handle a reorder, a
      // version bump, and every recorded verdict key off — so the caller must adopt
      // the returned ladder rather than the one it submitted.
      return postJson<LadderOut>(baseUrl, "/ladders", input, token);
    },

    async updateLadder(
      id: string,
      input: LadderInput,
      token: string,
    ): Promise<LadderOut> {
      return putJson<LadderOut>(baseUrl, ladderPath(id), input, token);
    },

    async deleteLadder(id: string, token: string): Promise<void> {
      await delVoid(baseUrl, ladderPath(id), token);
    },

    async reorderLadderRungs(
      id: string,
      input: LadderRungOrderInput,
      token: string,
    ): Promise<LadderRung[]> {
      return postJson<LadderRung[]>(
        baseUrl,
        ladderPath(id, "/rungs/order"),
        input,
        token,
      );
    },

    async getLadderSchedule(
      id: string,
      token: string,
    ): Promise<LadderSchedule> {
      return getJson<LadderSchedule>(
        baseUrl,
        ladderPath(id, "/schedule"),
        token,
      );
    },

    async setLadderSchedule(
      id: string,
      schedule: LadderSchedule,
      token: string,
    ): Promise<LadderSchedule> {
      return putJson<LadderSchedule>(
        baseUrl,
        ladderPath(id, "/schedule"),
        schedule,
        token,
      );
    },

    async getLadderProgress(
      id: string,
      token: string,
    ): Promise<LadderProgress> {
      return getJson<LadderProgress>(
        baseUrl,
        ladderPath(id, "/progress"),
        token,
      );
    },

    async topUpLadder(id: string, token: string): Promise<TopUpResult> {
      return postJson<TopUpResult>(
        baseUrl,
        ladderPath(id, "/topup"),
        {},
        token,
      );
    },

    async getLadderQueue(id: string, token: string): Promise<CoverageQueue> {
      return getJson<CoverageQueue>(baseUrl, ladderPath(id, "/queue"), token);
    },

    async pauseLadder(
      id: string,
      paused: boolean,
      token: string,
    ): Promise<LadderSchedule> {
      return postJson<LadderSchedule>(
        baseUrl,
        ladderPath(id, "/pause"),
        { paused },
        token,
      );
    },

    async haltLadder(id: string, token: string): Promise<HaltResult> {
      return postJson<HaltResult>(baseUrl, ladderPath(id, "/halt"), {}, token);
    },

    async haltAllLadder(id: string, token: string): Promise<HaltResult> {
      return postJson<HaltResult>(
        baseUrl,
        ladderPath(id, "/halt-all"),
        {},
        token,
      );
    },

    async setLadderClimber(
      id: string,
      input: LadderClimberInput,
      token: string,
    ): Promise<StoredClimberOut> {
      // The combination travels in the body, not the path: a model id contains
      // slashes and has no business being a path segment.
      return postJson<StoredClimberOut>(
        baseUrl,
        ladderPath(id, "/climbers"),
        input,
        token,
      );
    },

    async setLadderOutcome(
      id: string,
      input: LadderOverrideInput,
      token: string,
    ): Promise<LadderRungOutcome> {
      // The response is the verdict as it now stands — the override applied over (or
      // cleared back to) whatever the gate itself computed, which is not necessarily
      // what was submitted.
      return postJson<LadderRungOutcome>(
        baseUrl,
        ladderPath(id, "/outcomes"),
        input,
        token,
      );
    },

    // The operator's saved gg configurations — named capability sets the account
    // section registers and the new-run form launches once `gg` is the chosen
    // orchestrator. Per-account, so every call carries the bearer token.
    async listGgConfigs(token: string): Promise<GgConfig[]> {
      return getJson<GgConfig[]>(baseUrl, "/gg/configs", token);
    },

    async createGgConfig(
      input: GgConfigInput,
      token: string,
    ): Promise<GgConfig> {
      return postJson<GgConfig>(baseUrl, "/gg/configs", input, token);
    },

    async updateGgConfig(
      id: string,
      input: GgConfigInput,
      token: string,
    ): Promise<GgConfig> {
      return putJson<GgConfig>(
        baseUrl,
        `/gg/configs/${encodeURIComponent(id)}`,
        input,
        token,
      );
    },

    async deleteGgConfig(id: string, token: string): Promise<void> {
      await delVoid(baseUrl, `/gg/configs/${encodeURIComponent(id)}`, token);
    },

    // The operator's saved gg agents — agent profiles authored on their own, which a
    // configuration imports and may override locally. Per-account, like the
    // configurations that import them.
    async listGgAgents(token: string): Promise<GgSavedAgent[]> {
      return getJson<GgSavedAgent[]>(baseUrl, "/gg/agents", token);
    },

    async createGgAgent(
      input: GgSavedAgentInput,
      token: string,
    ): Promise<GgSavedAgent> {
      return postJson<GgSavedAgent>(baseUrl, "/gg/agents", input, token);
    },

    async updateGgAgent(
      id: string,
      input: GgSavedAgentInput,
      token: string,
    ): Promise<GgSavedAgent> {
      return putJson<GgSavedAgent>(
        baseUrl,
        `/gg/agents/${encodeURIComponent(id)}`,
        input,
        token,
      );
    },

    async deleteGgAgent(id: string, token: string): Promise<void> {
      await delVoid(baseUrl, `/gg/agents/${encodeURIComponent(id)}`, token);
    },

    // The gg analysis query surface. The body is the *compiled* query — the client
    // owns the parser, so nothing about what a query means is decided twice.
    async runGgQuery(query: GgQuery, token: string): Promise<GgQueryResponse> {
      return postJson<GgQueryResponse>(baseUrl, "/gg/query", query, token);
    },

    // A whole board in one request. Not an optimisation: the batch is what makes
    // every panel of a board answer from the same index read, so two panels can
    // never disagree because the corpus refreshed between them.
    async runGgQueryBatch(
      batch: GgQueryBatch,
      token: string,
    ): Promise<GgQueryBatchResponse> {
      return postJson<GgQueryBatchResponse>(
        baseUrl,
        "/gg/query/batch",
        batch,
        token,
      );
    },

    async getGgFields(token: string): Promise<GgFieldCatalog> {
      return getJson<GgFieldCatalog>(baseUrl, "/gg/fields", token);
    },

    // The operator's saved views over the corpus. Per-account, so every call carries
    // the bearer token as an owner filter rather than only as a gate.
    async listGgSavedQueries(token: string): Promise<GgSavedQuery[]> {
      return getJson<GgSavedQuery[]>(baseUrl, "/gg/saved-queries", token);
    },

    async createGgSavedQuery(
      input: GgSavedQueryInput,
      token: string,
    ): Promise<GgSavedQuery> {
      return postJson<GgSavedQuery>(baseUrl, "/gg/saved-queries", input, token);
    },

    async updateGgSavedQuery(
      id: string,
      input: GgSavedQueryInput,
      token: string,
    ): Promise<GgSavedQuery> {
      return putJson<GgSavedQuery>(
        baseUrl,
        `/gg/saved-queries/${encodeURIComponent(id)}`,
        input,
        token,
      );
    },

    async deleteGgSavedQuery(id: string, token: string): Promise<void> {
      await delVoid(
        baseUrl,
        `/gg/saved-queries/${encodeURIComponent(id)}`,
        token,
      );
    },

    async listGgDashboards(token: string): Promise<GgDashboard[]> {
      return getJson<GgDashboard[]>(baseUrl, "/gg/dashboards", token);
    },

    async getGgDashboard(id: string, token: string): Promise<GgDashboard> {
      return getJson<GgDashboard>(
        baseUrl,
        `/gg/dashboards/${encodeURIComponent(id)}`,
        token,
      );
    },

    async createGgDashboard(
      input: GgDashboardInput,
      token: string,
    ): Promise<GgDashboard> {
      return postJson<GgDashboard>(baseUrl, "/gg/dashboards", input, token);
    },

    async updateGgDashboard(
      id: string,
      input: GgDashboardInput,
      token: string,
    ): Promise<GgDashboard> {
      return putJson<GgDashboard>(
        baseUrl,
        `/gg/dashboards/${encodeURIComponent(id)}`,
        input,
        token,
      );
    },

    async deleteGgDashboard(id: string, token: string): Promise<void> {
      await delVoid(baseUrl, `/gg/dashboards/${encodeURIComponent(id)}`, token);
    },

    // gg's reference, in two calls because it is two documents: the language-independent
    // index (families, tools, the arm list), and one arm's responses-as-code surface.
    //
    // No token on either: the documents are static and caller-independent, so the backend
    // serves them to anyone who can reach it. That is also why they are fetched rather
    // than bundled — the deployment projects them from the gg *it* ships, so the answer to
    // "what does this deployment's gg tell models" comes from that deployment and not from
    // whatever gg this console was built beside.
    async ggReference(): Promise<GgReference> {
      return getJson<GgReference>(baseUrl, "/gg/reference");
    },

    // The language id is a `GgProgramLanguage`, so it is already one of the eleven the
    // wire knows — but it is still encoded, because a path segment built by concatenation
    // is a habit worth not having, and the backend's own `404` is the check that decides.
    async ggReferenceApi(language: GgProgramLanguage): Promise<GgReferenceApi> {
      return getJson<GgReferenceApi>(
        baseUrl,
        `/gg/reference/${encodeURIComponent(language)}`,
      );
    },

    async listComparisons(token: string): Promise<Comparison[]> {
      return getJson<Comparison[]>(baseUrl, "/comparisons", token);
    },

    async getComparison(id: string, token: string): Promise<Comparison> {
      return getJson<Comparison>(
        baseUrl,
        `/comparisons/${encodeURIComponent(id)}`,
        token,
      );
    },

    async createComparison(
      input: ComparisonInput,
      token: string,
    ): Promise<Comparison> {
      return postJson<Comparison>(baseUrl, "/comparisons", input, token);
    },

    async updateComparison(
      id: string,
      input: ComparisonInput,
      token: string,
    ): Promise<Comparison> {
      return putJson<Comparison>(
        baseUrl,
        `/comparisons/${encodeURIComponent(id)}`,
        input,
        token,
      );
    },

    async deleteComparison(id: string, token: string): Promise<void> {
      await delVoid(baseUrl, `/comparisons/${encodeURIComponent(id)}`, token);
    },

    async publishComparison(
      id: string,
      token: string,
    ): Promise<ComparisonPublishOutcome> {
      // `POST /comparisons/{id}/publish` marks the comparison published and
      // best-effort enqueues one ordinary publish job per publishable arm run,
      // resolving which were enqueued and which were skipped (with why). It does
      // *not* return the updated comparison (see `ComparisonPublishOutcome`'s
      // doc in clients.ts) — the caller re-fetches or flips `published` locally.
      return postJson<ComparisonPublishOutcome>(
        baseUrl,
        `/comparisons/${encodeURIComponent(id)}/publish`,
        {},
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
      // Like `versions`, the case list rides as one comma-separated param
      // (`testCases=meltdown,valence`), matching the backend's split-and-trim.
      if (opts?.testCases?.length)
        params.set("testCases", opts.testCases.join(","));
      if (opts?.model) params.set("model", opts.model);
      if (opts?.harness) params.set("harness", opts.harness);
      if (opts?.variant) params.set("variant", opts.variant);
      if (opts?.version) params.set("version", opts.version);
      // The list rides as one comma-separated param
      // (`versions=v1.0.0,v1.1.0`), matching the backend's split-and-trim.
      if (opts?.versions?.length)
        params.set("versions", opts.versions.join(","));
      if (opts?.engine) params.set("engine", opts.engine);
      // Only sent when on: the backend defaults it off, so the common URL stays
      // free of a redundant `latestVersions=false`.
      if (opts?.latestVersions) params.set("latestVersions", "true");
      if (opts?.aesthetic) params.set("aesthetic", opts.aesthetic);
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

    async readCodeAnalysis(id: string): Promise<CodeAnalysisDocument | null> {
      // Same shape as the replay read, and for the same reasons: the backend serves the
      // stored document as JSON and 404s for a run that has none — which is every run
      // recorded before the analyzer shipped, since the corpus is not backfilled. A raw
      // fetch lets that 404 resolve to `null` (a tidy "not analysed" state) while any
      // other non-2xx still surfaces as an error.
      //
      // The request advertises no `accept-encoding` of its own: the browser always sends
      // one, and the route negotiates the stored gzip against the *request's* header.
      //
      // The document is not version-tagged the way a replay record is, and does not need
      // to be: it carries `analyzerVersion` as data (which generation computed the
      // figures, so a mixed corpus is visible rather than a silent step change), while
      // the document's *shape* is the contract type this app is compiled against.
      const res = await fetch(
        joinUrl(baseUrl, `/runs/${encodeURIComponent(id)}/code-analysis`),
        { headers: { accept: "application/json" } },
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `code analysis fetch failed: ${res.status} ${res.statusText}`,
        );
      }
      return (await res.json()) as CodeAnalysisDocument;
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
  // The public **read** base URL of the snapshot bucket (the R2 bucket the backend
  // exports the public snapshot to), or null when no bucket is configured. Distinct
  // from `artifactsUrl`: a case's published asset-reference frames live in that
  // bucket, not in any run tree the artifact service holds. Absent on a backend
  // that predates the field.
  snapshotUrl?: string | null;
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
function launchBodyOf(config: LaunchConfig): LaunchBody {
  return {
    testCase: config.testCase,
    version: config.version,
    variant: config.variant,
    // The console collects the slug from its own harness catalog, which mirrors
    // the contract's `HarnessSlug` in the same order, so the narrowing is a
    // restatement of what the picker can produce rather than a claim about
    // arbitrary input.
    harness: config.harness as LaunchBody["harness"],
    model: config.modelId,
    orchestrator: config.orchestrator,
    // Omitted entirely by a caller that pins no engine — a coverage plan and a
    // comparison arm both mean the `none` default, which the backend spells as an
    // absent field. The run form always names one. Typing this return against the
    // contract's own `LaunchBody` is what keeps a field the console collects from
    // being silently dropped here.
    ...(config.engine ? { engine: config.engine } : {}),
    ...(config.maxRuntimeOverride != null
      ? { maxRuntimeSeconds: config.maxRuntimeOverride }
      : {}),
    ...(config.retryCount != null ? { retryCount: config.retryCount } : {}),
  };
}

// The query string attributing an enqueue to the plan or ladder that asked for it,
// or "" for a hand-launch (which no scoped halt should ever sweep up).
//
// The origin rides in the **query**, not in `LaunchBody`: the body is stored verbatim
// as the job's request and handed back to the driver, and queue bookkeeping is none of
// the driver's business. Formatting it here (rather than taking the `plan:<id>` string
// from callers) is what makes a mistyped origin impossible — the backend rejects an
// unparseable one `400`, precisely because a run enqueued under a typo is one no halt
// would ever reach.
function originQuery(origin?: LaunchOrigin | null): string {
  if (!origin) return "";
  return `?origin=${encodeURIComponent(`${origin.kind}:${origin.id}`)}`;
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

// The SSE `event:` names on the console stream (`GET /notifications`), matching the
// backend's `STREAM_EVENT_*` constants. The stream is multiplexed, so every frame is
// named — there is no unnamed `message` frame and `EventSource.onmessage` never
// fires on it.
const STREAM_EVENT_HELLO = "stream";
const STREAM_EVENT_NOTIFICATION = "notification";
const STREAM_EVENT_RUN = "run";
const STREAM_EVENT_RESYNC = "resync";
const STREAM_EVENT_HEARTBEAT = "heartbeat";

// How long the console stream may go without a frame before it is treated as dead
// and reopened. The backend heartbeats every 15s, so this allows three missed
// beats — loose enough that a slow network or a briefly throttled background tab
// does not churn the connection, tight enough that a wedged stream is noticed in
// under a minute rather than never.
const STREAM_STALE_MS = 50_000;

// Backoff for reopening a stream we tore down ourselves, so a backend that is down
// or mid-rollout is not hammered. Capped rather than given up on: with no polling
// left, this connection is the console's only source of run updates.
const STREAM_REOPEN_BASE_MS = 1_000;
const STREAM_REOPEN_MAX_MS = 30_000;

// The topic-control path for one connected stream.
const topicsPath = (streamId: string): string =>
  `/notifications/${encodeURIComponent(streamId)}/topics`;

// The console's in-progress phase for a row of the active-run list. A terminal job
// never appears in that list, so the shared mapping's `null` is unreachable here;
// it falls back to "running" rather than dropping a row the backend just told us is
// in flight.
function mapActiveState(state: string): InProgressRun["state"] {
  return runPhase(state) ?? "running";
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

// Resolve the public snapshot bucket's read base URL from the backend's
// `GET /config`, or null when no bucket is configured (a single-box dev setup, or
// a backend that predates the field). Best-effort like the resolvers above: an
// unreachable backend resolves null, which reads the same as "no bucket" — a case's
// published asset-reference frames are then simply not offered, rather than
// resolved against a base that would 404.
export async function fetchSnapshotUrl(
  backendUrl: string,
): Promise<string | null> {
  try {
    const config = await getJson<ClientConfigResponse>(backendUrl, "/config");
    return config.snapshotUrl ?? null;
  } catch {
    return null;
  }
}

// The object key one published asset-reference file sits at inside the snapshot
// bucket, relative to its base: `media/references/<slug>/<version>/<variant>/<file>`,
// where `file` is `frames/<index>.png` or `frames/<index>.actions.json`.
//
// This MIRRORS the Rust helpers that write the objects — `reference_prefix` /
// `reference_image_key` / `reference_actions_key` in
// `crates/core/src/asset_reference.rs` — and must change with them. It is
// reconstructed here (rather than served per-frame) because the layout is
// deterministic: the backend sends only which frame indices exist. The static
// site's build-time plugin (`apps/site/vite-plugin-snapshot.ts`) reconstructs the
// same layout for the same reason; it cannot import this module, since it must not
// pull the React UI package into a Vite plugin.
export function referenceMediaKey(
  slug: string,
  version: string,
  variant: string,
  file: string,
): string {
  return `media/references/${slug}/${version}/${variant}/${file}`;
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

  // The console stream's per-connection state, shared by `subscribeToNotifications`
  // (which learns the id) and `setRunLifecycleEnabled` (which uses it). It lives on
  // the client rather than inside the subscription because the two are called from
  // different places at different times: the subscription is opened once for the
  // session by the notifications layer, while the topic is toggled by whichever page
  // is currently mounted.
  //
  // `streamId` is the id of the stream that is connected *right now*, or null while
  // disconnected. `runLifecycleWanted` is what the console last asked for, which
  // outlives any single connection and is re-applied to each new one.
  let streamId: string | null = null;
  let runLifecycleWanted = false;

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
      origin?: LaunchOrigin | null,
    ): Promise<string> {
      // Enqueue a run on the backend's job queue; the dispatcher creates the
      // driver Job. The body is the backend's `LaunchBody` (camelCase). The
      // backend gates `POST /jobs` on the launching account, so the signed-in
      // account's token rides along as `Authorization: Bearer` — without it the
      // enqueue is rejected `401`. The account is recorded on the job; `origin`,
      // when given, additionally records which plan or ladder asked for the run,
      // which is what puts it inside that plan's or ladder's halt scope.
      const ack = await postJson<LaunchAckResponse>(
        backendUrl,
        `/jobs${originQuery(origin)}`,
        launchBodyOf(config),
        token,
      );
      return ack.jobId;
    },

    async launchRunBatch(
      configs: LaunchConfig[],
      token?: string | null,
      origin?: LaunchOrigin | null,
    ): Promise<BatchLaunchResult[]> {
      // Enqueue the whole set in one `POST /jobs/batch` (same account gate as
      // `POST /jobs`) instead of a request per run — the fan-out a coverage
      // "trigger all missing" or a multi-combination new-run submit produces. An
      // empty set needs no round-trip. The ack returns one entry per run, aligned
      // by index, each an enqueued job id or a per-run rejection reason.
      // One `origin` attributes the whole batch — a batch is one decision by one
      // plan, ladder, or person; two origins mean two batches.
      if (configs.length === 0) return [];
      const ack = await postJson<LaunchBatchAckResponse>(
        backendUrl,
        `/jobs/batch${originQuery(origin)}`,
        { runs: configs.map(launchBodyOf) },
        token,
      );
      return ack.jobs.map((entry) => ({
        runId: entry.jobId,
        error: entry.error,
      }));
    },

    async launchGgRun(req: GgRunRequest, token: string): Promise<LaunchAck> {
      // Enqueue a gg run on its own endpoint (`POST /gg/runs`); the dispatcher
      // creates the gg driver Job. gg is configured by the request's capability
      // set rather than a `(harness, model, orchestrator)` tuple, so — unlike
      // `launchRun` — the `GgRunRequest` is already the exact wire body (camelCase)
      // and is posted verbatim. Same account gate as `POST /jobs`: the signed-in
      // account's token rides along as `Authorization: Bearer` (a missing/invalid
      // token is rejected `401`). Unlike `launchRun`, the whole ack is returned —
      // its `statusUrl`/`liveUrl` locate the run — since the console watches a gg
      // run through the ack's `jobId`.
      return postJson<LaunchAck>(backendUrl, "/gg/runs", req, token);
    },

    async getRun(runId: string): Promise<RunJob> {
      // The job status carries the record *id*, not the record; read the record
      // back from the run store whenever the job has one so the caller gets a
      // populated `RunJob`. That is not only the succeeded case: a failed job
      // retains the failure record its driver built, and a canceled one retains the
      // partial record for the killed run.
      const status = await getJson<JobStatusResponse>(
        backendUrl,
        `/jobs/${encodeURIComponent(runId)}`,
      );
      const state = mapJobState(status.state);
      let record: RunRecord | null = null;
      if (status.recordId) {
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
      // A supervised `EventSource`. The browser reconnects on its own after an
      // ordinary drop, which handles most faults — but not all of them, and the
      // console has no poll left to fall back on, so the two it misses are handled
      // here:
      //
      //   - **It gave up.** After enough failed attempts `readyState` settles on
      //     CLOSED and the browser stops retrying, permanently, with nothing but an
      //     `error` event to say so. Reopening is the only recovery.
      //   - **It thinks it is connected and is not.** A half-open socket — a laptop
      //     resumed from sleep, a NAT that dropped the flow — delivers no frames and
      //     raises no error. Nothing in the `EventSource` API reports this, which is
      //     why the backend emits a periodic `heartbeat` event: any frame at all
      //     rearms the watchdog below, and an overdue one means the stream is dead
      //     however healthy it claims to be.
      let source: EventSource | null = null;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      let retry: ReturnType<typeof setTimeout> | null = null;
      let attempt = 0;
      let unsubscribed = false;

      // The backend mints a fresh stream id per *connection*, so any reconnect —
      // the browser's or ours — lands on a new stream with default topics. Both
      // facts live here: the current id (null while disconnected), and what the
      // console last asked for, which is re-applied to each new stream as its hello
      // frame arrives. Without that replay a console that was watching in-flight
      // runs would come back from a blip subscribed to nothing, with no error to
      // notice.
      const applyTopics = () => {
        if (!streamId) return;
        void putVoid(backendUrl, topicsPath(streamId), {
          runs: runLifecycleWanted,
        }).catch(() => {
          // The stream died between the hello frame and this call. Nothing to do:
          // a reconnect is already under way and the next hello frame re-applies
          // the same intent.
        });
      };

      const clearTimers = () => {
        if (watchdog !== null) clearTimeout(watchdog);
        if (retry !== null) clearTimeout(retry);
        watchdog = null;
        retry = null;
      };

      // Rearmed by every frame, whatever kind. Firing means the backend has not
      // even managed a heartbeat in well over its interval, so the connection is
      // gone whatever `readyState` says.
      const armWatchdog = () => {
        if (watchdog !== null) clearTimeout(watchdog);
        watchdog = setTimeout(() => reopen(), STREAM_STALE_MS);
      };

      // Tear the current connection down and open a new one, backing off so a
      // backend that is down (or rolling) is not hammered. Capped, because the
      // console is useless until this succeeds — it must keep trying.
      const reopen = () => {
        if (unsubscribed) return;
        clearTimers();
        source?.close();
        source = null;
        streamId = null;
        const delay = Math.min(
          STREAM_REOPEN_BASE_MS * 2 ** attempt,
          STREAM_REOPEN_MAX_MS,
        );
        attempt += 1;
        retry = setTimeout(open, delay);
      };

      const open = () => {
        if (unsubscribed) return;
        const current = new EventSource(joinUrl(backendUrl, "/notifications"));
        source = current;
        armWatchdog();

        // Every frame is evidence the stream is alive, so rearm on all of them —
        // including the heartbeat, which carries nothing else.
        const onFrame =
          (handle: (event: MessageEvent) => void) => (event: Event) => {
            armWatchdog();
            handle(event as MessageEvent);
          };

        current.addEventListener(
          STREAM_EVENT_HELLO,
          onFrame((event) => {
            try {
              streamId = (JSON.parse(event.data) as StreamOpened).streamId;
            } catch {
              return;
            }
            applyTopics();
          }),
        );

        current.addEventListener(
          STREAM_EVENT_NOTIFICATION,
          onFrame((event) => {
            try {
              handlers.onNotification(
                JSON.parse(event.data) as RunNotification,
              );
            } catch {
              // A malformed payload shouldn't tear down the channel; drop it.
            }
          }),
        );

        current.addEventListener(
          STREAM_EVENT_RUN,
          onFrame((event) => {
            try {
              handlers.onRunLifecycle?.(
                JSON.parse(event.data) as RunLifecycleEvent,
              );
            } catch {
              // As above — one bad frame is not worth the connection.
            }
          }),
        );

        // The backend dropped messages for this client because it fell behind. The
        // stream keeps no backlog, so they are gone; the only recovery is to
        // re-read the authoritative lists.
        current.addEventListener(
          STREAM_EVENT_RESYNC,
          onFrame(() => handlers.onResync?.()),
        );

        current.addEventListener(
          STREAM_EVENT_HEARTBEAT,
          onFrame(() => {}),
        );

        // Fires on connect, whether this was the first attempt, the browser's own
        // reconnect, or ours. Because the feed carries no backlog, anything
        // published while the channel was down is gone; the console reconciles
        // against the active list on each open to recover it.
        current.onopen = () => {
          attempt = 0;
          armWatchdog();
          handlers.onOpen?.();
        };

        current.onerror = (event) => {
          // The stream this id named is gone. Clearing it keeps a topic change
          // made while disconnected from PUTting against a dead stream; the next
          // hello frame supplies the new id.
          streamId = null;
          handlers.onError?.(event);
          // CLOSED means the browser has given up for good — it will not retry, so
          // nothing reopens this but us. CONNECTING means it is already retrying,
          // and racing it would only multiply connections; the watchdog is the
          // backstop if that retry never lands.
          if (current.readyState === EventSource.CLOSED) reopen();
        };
      };

      open();

      return () => {
        unsubscribed = true;
        clearTimers();
        streamId = null;
        source?.close();
        source = null;
      };
    },

    async setRunLifecycleEnabled(enabled: boolean): Promise<void> {
      runLifecycleWanted = enabled;
      // Record the intent even with no stream open — the console toggles this on
      // navigation, which can easily happen before the stream connects or during a
      // reconnect, and the hello-frame handler replays whatever was last wanted.
      if (!streamId) return;
      await putVoid(backendUrl, topicsPath(streamId), { runs: enabled });
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
          aesthetics: review.aesthetics,
          writeup: review.writeup,
          checklist: review.checklist,
          // Only meaningful on an edit; the backend ignores it on a first submission.
          editNote: review.editNote,
        },
        token,
      );
    },

    enqueuePublish(id: string, token: string): Promise<PublishEnqueued> {
      return enqueuePublish(backendUrl, id, token);
    },

    async publish(
      id: string,
      token: string,
      onProgress?: (progress: PublishProgress) => void,
    ): Promise<PublishResult> {
      // Publishing is asynchronous: the POST only gates and enqueues. Subscribe to
      // the live NDJSON stream it points at and resolve once that reports the
      // terminal result — never poll.
      const ack = await enqueuePublish(backendUrl, id, token);
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

    async cancelWaitingRuns(token: string): Promise<BulkCancelOut> {
      // `POST /jobs/cancel-waiting` — every `queued` and `pending` job, whoever
      // launched it. The backend names these states "waiting" rather than "pending"
      // because `pending` is one of them (a run held back by its harness's
      // parallelism cap), and the console surfaces that state separately.
      return postJson<BulkCancelOut>(
        backendUrl,
        "/jobs/cancel-waiting",
        {},
        token,
      );
    },

    async cancelActiveRuns(token: string): Promise<BulkCancelOut> {
      // `POST /jobs/cancel-active` — every `dispatched`, `starting`, and `running`
      // job. It deliberately leaves the waiting queue alone, so the dispatcher
      // resumes claiming from it immediately; `cancelAllRuns` is the one that stops.
      return postJson<BulkCancelOut>(
        backendUrl,
        "/jobs/cancel-active",
        {},
        token,
      );
    },

    async cancelAllRuns(token: string): Promise<BulkCancelOut> {
      // `POST /jobs/cancel-all` — both sets in one atomic sweep rather than two
      // calls, so no queued job can be claimed into execution between them.
      return postJson<BulkCancelOut>(backendUrl, "/jobs/cancel-all", {}, token);
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
    showcaseMediaUrl(runId: string, file: string): string | null {
      return mediaUrl(runId, "showcase", file);
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
    // The connection can drop mid-body without the run being over — a
    // port-forward or proxy resetting it, a browser giving up on a stalled read
    // (Chromium reports either as `TypeError: Error in input stream`). That is a
    // transport fault, not a run outcome, so it is never surfaced as one: the job
    // is re-read, and a run that has since ended resolves to its real outcome
    // below, while a run still going is re-joined. The backend replays the whole
    // backlog to a new subscriber, so the events already forwarded are skipped by
    // count — the backlog is append-only and in order, which makes the count the
    // resume cursor.
    const cursor: LiveCursor = { delivered: 0 };
    let status: JobStatusResponse | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        await readLiveStream(
          backendUrl,
          runId,
          handlers,
          controller.signal,
          cursor,
        );
        break;
      } catch (e) {
        if (controller.signal.aborted) return;
        status = await getJson<JobStatusResponse>(
          backendUrl,
          `/jobs/${encodeURIComponent(runId)}`,
        ).catch(() => null);
        if (status && mapJobState(status.state) !== "running") break;
        if (attempt >= LIVE_RECONNECT_ATTEMPTS) throw e;
        status = null;
        await delay(LIVE_RECONNECT_DELAY_MS, controller.signal);
      }
    }

    // The stream closes when the run reaches a terminal state; read the job back
    // to learn how it ended and (on success) the produced record to open.
    status ??= await getJson<JobStatusResponse>(
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
      //
      // The killed run's record is not attached yet: the backend closes this stream
      // the instant the cancel lands, and the driver only posts the record once it
      // has actually stopped the harness a few seconds later. Wait briefly for it so
      // the monitor can offer the retained run rather than dead-ending, and settle
      // for `null` if it never arrives (the driver died with the pod, say) — the run
      // list is the fallback either way.
      const recordId = await awaitCanceledRecordId(backendUrl, runId);
      const record = recordId
        ? (await resolveBuild(await backend.readRun(recordId))).record
        : null;
      handlers.onDone({
        kind: "canceled",
        message: status.detail ?? "Run canceled.",
        record,
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

// How many times a dropped live stream is re-joined before the drop is reported,
// and the pause before each attempt. The drops seen in practice are momentary
// (a port-forward resetting one connection), so a short pause is enough; the
// cap keeps a backend that is genuinely unreachable from being hammered forever.
const LIVE_RECONNECT_ATTEMPTS = 5;
const LIVE_RECONNECT_DELAY_MS = 1_000;

// How far into a job's event backlog a subscriber has forwarded — the resume
// point for a re-joined stream. Advanced in place as lines are forwarded, so it
// stays correct when the read fails partway through.
interface LiveCursor {
  delivered: number;
}

// Open `GET /jobs/{id}/live` and forward every line until the backend closes it,
// skipping the first `cursor.delivered` events (a re-joined stream's replayed
// backlog) and advancing the cursor past each event forwarded. Rejects with the
// transport's error when the read fails before the backend closed the stream.
async function readLiveStream(
  backendUrl: string,
  runId: string,
  handlers: RunSubscription,
  signal: AbortSignal,
  cursor: LiveCursor,
): Promise<void> {
  const res = await fetch(
    joinUrl(backendUrl, `/jobs/${encodeURIComponent(runId)}/live`),
    {
      headers: { accept: "application/x-ndjson" },
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`live stream failed: ${res.status}`);
  }
  // Previews are not counted: the backend replays only the latest frame per
  // kind, and re-delivering one is harmless.
  let seen = 0;
  const forward = (line: string): void => {
    if (isPreviewLine(line)) {
      emitLine(line, handlers);
      return;
    }
    seen += 1;
    if (seen <= cursor.delivered) return;
    emitLine(line, handlers);
    cursor.delivered = seen;
  };
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
      if (line) forward(line);
    }
  }
  const tail = buffer.trim();
  if (tail) forward(tail);
}

// Whether a live-stream line is an asset-preview frame rather than an event.
function isPreviewLine(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "asset_preview"
    );
  } catch {
    return false;
  }
}

// Wait `ms`, resolving early (without error) if `signal` aborts meanwhile so an
// unsubscribed monitor never lingers on a reconnect pause.
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// How long the monitor waits for a killed run's record to be attached, and how
// often it re-reads the job while it waits. The driver notices a cancellation on
// its own poll (a few seconds), stops the harness, uploads whatever partial
// artifacts it collected, and only then posts the record — so the window is
// seconds, not instant. The cap keeps a driver that died with its pod from hanging
// the monitor on a record that is never coming.
const CANCELED_RECORD_WAIT_MS = 30_000;
const CANCELED_RECORD_POLL_MS = 1_000;

// Poll a canceled job for the id of the partial record its driver hands back, up to
// {@link CANCELED_RECORD_WAIT_MS}. Resolves to the id once it lands, or `null` if
// the wait runs out (or the job cannot be re-read — a transient failure here is not
// worth surfacing over an already-terminal run).
async function awaitCanceledRecordId(
  backendUrl: string,
  runId: string,
): Promise<string | null> {
  const deadline = Date.now() + CANCELED_RECORD_WAIT_MS;
  for (;;) {
    try {
      const status = await getJson<JobStatusResponse>(
        backendUrl,
        `/jobs/${encodeURIComponent(runId)}`,
      );
      if (status.recordId) return status.recordId;
    } catch {
      // Keep waiting; the next tick re-reads.
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) =>
      setTimeout(resolve, CANCELED_RECORD_POLL_MS),
    );
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

// Gate and enqueue a publish (`POST /runs/{id}/publish`, Bearer). The backend
// refuses a run that cannot be published (no reviews, an infrastructure failure)
// here, synchronously; on acceptance it answers `202` with the queued publish job
// and the live URL its release can be watched on. Shared by the transport's
// enqueue-only method and by `publish`, which goes on to watch that stream, so the
// two can never gate differently.
function enqueuePublish(
  backendUrl: string,
  id: string,
  token: string,
): Promise<PublishEnqueued> {
  return postJson<PublishEnqueued>(
    backendUrl,
    `/runs/${encodeURIComponent(id)}/publish`,
    {},
    token,
  );
}

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
      "The publish stream ended before reporting a result. Retry to observe it.",
    );
  }
  return terminal;
}
