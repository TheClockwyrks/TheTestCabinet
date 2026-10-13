import type { RunRecord } from "@clockwyrks/run-record";
import type { StoredReview, WorkspaceFileRef } from "@clockwyrks/ui/client";
import { readOutcome } from "@clockwyrks/ui/client";
import type {
  SeededInput,
  TestCaseDetail,
  TestCaseSummary,
  VariantSummary,
} from "@clockwyrks/ui/app";

// The static files the build writes beside the bundle, and the one place the
// gallery reads them from.
//
// The bundle inlines only the INDEX of the published snapshot — what a listing
// shows for every run and every case. Everything that describes one run or one
// case in detail is a file of its own, written by vite-plugin-snapshot and
// deployed with the site, so it is fetched from the site's own origin when a
// page of that run or case opens:
//
//   runs/<id>.json                 one run: its record, reviews and media
//   run-events/<id>.json           one run's event log
//   cases/<slug>.json              one case: what spans its versions
//   cases/<slug>/<version>.json    one case version: its variants and media
//
// The shapes below MIRROR the `Assembled*` interfaces in vite-plugin-snapshot.ts,
// restated in the app's own types because the plugin runs in the Vite config,
// outside the bundle.

/**
 * Where one run's published media is, each map keyed by the file name the UI
 * requests and holding the absolute URL of the published object.
 */
export interface RunMedia {
  /** Proof media, keyed by served file name (`<proof-id>.<ext>`). */
  proof: Record<string, string>;
  /** Asset-generation media, keyed by served file name (`regenerated.png`, …). */
  asset: Record<string, string>;
  /** The *actual* validation media, keyed by the flat `<item>__<output>.<ext>`
   * name. A recording's shared image store is under {@link validationStorePrefix}. */
  validation: Record<string, string>;
  /** Where the run's shared image store lives, as an absolute URL prefix, or null
   * when the run published none. */
  validationStorePrefix: string | null;
  /** Showcase media, keyed by the recorded file name. */
  showcase: Record<string, string>;
  /** The run's unbounded code-analysis document, or null for a run that was never
   * analysed. */
  codeAnalysisUrl: string | null;
}

/** `runs/<id>.json`: everything the gallery reads about one run. */
export interface RunFile {
  record: RunRecord;
  reviews: StoredReview[];
  media: RunMedia;
}

/**
 * `cases/<slug>.json`: the part of a {@link TestCaseDetail} that spans the case's
 * versions. The listing fields are the index's, and the variants are the latest
 * version's file's.
 */
export type CaseDetailFile = Omit<
  TestCaseDetail,
  keyof TestCaseSummary | "variants"
>;

/**
 * One variant as a case version's file carries it: the gallery's
 * {@link VariantSummary} (the engineless rendering) plus the same prompt and
 * specs re-rendered for each engine the version declares that vendors a runtime.
 * A case's prompt and `.hbs` specs branch on the selected engine, so a run's
 * Inputs tab reads the entry for the engine its run recorded.
 */
export interface SnapshotVariant extends VariantSummary {
  engineRenderings: Record<
    string,
    {
      prompt: string;
      seededInputs: SeededInput[];
      /** The variant's effective starter-workspace set for this engine — a
       * starter project is written against a runtime, so each rendering carries
       * its own (the engineless set is the variant's own `workspace`). */
      workspace: WorkspaceFileRef[];
    }
  >;
}

/**
 * Where one case version's media is, each inner map keyed by the file name the
 * UI requests and holding the absolute URL of the published object.
 */
export interface CaseVersionMedia {
  /** The *baseline* validation media (the reference implementation's declared
   * outputs), keyed by `<engine>/<variant>` then the flat
   * `<item>__<output>.<ext>` name. */
  baselines: Record<string, Record<string, string>>;
  /** Where each committed baseline's image store lives, as an absolute URL
   * prefix, keyed by the same `<engine>/<variant>`. */
  baselineStorePrefixes: Record<string, string>;
  /** The authored showcase media, keyed by variant then the authored file name. */
  showcase: Record<string, Record<string, string>>;
  /** The asset-reference media, keyed by variant then the file below that
   * variant's prefix (`frames/<index>.png`, `frames/<index>.actions.json`). */
  reference: Record<string, Record<string, string>>;
}

/** `cases/<slug>/<version>.json`: one version of a case. */
export interface CaseVersionFile {
  variants: SnapshotVariant[];
  media: CaseVersionMedia;
}

/**
 * Whether a response is the application shell rather than the file asked for.
 *
 * The site is a client-routed single-page app with no `404.html`, so its host
 * answers a path it holds no file for with `index.html` and a 200 (see
 * `public/_redirects`), and so do `vite dev` and `vite preview`. For a data file
 * that answer means the deployment holds no such file — an absence, exactly as a
 * 404 is — and it must be recognized before the body is parsed as the JSON it
 * is not.
 */
function isAppShell(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

export interface StaticFiles {
  /**
   * Fetch one static file, or null when the deployment holds no such file.
   *
   * Absence is the host's own 404 or the application shell served in the file's
   * place. Every other outcome — offline, a 500, a body that will not parse —
   * is a read that FAILED and throws, so a surface reports the failure instead
   * of naming an entity as not found (see `readOutcome`).
   */
  response(path: string, subject: string): Promise<Response | null>;
  /** One run's file. Its media is {@link runMedia}'s from the moment this resolves. */
  loadRun(runId: string): Promise<RunFile | null>;
  /** The media of a run {@link loadRun} has resolved, or undefined before that. */
  runMedia(runId: string): RunMedia | undefined;
  /** One case's detail file. */
  loadCaseDetail(slug: string): Promise<CaseDetailFile | null>;
  /**
   * One case version's file. Concurrent and later calls share one request; a
   * failed read is forgotten, so the next call tries again.
   */
  loadCaseVersion(
    slug: string,
    version: string,
  ): Promise<CaseVersionFile | null>;
  /** A case version {@link loadCaseVersion} has resolved, or undefined before
   * that — and for a version the deployment turned out not to hold. */
  caseVersion(slug: string, version: string): CaseVersionFile | undefined;
  /**
   * Start loading a case version in the background, for a synchronous resolver
   * that was asked about a version nobody has loaded yet: it answers null now and
   * the right answer once {@link subscribe}'s listener fires. A version whose
   * read failed is asked for again this way only after
   * {@link REQUEST_RETRY_MS}, so a render that keeps asking cannot turn one
   * failure into a request per render, and a passing fault still heals.
   */
  requestCaseVersion(slug: string, version: string): void;
  /** Be told when a case version has loaded. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** How many case versions have loaded — a value that changes exactly when
   * {@link caseVersion} can answer differently. */
  revision(): number;
}

/** How long a background request that failed waits before it may be repeated. */
export const REQUEST_RETRY_MS = 30_000;

/**
 * The reader of the build's static files under `baseUrl` (the site's base path,
 * ending in `/`).
 *
 * A run's media and a case version's file are kept for the life of the page once
 * loaded. They are what the gallery's media resolvers answer from, and those are
 * synchronous: a surface holding a run or a variant asks for a URL while it
 * renders, and the file it got that run or variant from is what holds the answer.
 */
export function createStaticFiles(
  baseUrl: string,
  fetchFile: (url: string) => Promise<Response> = (url) => fetch(url),
): StaticFiles {
  const runMedia = new Map<string, RunMedia>();
  const caseVersions = new Map<string, CaseVersionFile>();
  const caseVersionLoads = new Map<string, Promise<CaseVersionFile | null>>();
  const failedRequests = new Map<string, number>();
  const listeners = new Set<() => void>();
  let revision = 0;

  const response = async (
    path: string,
    subject: string,
  ): Promise<Response | null> => {
    const answer = await fetchFile(`${baseUrl}${path}`);
    if (readOutcome(answer, subject) === "absent") return null;
    return isAppShell(answer) ? null : answer;
  };

  const json = async <T>(path: string, subject: string): Promise<T | null> => {
    const answer = await response(path, subject);
    return answer === null ? null : ((await answer.json()) as T);
  };

  const loadCaseVersion = (
    slug: string,
    version: string,
  ): Promise<CaseVersionFile | null> => {
    const key = `${slug}/${version}`;
    const pending = caseVersionLoads.get(key);
    if (pending) return pending;
    const load = json<CaseVersionFile>(
      `cases/${encodeURIComponent(slug)}/${encodeURIComponent(version)}.json`,
      `version ${version} of case ${slug}`,
    ).then(
      (file) => {
        if (file !== null) {
          caseVersions.set(key, file);
          revision += 1;
          for (const listener of listeners) listener();
        }
        return file;
      },
      (error: unknown) => {
        caseVersionLoads.delete(key);
        throw error;
      },
    );
    caseVersionLoads.set(key, load);
    return load;
  };

  return {
    response,
    async loadRun(runId) {
      const file = await json<RunFile>(
        `runs/${encodeURIComponent(runId)}.json`,
        `run ${runId}`,
      );
      if (file !== null) runMedia.set(runId, file.media);
      return file;
    },
    runMedia: (runId) => runMedia.get(runId),
    loadCaseDetail: (slug) =>
      json<CaseDetailFile>(
        `cases/${encodeURIComponent(slug)}.json`,
        `case ${slug}`,
      ),
    loadCaseVersion,
    caseVersion: (slug, version) => caseVersions.get(`${slug}/${version}`),
    requestCaseVersion(slug, version) {
      const key = `${slug}/${version}`;
      if (caseVersionLoads.has(key)) return;
      const failedAt = failedRequests.get(key);
      if (failedAt !== undefined && Date.now() - failedAt < REQUEST_RETRY_MS) {
        return;
      }
      loadCaseVersion(slug, version).catch(() => {
        failedRequests.set(key, Date.now());
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
  };
}
