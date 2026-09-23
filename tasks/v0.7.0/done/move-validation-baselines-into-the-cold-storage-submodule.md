# Move validation baselines into the cold-storage submodule

Take the captured baseline validation media out of this repository's tree and
serve it from a `cold-storage` submodule, so a default clone is small and the
full media set is an opt-in download.

This issue runs before
[`rewrite-the-repository-history-without-baselines-and-wasm-blobs.md`](../rewrite-the-repository-history-without-baselines-and-wasm-blobs.md),
which removes the same files from history once they have left the tree.

## Current state

Every test-case version folder holds `validation-baseline/<engine>/<variant>/`,
the media `tcab capture-baselines` synthesizes from the variant's reference
implementation. It is the bulk of the repository.

| What                                          | Size                        |
| --------------------------------------------- | --------------------------- |
| Baselines tracked at HEAD                     | 1.85 GiB, about 31k files   |
| The same, compressed                          | 1.53 GiB                    |
| Baseline blobs across all history, compressed | 4.61 GiB of a 5.37 GiB pack |

Two commands write the directory. `crates/cli/src/commands/capture_baselines.rs`
resolves it in `baseline_dir` by joining a version's root with
`VALIDATION_BASELINE_DIR` from `crates/core/src/validator.rs`, and
`publish_reference.rs` re-captures through the same helper.

The backend reads it in three places. `ingest_version` in
`crates/backend/src/ingest.rs` stages a version by `copy_tree` of its folder into
the store and digests it with `authored_version_digest`. `store.rs` then serves
`read_validation_baseline` and `list_validation_baseline` from the store's
`version_dir`, and `snapshot.rs` uploads what `case_validation_baselines` lists to
R2 under content digests. The deployed backend's ingest sidecar
(`deployments/k8s/overlays/azure-*/patch-backend-ingest.yaml`) keeps a persistent
shallow checkout at `/state/checkout`, cloned from the GitHub mirror.

`scripts/lib/frozen.sh` digests a frozen version from `git ls-files`, which today
includes the baseline files. No CI gate reads baselines.

## Design

### Layout

A `cold-storage` submodule sits at the repository root, backed by
`git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/cold-storage`. Its tree
mirrors the test-case tree, so a version's baselines live at
`cold-storage/test-cases/<type>/<difficulty>/<slug>/<version>/validation-baseline/<engine>/<variant>/`.
The path arithmetic is a prefix swap and nothing else.

### One resolver

Core gains a single function that maps a case version root to its baseline
directory beneath the cold-storage root. The root defaults to
`<checkout>/cold-storage` and `TCAB_COLD_STORAGE_DIR` overrides it. Every writer
and reader goes through this function.

`capture-baselines` and `publish-reference` write there. Ingest copies the
cold-storage counterpart into the staged version directory under
`validation-baseline/` when it is present, so `store.rs`, the API route and the
snapshot are unchanged and keep serving from the store. An absent submodule
yields versions with no baseline media, and ingest proceeds.

### The deployed checkout

The ingest sidecar adds a shallow submodule update to its refresh step, so the
persistent checkout carries the baselines the store copies. The checkout stays on
the GitHub mirror, which holds the submodule per
[`address-submodules-by-relative-url-and-mirror-them-to-github.md`](../address-submodules-by-relative-url-and-mirror-them-to-github.md).
CI keeps submodules off, since no gate reads baselines.

### Frozen versions

The frozen digest excludes baselines by construction, because they are outside
the version folder. Recapturing a frozen version's baseline is allowed: a
baseline is evidence beside a verdict and backs no point, so a fresh capture
changes no score. The existing markers are rewritten with `scripts/freeze.sh`
in the migration commit so they record the folder without its media.

### Migration

The current baselines become the cold-storage repository's first commit, and the
TTC commit that deletes them from the tree adds the submodule pointer in the same
change. Cold-storage history is never rewritten, because every TTC commit pins
into it. Baselines are recaptured only when a reference implementation or its
suites change, which bounds the submodule's growth.

### Documentation

The pages that describe baselines, the layout, and freezing change with the
code: `components/core/validation.md`, `quickstarts/devops/publish-a-reference.md`,
`components/cli/overview.md`, the layout in `development/building.md`,
`development/frozen-versions.md`, `development/running.md` (fetching baselines to
review a run), and the map in `CLAUDE.md`.

## Done when

- [x] `cold-storage` is a submodule at the root and holds every baseline that was
      tracked, at the mirrored path.
- [x] `test-cases/` tracks no `validation-baseline/` directory.
- [x] `tcab capture-baselines` and `tcab publish-reference` write beneath the
      cold-storage root, and `TCAB_COLD_STORAGE_DIR` redirects them.
- [x] Ingesting a checkout with the submodule serves and snapshots each version's
      baselines exactly as before; ingesting one without it succeeds with empty
      baselines.
- [x] The deployed ingest sidecar fetches the submodule shallowly on every refresh.
- [x] Every frozen marker verifies after the move, and the frozen check passes on
      a recapture of a frozen version.
- [x] The listed docs and `CLAUDE.md` describe the submodule.
- [x] Gates green.
