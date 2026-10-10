# Ingest Detects Changed Versions By Content Digest

Give `POST /ingest` a mode that re-ingests exactly the versions whose content in
the checkout differs from what the store holds, so no client keeps
change-detection state of its own.

## Current state

`scripts/reingest.sh` implements change detection on the client. It keeps a
gitignored `.reingest-timestamp` whose mtime is the baseline, walks
`test-cases/`, `game-jams/`, and `test-suites/` for version folders holding a
newer file, and sends those as `<slug>@<version>` targets with `force: true`. It
also reads `storeReady` from `/healthz` and falls back to a whole-catalog force
when the store is unservable.

A plain non-forced ingest skips every version already stored, whatever its
content, and a forced one rewrites every target. Neither decides on content.

The mtime baseline is local to one checkout, so it cannot describe a remote
backend, and it misses a change the backend did not see, such as an ingest that
failed partway. The Spec Cabinet replaces the script
(`tasks/spec-cabinet/publish-to-the-local-cluster.md`) and needs one ingest
call that means "bring the store in line with the checkout".

## Design

### Digest

Ingest computes a digest for each version it scans. The digest is SHA-256 over
the version folder's files, visiting relative paths in sorted order and hashing
each path followed by its bytes. The stored version record keeps the digest it
was ingested from.

For a suite version the digest also covers `<slug>/suite.toml`, since the
display name every lowered definition reports comes from it. For a legacy case
it also covers `test-cases/reference-builds.lock.json`.

### The request

The ingest body gains `"mode": "changed"`. In that mode a target is ingested when
the store holds no record for it, when its stored digest differs from the
checkout's, or when the stored record's catalog version differs from the
backend's. Every other target reports `ingested: false` with
`reason: "unchanged"`. `force` keeps its meaning of rewriting every target.

A whole-catalog `changed` scan prunes exactly as a whole-catalog scan does
today. When `/healthz` would report `storeReady: false`, a `changed` scan
ingests every target, since no stored record is servable.

The `done` event reports `ingested`, `skipped`, and `total` as it does now.

### Clients

`HttpBackendClient::ingest` in `crates/core/src/backend_client.rs` takes the
mode, and `tcab ingest` gains `--changed`. The request shape and events are
documented in the backend
[API](../../apps/docs/src/content/docs/components/backend/api.md) page.

## Done when

- [ ] Ingest stores each version's digest in its record.
- [ ] A `changed` scan with no edits ingests nothing and reports every target
      unchanged.
- [ ] Editing one file of one version and scanning `changed` re-ingests that
      version alone, for a legacy case, a game jam, and a suite version.
- [ ] Editing a suite's `suite.toml` re-ingests each of its versions.
- [ ] A `changed` scan against a store written in another catalog version
      re-ingests every target.
- [ ] A whole-catalog `changed` scan prunes as a whole-catalog scan does.
- [ ] `tcab ingest --changed` streams per-version progress, naming the reason
      for each skip.
- [ ] Gates green.
