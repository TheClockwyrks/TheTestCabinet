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
  HarnessEvent,
  Model,
  ReviewDocument,
  ReviewItem,
  RunEventStreams,
  RunPage,
  Specification,
  SpecDocument,
  StoredRun,
  TestCase,
  VersionInfo,
} from "@test-cabinet/ui/client";
import type { RunRecord } from "@test-cabinet/run-record";
import { getJson, getText } from "./http";

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
  commonSpecs?: SpecDescriptor[];
  commonReviewItems?: ReviewItem[];
  variants: {
    slug: string;
    name: string;
    description: string | null;
    specs?: SpecDescriptor[];
    reviewItems?: ReviewItem[];
  }[];
}

// `GET /runs/{id}` (and each entry of `GET /runs`): a stored run — its full
// record (links populated), its review, and the resolved links.
interface StoredRunResponse {
  record: RunRecord;
  review: ReviewDocument | null;
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
// id and links are taken from the record itself.
function toStoredRun(r: StoredRunResponse): StoredRun {
  const record = r.links
    ? { ...r.record, links: { ...r.record.links, ...r.links } }
    : r.record;
  return { id: record.id, record, review: r.review ?? null };
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
        variants: r.variants.map((v) => ({
          slug: v.slug,
          name: v.name,
          description: v.description,
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

    async readRunEvents(id: string): Promise<RunEventStreams> {
      // The backend serves the published run's normalized event stream as a JSON
      // array (empty when the run recorded none). Raw harness output is never
      // published, so it is unavailable here.
      const events = await getJson<HarnessEvent[]>(
        baseUrl,
        `/runs/${encodeURIComponent(id)}/events`,
      );
      return { events, raw: null };
    },
  };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
