// Recover published runs' proof + asset media from a PRIOR public snapshot prefix
// back into the backend store, then trigger a snapshot refresh.
//
// Why this exists: the public snapshot's per-run media (proof-of-implementation
// images/videos; an asset-generation run's regenerated/preview/action-log media)
// is regenerated on every publish by reading each run's media from the backend
// store, falling back to the artifact service. Both of those are volumes that do
// NOT survive a cluster delete/recreate (the backend store is an ephemeral
// emptyDir; the artifact service's PVC is a per-cluster disk). After a recreate,
// the first snapshot refresh therefore re-exports every historical run with EMPTY
// `proofMedia`/`assetMedia`, and the atomic `index.json` cut-over degrades the live
// gallery — even though the media bytes still exist in R2 under the previous
// snapshot's prefix (there is no snapshot GC).
//
// This script recovers that media WITHOUT the artifact service (which is empty
// after a recreate): it reads a known-good prior snapshot straight from R2's public
// read URL and copies each run's media back into the backend store, then asks the
// backend for one refresh — which re-exports the store (now carrying the media) to
// a fresh R2 prefix the site reads. It is the recreate-recovery analogue of
// `scripts/backfill-run-media.mjs` (which sources from the artifact service, so it
// cannot help when that volume was wiped).
//
// What it does, per run in the source snapshot's `runs.json`: reads the run's
// per-run document, enumerates its `proofMedia[]` + `assetMedia[]` (each already
// naming its media by the canonical served `<kind>/<file>` the snapshot keys on —
// and a video proof is already the transcoded `.mp4`, so the backend serves it
// as-is without re-transcoding), fetches each object from the source prefix, and
// POSTs it into the backend store. After copying it asks the backend for one
// snapshot refresh.
//
// Idempotent: a media object the store already holds is overwritten with identical
// bytes, so re-running is safe. A media object missing from the source prefix (404)
// is reported and skipped.
//
// Runs INSIDE the cluster (it talks to the backend over localhost and reads the
// source snapshot over the pod's internet egress); `scripts/recover-run-media-from-snapshot.sh`
// is the operator entrypoint that ships this file into the backend pod and runs it.
//
// Environment:
//   BACKEND      backend base URL          (default http://127.0.0.1:8787)
//   SOURCE_BASE  public snapshot read base (default https://snapshot.testcabinet.ai)
//   SOURCE_PREFIX  the known-good source snapshot prefix, e.g.
//                  `snapshots/2026-07-10T1901Z-c921bb6b` (REQUIRED — the last full
//                  snapshot from before the recreate; the wrapper can discover it)
//   APPLY        set to "1" to actually POST + refresh; unset = dry run (read-only)
//   RUN_ID       restrict to a single run id (optional; for targeted re-runs/testing)

const BACKEND = (process.env.BACKEND ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const SOURCE_BASE = (process.env.SOURCE_BASE ?? "https://snapshot.testcabinet.ai").replace(
  /\/+$/,
  "",
);
const SOURCE_PREFIX = (process.env.SOURCE_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
const APPLY = process.env.APPLY === "1";
const RUN_ID = process.env.RUN_ID || null;

if (!SOURCE_PREFIX) {
  console.error(
    "SOURCE_PREFIX is required (the known-good source snapshot prefix, e.g. " +
      "snapshots/2026-07-10T1901Z-c921bb6b).",
  );
  process.exit(2);
}

/** Split a snapshot-relative media key (`<prefix>/runs/<id>/<kind>/<file>`) into the
 * `<kind>` (`proof`/`asset`) and `<file>` the backend store addresses it under.
 * Returns null for a key that does not match that shape. */
function kindAndFile(key) {
  const parts = key.split("/");
  const file = parts.at(-1);
  const kind = parts.at(-2);
  if (!file || (kind !== "proof" && kind !== "asset")) return null;
  return { kind, file };
}

/** The source URL of a snapshot object key under the source read base. */
function sourceUrl(key) {
  return `${SOURCE_BASE}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** The run ids to recover: a single `RUN_ID` when set, else every run in the source
 * snapshot's `runs.json` (which lists exactly the published runs the snapshot holds). */
async function sourceRunIds() {
  if (RUN_ID) return [RUN_ID];
  const url = `${SOURCE_BASE}/${SOURCE_PREFIX}/runs.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const body = await res.json();
  return body.runs.map((run) => run.id);
}

/** The `{ kind, file, key }` media items for one run, read from its per-run document
 * in the source prefix. Both `proofMedia[]` and `assetMedia[]` already name each
 * object by its snapshot-relative key. Empty for a run whose document is missing. */
async function mediaForRun(runId) {
  const url = `${SOURCE_BASE}/${SOURCE_PREFIX}/runs/${encodeURIComponent(runId)}.json`;
  const res = await fetch(url);
  if (res.status === 404) {
    console.warn(`  MISSING run document ${runId} in source prefix (skipping run)`);
    return [];
  }
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const doc = await res.json();
  const items = [];
  for (const proof of doc.proofMedia ?? []) {
    const parsed = kindAndFile(proof.key);
    if (parsed) items.push({ ...parsed, key: proof.key });
  }
  for (const asset of doc.assetMedia ?? []) {
    const parsed = kindAndFile(asset.key);
    if (parsed) items.push({ ...parsed, key: asset.key });
  }
  return items;
}

const stats = { runs: 0, withMedia: 0, copied: 0, present: 0, missing: 0, errors: 0 };

async function recover() {
  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} recovery: backend=${BACKEND} ` +
      `source=${SOURCE_BASE}/${SOURCE_PREFIX}` +
      (RUN_ID ? ` run=${RUN_ID}` : ""),
  );
  const runIds = await sourceRunIds();
  console.log(`Source snapshot lists ${runIds.length} run(s).`);
  for (const runId of runIds) {
    stats.runs++;
    let media;
    try {
      media = await mediaForRun(runId);
    } catch (err) {
      stats.errors++;
      console.error(`  ERROR ${runId}: reading source document: ${err}`);
      continue;
    }
    if (media.length === 0) continue;
    stats.withMedia++;
    for (const { kind, file, key } of media) {
      let res;
      try {
        res = await fetch(sourceUrl(key));
      } catch (err) {
        stats.errors++;
        console.error(`  ERROR ${runId} ${kind}/${file}: source fetch failed: ${err}`);
        continue;
      }
      if (res.status === 404) {
        stats.missing++;
        console.warn(`  MISSING ${runId} ${kind}/${file} (source prefix has no such object)`);
        continue;
      }
      if (!res.ok) {
        stats.errors++;
        console.error(`  ERROR ${runId} ${kind}/${file}: source GET -> ${res.status}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!APPLY) {
        stats.present++;
        console.log(`  WOULD COPY ${runId} ${kind}/${file} (${bytes.length} bytes)`);
        continue;
      }
      const dst = `${BACKEND}/runs/${encodeURIComponent(runId)}/${kind}/${encodeURIComponent(file)}`;
      const put = await fetch(dst, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (!put.ok) {
        stats.errors++;
        console.error(`  ERROR ${runId} ${kind}/${file}: backend POST -> ${put.status}`);
        continue;
      }
      stats.copied++;
      console.log(`  COPIED ${runId} ${kind}/${file} (${bytes.length} bytes)`);
    }
  }

  // Re-export the store (now carrying the copied media) to R2. Only meaningful after
  // an apply that actually copied something; a dry run never mutates and never refreshes.
  let refreshed = false;
  if (APPLY && stats.copied > 0) {
    const res = await fetch(`${BACKEND}/snapshot/refresh`, { method: "POST" });
    if (!res.ok) {
      stats.errors++;
      console.error(`  ERROR snapshot refresh -> ${res.status}`);
    } else {
      refreshed = true;
      console.log(`  snapshot refresh: ${await res.text()}`);
    }
  }

  console.log(
    `\nDone. runs=${stats.runs} withMedia=${stats.withMedia} ` +
      (APPLY ? `copied=${stats.copied}` : `wouldCopy=${stats.present}`) +
      ` missing=${stats.missing} errors=${stats.errors} refreshed=${refreshed}`,
  );
  if (!APPLY) {
    console.log("Dry run only — set APPLY=1 to copy media and trigger a snapshot refresh.");
  }
  process.exit(stats.errors > 0 ? 1 : 0);
}

recover().catch((err) => {
  console.error(`recovery failed: ${err?.stack ?? err}`);
  process.exit(1);
});
