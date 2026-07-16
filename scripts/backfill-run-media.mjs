// Backfill published runs' proof + asset media into the backend store.
//
// Why this exists: a backend-driven run's proof-of-implementation media (and an
// asset-generation run's regenerated/preview/action-log media) is uploaded to the
// *artifact service* (durable PVC) as part of the run tree, but historically was
// never mirrored into the *backend store* the public snapshot is built from. So the
// snapshot — and therefore the published site — carried no media, and the proof tab
// rendered "Proof media is not available here." while asset result views had nothing
// to show. The driver now mirrors this media at run time
// (`crates/driver/src/artifacts.rs`), but runs published *before* that fix have media
// only in the artifact service. This one-shot backfill copies it across for them.
//
// What it does, per published run: enumerates the run's media by the SAME canonical
// served names the snapshot keys on (`<proof-id>.<ext>` for proofs; bare
// `regenerated.png`/`preview.png`/`actions.json` for a single sprite, per-frame
// `…-<index>.…` for a sheet), fetches each from the artifact service, and POSTs it
// into the backend store. After copying it asks the backend for one snapshot refresh,
// which re-exports the store (now including the media) to R2 — the durable source the
// site reads. The backend store is an ephemeral emptyDir in prod, so the refresh is
// what makes the result durable; without it the copied bytes would be lost on the
// next backend restart.
//
// Idempotent: a media object the store already holds is overwritten with identical
// bytes, so re-running is safe. A media file the artifact service does not have (404)
// is reported and skipped — that run simply has no servable media to recover.
//
// Runs INSIDE the cluster (it talks to the backend over localhost and the artifact
// service over its in-cluster Service DNS); `scripts/backfill-run-media.sh` is
// the operator entrypoint that ships this file into the backend pod and runs it.
//
// Environment:
//   BACKEND    backend base URL          (default http://127.0.0.1:8787)
//   ARTIFACTS  artifact service base URL (required, e.g. http://tcab-artifacts:8790)
//   APPLY      set to "1" to actually POST + refresh; unset = dry run (read-only)
//   RUN_ID     restrict to a single run id (optional; for targeted re-runs/testing)
//   PAGE_LIMIT runs per /runs page        (default 200, the backend max)

const BACKEND = (process.env.BACKEND ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const ARTIFACTS = (process.env.ARTIFACTS ?? "").replace(/\/+$/, "");
const APPLY = process.env.APPLY === "1";
const RUN_ID = process.env.RUN_ID || null;
const PAGE_LIMIT = Number(process.env.PAGE_LIMIT ?? "200");

if (!ARTIFACTS) {
  console.error("ARTIFACTS base URL is required (e.g. http://tcab-artifacts:8790)");
  process.exit(2);
}

/** The file extension a proof is served under, derived from its `dest` path.
 * Mirrors the gallery's `extensionFor` (packages/ui/.../proofMedia.ts) and the
 * driver's `served_proof_extension`, so the name lines up with the snapshot key. */
function extensionFor(dest) {
  const base = dest.split("/").pop() ?? dest;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "png";
  return base.slice(dot + 1).toLowerCase();
}

/** The canonical served media files for a run record: `{ kind, file }` pairs where
 * `kind` is the `proof`/`asset` URL segment both services address the file under.
 * Empty for a run that declares neither — exactly the set the snapshot would key. */
function mediaFor(record) {
  const out = [];
  for (const proof of record.validation.proofs ?? []) {
    if (proof.present) {
      out.push({ kind: "proof", file: `${proof.id}.${extensionFor(proof.dest)}` });
    }
  }
  const asset = record.validation.asset;
  if (asset) {
    // A single sprite serves under bare names; a sheet suffixes each frame with
    // `-<index>` — matching `playable::serve_asset_file` and `snapshot::run_assets`.
    const isSheet = !!asset.sheet;
    for (const frame of asset.frames ?? []) {
      const suffix = isSheet ? `-${frame.index}` : "";
      out.push({ kind: "asset", file: `regenerated${suffix}.png` });
      out.push({ kind: "asset", file: `preview${suffix}.png` });
      out.push({ kind: "asset", file: `actions${suffix}.json` });
    }
  }
  return out;
}

/** Page through every published run, yielding each run record. */
async function* publishedRecords() {
  if (RUN_ID) {
    const res = await fetch(`${BACKEND}/runs/${encodeURIComponent(RUN_ID)}`);
    if (!res.ok) throw new Error(`GET /runs/${RUN_ID} -> ${res.status}`);
    yield (await res.json()).record;
    return;
  }
  let before = null;
  for (;;) {
    const url = new URL(`${BACKEND}/runs`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (before) url.searchParams.set("before", before);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET /runs -> ${res.status}`);
    const body = await res.json();
    for (const run of body.runs) yield run.record;
    // The backend serializes responses as camelCase, so the cursor is `nextBefore`.
    if (!body.nextBefore || body.runs.length === 0) return;
    before = body.nextBefore;
  }
}

const stats = { runs: 0, withMedia: 0, copied: 0, present: 0, missing: 0, errors: 0 };

async function backfill() {
  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} backfill: backend=${BACKEND} artifacts=${ARTIFACTS}` +
      (RUN_ID ? ` run=${RUN_ID}` : ""),
  );
  for await (const record of publishedRecords()) {
    stats.runs++;
    const media = mediaFor(record);
    if (media.length === 0) continue;
    stats.withMedia++;
    for (const { kind, file } of media) {
      const src = `${ARTIFACTS}/runs/${encodeURIComponent(record.id)}/${kind}/${file}`;
      let res;
      try {
        res = await fetch(src);
      } catch (err) {
        stats.errors++;
        console.error(`  ERROR ${record.id} ${kind}/${file}: artifact fetch failed: ${err}`);
        continue;
      }
      if (res.status === 404) {
        stats.missing++;
        console.warn(`  MISSING ${record.id} ${kind}/${file} (artifact service has no such file)`);
        continue;
      }
      if (!res.ok) {
        stats.errors++;
        console.error(`  ERROR ${record.id} ${kind}/${file}: artifact GET -> ${res.status}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!APPLY) {
        stats.present++;
        console.log(`  WOULD COPY ${record.id} ${kind}/${file} (${bytes.length} bytes)`);
        continue;
      }
      const dst = `${BACKEND}/runs/${encodeURIComponent(record.id)}/${kind}/${file}`;
      const put = await fetch(dst, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (!put.ok) {
        stats.errors++;
        console.error(`  ERROR ${record.id} ${kind}/${file}: backend POST -> ${put.status}`);
        continue;
      }
      stats.copied++;
      console.log(`  COPIED ${record.id} ${kind}/${file} (${bytes.length} bytes)`);
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

backfill().catch((err) => {
  console.error(`backfill failed: ${err?.stack ?? err}`);
  process.exit(1);
});
