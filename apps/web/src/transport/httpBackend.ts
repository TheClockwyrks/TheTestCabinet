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
  HarnessInfo,
  Model,
  Specification,
  SpecDocument,
  TestCase,
  VersionInfo,
} from "@test-cabinet/ui/client";
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

// One entry of `GET /test-cases`.
interface CatalogEntry {
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
  variants: {
    slug: string;
    name: string;
    description: string | null;
    specs?: SpecDescriptor[];
  }[];
}

// One entry of `GET /containers`.
interface ContainerRef {
  harness: string;
  reference: string;
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
      const entries = await getJson<CatalogEntry[]>(baseUrl, "/test-cases");
      return entries.map((e) => ({ slug: e.slug, versions: e.versions }));
    },

    async listVersions(slug: string): Promise<string[]> {
      // The endpoint may return a bare array or an object with `versions`.
      const body = await getJson<string[] | { versions: string[] }>(
        baseUrl,
        `/test-cases/${encodeURIComponent(slug)}/versions`,
      );
      return Array.isArray(body) ? body : body.versions;
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

    async listHarnesses(): Promise<HarnessInfo[]> {
      const refs = await getJson<ContainerRef[]>(baseUrl, "/containers");
      return refs.map((c) => ({ slug: c.harness, displayName: c.harness }));
    },

    async listModels(): Promise<Model[]> {
      // The backend HTTP contract defines no model catalog endpoint; the run
      // screen treats the model id as free text, so report none.
      return [];
    },
  };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
