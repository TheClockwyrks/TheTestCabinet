// The BackendClient over HTTP, against the backend's REST API
// (components/backend/api.md). The backend is the source of truth for the
// catalog, definitions, and published results — never a worker.
//
// The backend is not implemented yet (its overview marks it as the next
// milestone), so these calls are coded against the documented contract and fail
// gracefully (the console surfaces the error) until a backend is reachable.
import type {
  BackendClient,
} from "@test-cabinet/ui/client";
import type {
  BackendIdentity,
  Domain,
  HarnessEvent,
  Model,
  ProgressCallback,
  ReviewItem,
  RunEventStreams,
  RunPage,
  Specification,
  SpecDocument,
  StoredReview,
  StoredRun,
  TestCase,
  TestType,
  VersionInfo,
} from "@test-cabinet/ui/client";
import type { AssetSheet, RunRecord } from "@test-cabinet/run-record";
import { getJson, getJsonStreamed, getText, joinUrl } from "./http";

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
  maxRuntimeSeconds: number;
  testType: TestType;
  commonSpecs?: SpecDescriptor[];
  commonReviewItems?: ReviewItem[];
  // References every variant shares (rendered from the `_common` scope).
  commonReferences?: ReferenceDescriptor[];
  // The case's scoring domains (case-level).
  domains?: Domain[];
  // The sprite-sheet frame grid and named sequences (camelCase `SheetSpec`),
  // present only for a sprite-sheet case. Its shape matches the run-record
  // `AssetSheet`, so it is carried through verbatim.
  sheet?: AssetSheet | null;
  variants: {
    slug: string;
    name: string;
    description: string | null;
    // The variant's prompt, rendered by the backend as a real run receives it.
    prompt: string;
    specs?: SpecDescriptor[];
    reviewItems?: ReviewItem[];
    references?: ReferenceDescriptor[];
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

// The backend serves the record with its links already populated, so the run's
// id and links are taken from the record itself. Every review is carried through
// with its attribution; a backend-served run is always a published one.
function toStoredRun(r: StoredRunResponse): StoredRun {
  const record = r.links
    ? { ...r.record, links: { ...r.record.links, ...r.links } }
    : r.record;
  const reviews: StoredReview[] = (r.reviews ?? []).map((rv) => ({
    reviewerId: rv.reviewerId,
    reviewer: rv.reviewer,
    username: rv.username ?? null,
    ratings: rv.ratings,
    writeup: rv.writeup,
    checklist: rv.checklist,
    reviewedAt: rv.reviewedAt ?? null,
  }));
  return { id: record.id, record, reviews, published: r.published ?? true };
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
        maxRuntimeSeconds: r.maxRuntimeSeconds,
        testType: r.testType,
        domains: r.domains ?? [],
        sheet: r.sheet ?? null,
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
          // follow. They carry the point weights used to score runs.
          reviewItems: [
            ...(r.commonReviewItems ?? []),
            ...(v.reviewItems ?? []),
          ],
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
      return [...(r.commonReviewItems ?? []), ...(chosen?.reviewItems ?? [])];
    },

    async listModels(): Promise<Model[]> {
      // The backend HTTP contract defines no model catalog endpoint; the run
      // screen treats the model id as free text, so report none. The gallery's
      // rich model metadata comes from the bundled curated catalog instead.
      return [];
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
