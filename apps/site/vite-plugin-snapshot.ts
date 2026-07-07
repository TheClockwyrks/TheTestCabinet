import type { Plugin } from "vite";
import type { AssetKind, TestType } from "@test-cabinet/run-record";

// Build-time data source: the public R2 snapshot.
//
// The site is fully static and has no live dependency on the backend. The
// backend exports a read-only public snapshot to a Cloudflare R2 bucket
// (see design/v0.2.0-contracts.md §3); this plugin fetches that snapshot once,
// at build time, and exposes it to the app as the virtual module
// `virtual:tcab-snapshot`. The fetched data is inlined into the bundle, so the
// shipped output is static — nothing reaches the backend or R2 at runtime.
//
// The snapshot base URL is read from `TCAB_SNAPSHOT_URL` (the public base under
// which `index.json` is served, e.g. `https://snapshot.testcabinet.ai`). When
// it is unset — local dev, or a CI build with no snapshot wired up — the virtual
// module resolves to an empty dataset and the build still succeeds. The
// `localRuns` dev plugin remains the source of on-disk, unpublished runs during
// `vite dev`; this plugin contributes the *published* dataset.
//
// A set URL whose `index.json` 404s is the *fresh-deployment* case: the bucket
// exists but nothing has been published yet (`index.json` is the atomic pointer
// the backend writes last, only on a publish). That, too, resolves to an empty
// dataset and succeeds — otherwise every gallery build would fail until the very
// first publish. Only a *reachable-but-broken* snapshot (a network error, a 5xx,
// or a sub-file that `index.json` references but is missing) fails the build.

const VIRTUAL_ID = "virtual:tcab-snapshot";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

// ---- Snapshot wire shapes (subset of design/v0.2.0-contracts.md §3) ----------

interface SnapshotIndex {
  schemaVersion: number;
  snapshotId: string;
  generatedAt: string;
  runCount: number;
  runsKey: string;
  runsPrefix: string;
  casesPrefix: string;
}

interface SnapshotRunsFile {
  schemaVersion: number;
  runs: SnapshotRunSummary[];
}

interface SnapshotRunSummary {
  id: string;
  subject: {
    testCaseSlug: string;
    testCaseVersion: string;
  };
  // Aggregate verdict across the run's reviews: the worst rating any reviewer
  // gave any domain, and how many reviews back it. Present on the index summary
  // (the per-run file carries the full reviews). Optional for older snapshots.
  rating?: string | null;
  reviewCount?: number;
}

interface SnapshotReviewVerdict {
  id: string;
  status: string;
  note?: string;
}

interface SnapshotDomainRating {
  domain: string;
  rating: string;
}

// One review entry in a run's `reviews[]` array: the reviewer's verdict plus
// attribution (the public snapshot exposes the display name and id, not the
// username). A run can carry more than one.
interface SnapshotReview {
  reviewerId?: string;
  reviewer?: string;
  ratings: SnapshotDomainRating[];
  writeup: string;
  checklist?: SnapshotReviewVerdict[];
  reviewedAt?: string | null;
}

// `runs/<run-id>.json`: the full run record plus its review and links, and the
// recorded normalized event stream when the run captured one (raw harness output
// is never published). The events are emitted as a separate per-run static asset
// rather than inlined into the bundle, so the gallery JS doesn't carry every
// run's full event log.
interface SnapshotRunFile {
  schemaVersion: number;
  record: unknown; // a full RunRecord (camelCase, links populated)
  // Every review submitted against the run (one per reviewer). Only published
  // runs appear in the snapshot, and the publish gate requires at least one.
  reviews: SnapshotReview[];
  links?: { sourceRepo: string | null; playableBuild: string | null };
  events?: unknown; // a JSON array of normalized HarnessEvents, when present
  // The run's uploaded proof-of-implementation media, named by snapshot-relative
  // key. Optional for snapshots written before proofs existed.
  proofMedia?: Array<{ id: string; kind: "image" | "video"; key: string }>;
  // An asset-generation run's media (regenerated/preview/target image + action
  // log), keyed by served file name (`regenerated.png`, `preview.png`,
  // `target.png`, `actions.json`). Absent for a non-asset-generation run and for
  // snapshots written before asset generation existed.
  assetMedia?: Array<{ file: string; key: string }>;
}

// `cases/<slug>/<version>.json`: the site-facing slice of a test-case version.
interface SnapshotCaseFile {
  schemaVersion: number;
  slug: string;
  version: string;
  name: string;
  // The case's test type. Optional for snapshots written before it was published;
  // defaults to "end-to-end" when absent.
  testType?: TestType;
  // The asset shape an asset-generation case produces, partitioning the catalog's
  // 2D / 3D / Particle / Audio tabs. Optional for snapshots written before it was
  // published; treated as `sprite` when absent.
  assetKind?: AssetKind;
  difficulty: string;
  tags: string[];
  summary: string | null;
  description: string | null;
  // This version's own changelog entry (its `changelog.md` body). Optional for
  // snapshots written before changelogs existed.
  changelog?: string | null;
  variants: Array<{
    slug: string;
    name: string;
    description: string | null;
    // The variant's prompt, rendered by the backend as a real run receives it.
    prompt: string;
    // The variant's own seeded spec files (additive to the common ones), bodies
    // inlined. Optional for snapshots written before specs were inlined.
    seededInputs?: SnapshotSeededInput[];
    // The variant's own reviewer checklist items (additive to the common ones).
    reviewItems?: SnapshotReviewItem[];
    // The variant's own scoring domains (additive to the common ones), rated only
    // when this variant is selected.
    domains?: SnapshotDomain[];
  }>;
  checks?: Array<{ view: string; name: string; referenceView: string | null }>;
  // Seeded spec files shared by every variant, bodies inlined. Optional for
  // snapshots written before specs were inlined.
  commonSeededInputs?: SnapshotSeededInput[];
  // Reviewer checklist items shared by every variant, with point weights.
  commonReviewItems?: SnapshotReviewItem[];
  // The case's common scoring domains (shared by every variant; a variant's own
  // additive domains ride on each variant's `domains`).
  domains?: SnapshotDomain[];
  // Optional: reference screenshots exposed as snapshot-relative keys. The
  // contract permits emitting these per case; when present we resolve them to
  // absolute URLs so the References tab can show baselines.
  references?: Array<{
    variant: string | null; // null/`_common` => shown on every variant
    view: string;
    // How the reference is produced: rendered mockup, static image, or static
    // video. Optional for snapshots written before the field existed.
    kind?: "rendered" | "image" | "video";
    key: string; // snapshot-relative object key
  }>;
}

// One seeded spec file inlined in case metadata: the run-workspace path it lands
// at and its text body. The public snapshot inlines these (bodies and all) so the
// fully static site can show the exact specs a run is seeded with.
interface SnapshotSeededInput {
  path: string;
  text: string;
}

interface SnapshotReviewItem {
  id: string;
  title: string;
  text: string;
  reference?: string | null;
  proof?: string | null;
  sequences?: string[];
  frames?: number[];
  weight: number;
  domain?: string | null;
}

interface SnapshotDomain {
  id: string;
  name: string;
  description: string;
}

// ---- The shape the app consumes (mirrors src/data/testCases.ts) -------------

// One assembled review the app consumes (the gallery's `StoredReview`). The
// public snapshot carries the display name + id, not the username.
interface AssembledReview {
  reviewerId: string;
  reviewer: string;
  ratings: SnapshotDomainRating[];
  writeup: string;
  checklist: SnapshotReviewVerdict[];
  reviewedAt: string | null;
}

interface AssembledSnapshot {
  // Verbatim RunRecord blobs, newest first (the snapshot's `runs/<id>.json`
  // `record`). The app types these as RunRecord[].
  runs: unknown[];
  // `writeups/<runId>` framing reconstructed from each run's reviews (the
  // *aggregate* writeup when there are several), keyed by run id — the same
  // `---\nrating: …\n---\n\n<body>` form the app parses for the cards/badges.
  writeups: Record<string, string>;
  // Each run's individual reviews, keyed by run id — the app's `reviewsFor(runId)`
  // reads this for the run-detail per-reviewer breakdown and the aggregate score.
  reviews: Record<string, AssembledReview[]>;
  // Test-case metadata, mapped to the app's TestCaseSummary shape.
  testCases: AssembledTestCase[];
  // Resolved proof media URLs, keyed by run id then by served file name
  // (`<proof-id>.<ext>`). The app's `proofMediaUrl(runId, file)` reads this.
  proofMediaUrls: Record<string, Record<string, string>>;
  // Resolved asset-generation media URLs, keyed by run id then by served file name
  // (`regenerated.png`, `preview.png`, `target.png`, `actions.json`). The app's
  // `assetMediaUrl(runId, file)` reads this.
  assetMediaUrls: Record<string, Record<string, string>>;
}

interface AssembledReference {
  view: string;
  kind: "image" | "video";
  url: string;
}

interface AssembledReviewItem {
  id: string;
  title: string;
  text: string;
  reference: string | null;
  proof: string | null;
  sequences: string[];
  frames: number[];
  weight: number;
  domain: string | null;
}

interface AssembledDomain {
  id: string;
  name: string;
  description: string;
}

// One changelog entry the app consumes (mirrors `ChangelogEntry` in the UI's
// testCases): the version it describes and that version's `changelog.md` body.
interface AssembledChangelogEntry {
  version: string;
  body: string;
}

// A seeded input the app consumes (mirrors `SeededInput` in the UI's testCases).
// The public snapshot only carries text specs, so `kind` is always "text" here.
interface AssembledSeededInput {
  path: string;
  kind: "text";
  text: string;
}

interface AssembledVariant {
  slug: string;
  name: string;
  description: string | null;
  prompt: string;
  seededInputs: AssembledSeededInput[];
  referenceScreenshots: AssembledReference[];
  reviewItems: AssembledReviewItem[];
  // The variant's effective scoring domains (common + its own) — the set a run of
  // this variant is rated against.
  domains: AssembledDomain[];
}

interface AssembledTestCase {
  slug: string;
  name: string;
  testType: TestType;
  // The asset shape an asset-generation case produces, so the catalog can
  // partition its 2D / 3D / Particle / Audio tabs. Null for a non-asset case.
  assetKind: AssetKind | null;
  difficulty: string;
  tags: string[];
  summary: string | null;
  description: string | null;
  // This version's own changelog entry, if it declared one — 0 or 1 element per
  // mapped version. `collapseCases` concatenates these across a slug's versions
  // (newest first) into the case's full changelog.
  changelog: AssembledChangelogEntry[];
  versions: string[];
  latestVersion: string;
  variants: AssembledVariant[];
  domains: AssembledDomain[];
}

const EMPTY: AssembledSnapshot = {
  runs: [],
  writeups: {},
  reviews: {},
  testCases: [],
  proofMediaUrls: {},
  assetMediaUrls: {},
};

// Rating tiers, ordered best to worst — the worst across reviewers/domains is the
// run's aggregate. Mirrors the `Rating` enum in `packages/ui/src/ratings.ts`.
const RATING_ORDER = ["flawless", "great", "scuffed", "broken"];

// The worst (lowest) rating among `tiers`, or null when empty.
function worstRating(tiers: string[]): string | null {
  let worst: string | null = null;
  let worstRank = -1;
  for (const tier of tiers) {
    const rank = RATING_ORDER.indexOf(tier);
    if (rank > worstRank) {
      worstRank = rank;
      worst = tier;
    }
  }
  return worst;
}

// Join a base URL with a snapshot-relative key, collapsing any double slash.
function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return (await response.json()) as T;
}

// Reconstruct a single *aggregate* writeup's `---\nrating.<domain>: …\n---\n\n
// <body>` framing from a run's reviews, so the existing `parseWriteup` path is
// unchanged on the site side and the cards/badges show the aggregate verdict. The
// aggregate rating for a domain is the worst any reviewer gave it; a checklist
// item reads `pass` only when every reviewer who judged it passed it; the body
// concatenates each reviewer's prose, attributed by display name. Mirrors
// `frameReviews` in `@test-cabinet/ui`. Returns null for no reviews.
function frameWriteup(reviews: SnapshotReview[]): string | null {
  if (reviews.length === 0) return null;

  const ratingsByDomain = new Map<string, string[]>();
  for (const review of reviews) {
    for (const r of review.ratings ?? []) {
      const list = ratingsByDomain.get(r.domain) ?? [];
      list.push(r.rating);
      ratingsByDomain.set(r.domain, list);
    }
  }
  const ratingLines: string[] = [];
  for (const [domain, tiers] of ratingsByDomain) {
    const worst = worstRating(tiers);
    if (worst) ratingLines.push(`rating.${domain}: ${worst}`);
  }

  const statusesByItem = new Map<string, string[]>();
  for (const review of reviews) {
    for (const v of review.checklist ?? []) {
      const list = statusesByItem.get(v.id) ?? [];
      list.push(v.status);
      statusesByItem.set(v.id, list);
    }
  }
  const verdictLines: string[] = [];
  for (const [id, statuses] of statusesByItem) {
    const status = statuses.every((s) => s === "pass") ? "pass" : "fail";
    verdictLines.push(`review.${id}: ${status}`);
  }

  const body = reviews
    .map((review) => {
      const text = (review.writeup ?? "").trim();
      const who = review.reviewer ?? "Reviewer";
      return text ? `**${who}**\n\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  const frontmatter = [...ratingLines, ...verdictLines].join("\n");
  return `---\n${frontmatter}\n---\n\n${body}`;
}

// Map a snapshot review to the app's StoredReview shape, filling sensible
// defaults for fields an older snapshot may omit.
function toAssembledReview(review: SnapshotReview): AssembledReview {
  return {
    reviewerId: review.reviewerId ?? "",
    reviewer: review.reviewer ?? "Reviewer",
    ratings: review.ratings ?? [],
    writeup: review.writeup ?? "",
    checklist: review.checklist ?? [],
    reviewedAt: review.reviewedAt ?? null,
  };
}

function mapCase(base: string, file: SnapshotCaseFile): AssembledTestCase {
  // Reference screenshots are optional in the snapshot. Common references
  // (variant null / `_common`) apply to every variant; variant-scoped ones only
  // to their variant. The variant prompt is carried (rendered at ingest), and the
  // seeded spec files are inlined (common ones plus the variant's own), so the
  // static site's Inputs tab shows the prompt, the specs, and the references — the
  // same inputs the backend-connected consoles resolve live.
  const refs = file.references ?? [];
  const commonRefs = refs.filter(
    (r) => r.variant == null || r.variant === "_common",
  );
  const commonItems = file.commonReviewItems ?? [];
  const commonSeeded = file.commonSeededInputs ?? [];
  const commonDomains = file.domains ?? [];
  const variants: AssembledVariant[] = file.variants.map((variant) => {
    const own = refs.filter((r) => r.variant === variant.slug);
    const referenceScreenshots = [...commonRefs, ...own].map((r) => ({
      view: r.view,
      kind: (r.kind === "video" ? "video" : "image") as "image" | "video",
      url: joinUrl(base, r.key),
    }));
    // The common specs seed first, then the variant's own — the same order a run
    // is seeded and the consoles present. Only text specs are inlined.
    const seededInputs: AssembledSeededInput[] = [
      ...commonSeeded,
      ...(variant.seededInputs ?? []),
    ].map((s) => ({ path: s.path, kind: "text", text: s.text }));
    // The common checklist items apply to every variant; the variant's own
    // follow. Each carries the point weight used to score runs.
    const reviewItems: AssembledReviewItem[] = [
      ...commonItems,
      ...(variant.reviewItems ?? []),
    ].map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text,
      reference: item.reference ?? null,
      proof: item.proof ?? null,
      sequences: item.sequences ?? [],
      frames: item.frames ?? [],
      weight: item.weight,
      domain: item.domain ?? null,
    }));
    // The common domains apply to every variant; the variant's own additive
    // domains follow. This effective set is what a run of this variant is rated
    // against.
    const domains: AssembledDomain[] = [
      ...commonDomains,
      ...(variant.domains ?? []),
    ].map((d) => ({ id: d.id, name: d.name, description: d.description }));
    return {
      slug: variant.slug,
      name: variant.name,
      description: variant.description,
      prompt: variant.prompt,
      seededInputs,
      referenceScreenshots,
      reviewItems,
      domains,
    };
  });
  return {
    slug: file.slug,
    name: file.name,
    testType: file.testType ?? "end-to-end",
    // Absent on snapshots written before it was published; the catalog treats a
    // missing kind as a 2D sprite (the Rust default), so keep null here and let
    // the classifier fall back.
    assetKind: file.assetKind ?? null,
    difficulty: file.difficulty,
    tags: file.tags,
    summary: file.summary,
    description: file.description,
    // This version's changelog entry, if any — collapseCases merges these across
    // the slug's versions into one newest-first changelog.
    changelog: file.changelog
      ? [{ version: file.version, body: file.changelog }]
      : [],
    versions: [file.version],
    latestVersion: file.version,
    variants,
    domains: (file.domains ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
    })),
  };
}

// Collapse per-(slug, version) case files into one TestCaseSummary per slug,
// newest version first, mirroring the catalog the site renders. Versions seen
// across a slug's published runs are merged; the newest is surfaced.
function collapseCases(
  base: string,
  files: SnapshotCaseFile[],
): AssembledTestCase[] {
  const bySlug = new Map<string, AssembledTestCase[]>();
  for (const file of files) {
    const mapped = mapCase(base, file);
    const list = bySlug.get(file.slug) ?? [];
    list.push(mapped);
    bySlug.set(file.slug, list);
  }
  const result: AssembledTestCase[] = [];
  for (const versions of bySlug.values()) {
    // Newest version first by descending version string (semver-ish vX.Y.Z).
    versions.sort((a, b) =>
      b.latestVersion.localeCompare(a.latestVersion, undefined, {
        numeric: true,
      }),
    );
    const newest = versions[0]!;
    result.push({
      ...newest,
      versions: versions.map((v) => v.latestVersion),
      // Each version contributes 0 or 1 entry; `versions` is newest-first, so the
      // concatenation is already ordered newest changelog entry first.
      changelog: versions.flatMap((v) => v.changelog),
    });
  }
  return result;
}

// Fetch and assemble the published snapshot. Follows the atomic pointer
// `index.json` -> versioned prefix -> `runs.json` -> per-run + per-case files.
// `emitEvents` is called for each run that carries an event stream, so the build
// can write it out as a per-run static asset the Events tab fetches at runtime.
async function loadSnapshot(
  base: string,
  emitEvents: (runId: string, json: string) => void,
): Promise<AssembledSnapshot | null> {
  // `index.json` is the atomic pointer the backend writes last, only after a
  // publish. A 404 here means nothing has been published yet (a fresh
  // deployment), which is the empty-dataset bootstrap case — signal it with
  // `null` so the build succeeds empty. Any other non-OK status is a genuinely
  // broken snapshot and must fail the build.
  const indexUrl = joinUrl(base, "index.json");
  const indexResponse = await fetch(indexUrl);
  if (indexResponse.status === 404) {
    return null;
  }
  if (!indexResponse.ok) {
    throw new Error(
      `${indexResponse.status} ${indexResponse.statusText} for ${indexUrl}`,
    );
  }
  const index = (await indexResponse.json()) as SnapshotIndex;
  const runsFile = await fetchJson<SnapshotRunsFile>(
    joinUrl(base, index.runsKey),
  );

  const runs: unknown[] = [];
  const writeups: Record<string, string> = {};
  const reviews: Record<string, AssembledReview[]> = {};
  const proofMediaUrls: Record<string, Record<string, string>> = {};
  const assetMediaUrls: Record<string, Record<string, string>> = {};
  // The case-version keys referenced by published runs; deduplicated.
  const caseKeys = new Set<string>();

  // Per-run records + reviews, in the snapshot's newest-first order.
  for (const summary of runsFile.runs) {
    const runFile = await fetchJson<SnapshotRunFile>(
      joinUrl(base, `${index.runsPrefix}${summary.id}.json`),
    );
    runs.push(runFile.record);
    const runReviews = runFile.reviews ?? [];
    if (runReviews.length > 0) {
      reviews[summary.id] = runReviews.map(toAssembledReview);
      const framed = frameWriteup(runReviews);
      if (framed !== null) writeups[summary.id] = framed;
    }
    // The run's proof media, keyed by served file name (the key's last segment),
    // resolved to absolute URLs the proof/review UI loads.
    if (runFile.proofMedia?.length) {
      const byFile: Record<string, string> = {};
      for (const proof of runFile.proofMedia) {
        const file = proof.key.split("/").pop() ?? proof.key;
        byFile[file] = joinUrl(base, proof.key);
      }
      proofMediaUrls[summary.id] = byFile;
    }
    // The run's asset-generation media, keyed by its served file name, resolved to
    // absolute URLs the asset result view loads.
    if (runFile.assetMedia?.length) {
      const byFile: Record<string, string> = {};
      for (const asset of runFile.assetMedia) {
        byFile[asset.file] = joinUrl(base, asset.key);
      }
      assetMediaUrls[summary.id] = byFile;
    }
    // Emit the run's recorded events as a standalone asset (only when present),
    // so the Events tab can fetch `run-events/<id>.json` without the bundle
    // carrying every run's log.
    if (runFile.events != null) {
      emitEvents(summary.id, JSON.stringify(runFile.events));
    }
    const { testCaseSlug, testCaseVersion } = summary.subject;
    caseKeys.add(`${index.casesPrefix}${testCaseSlug}/${testCaseVersion}.json`);
  }

  // Per-case-version metadata for every case a published run references.
  const caseFiles: SnapshotCaseFile[] = [];
  for (const key of caseKeys) {
    try {
      caseFiles.push(await fetchJson<SnapshotCaseFile>(joinUrl(base, key)));
    } catch {
      // A run can reference a historical case-version the snapshot did not
      // emit; skip it rather than failing the whole build (the run still shows,
      // it just lacks framing metadata).
    }
  }

  return {
    runs,
    writeups,
    reviews,
    testCases: collapseCases(base, caseFiles),
    proofMediaUrls,
    assetMediaUrls,
  };
}

function serialize(data: AssembledSnapshot): string {
  return [
    "// Generated at build time by vite-plugin-snapshot. Do not edit.",
    `export const runs = ${JSON.stringify(data.runs)};`,
    `export const writeups = ${JSON.stringify(data.writeups)};`,
    `export const reviews = ${JSON.stringify(data.reviews)};`,
    `export const testCases = ${JSON.stringify(data.testCases)};`,
    `export const proofMediaUrls = ${JSON.stringify(data.proofMediaUrls)};`,
    `export const assetMediaUrls = ${JSON.stringify(data.assetMediaUrls)};`,
  ].join("\n");
}

export function snapshot(): Plugin {
  // Read once per build. The dev server does not fetch the published snapshot
  // (the localRuns plugin supplies dev data); it resolves to the empty dataset.
  let module: string | null = null;
  let isBuild = false;

  return {
    name: "ttc-snapshot",
    config(_config, env) {
      isBuild = env.command === "build";
    },
    async buildStart() {
      if (!isBuild) {
        module = serialize(EMPTY);
        return;
      }
      const base = process.env.TCAB_SNAPSHOT_URL?.trim();
      if (!base) {
        this.warn(
          "TCAB_SNAPSHOT_URL is not set; building with an empty published dataset.",
        );
        module = serialize(EMPTY);
        return;
      }
      try {
        let eventAssets = 0;
        const data = await loadSnapshot(base, (runId, json) => {
          // Write each run's events as a stable, predictable asset path the
          // static site fetches at runtime (`run-events/<id>.json`).
          this.emitFile({
            type: "asset",
            fileName: `run-events/${runId}.json`,
            source: json,
          });
          eventAssets += 1;
        });
        if (data === null) {
          this.warn(
            `no published snapshot at ${base} yet (index.json 404); building with an empty dataset. The backend's deploy hook will rebuild the gallery once a run is published.`,
          );
          module = serialize(EMPTY);
          return;
        }
        this.info(
          `fetched snapshot from ${base}: ${data.runs.length} run(s), ${data.testCases.length} case(s), ${eventAssets} event log(s).`,
        );
        module = serialize(data);
      } catch (error) {
        // A reachable-but-broken snapshot must fail the build loudly rather
        // than silently shipping an empty gallery over real data.
        this.error(
          `failed to fetch public snapshot from ${base}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return module ?? serialize(EMPTY);
      }
      return null;
    },
  };
}
