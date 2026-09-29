# Share one /opt/gg layer across the gg run-image variants

`containers/gg/Dockerfile` copies the 2.2 GB gg toolchain tree into each `-gg` run-image
variant with `COPY --link`, which asks BuildKit to build the layer rooted at `scratch` so
every variant carries one digest for those bytes. The Azure agents' builder does not
deliver that: the registry holds one distinct ~898.6 MB blob per variant, 12.6 GB of the
13.3 GB a run-image build pushes, while the entire rest of the run-image set is 0.8 GB.
Make the layer shared.

## What it costs today

Roughly 24 GB of registry writes per architecture per build on `master` and `staging`.
Every node that runs more than one variant pulls the tree again for each. The local
`docker save` that `deployments/local/Makefile` feeds to `k3d image import` writes a copy
per variant, which is what its own 23.2 GB one-archive measurement rests on.

It does not cost a red build any more: under `PUSH=1 RECLAIM=1`, which
`scripts/ci/run-images.sh` sets, `containers/build.sh` removes each pushed image once
nothing later is `FROM` it and prunes the builder cache as the build advances, so the
agent's disk survives the set either way. A local build sets neither and still pays the
full duplication.

## Reading the answer

`build_gg_variant` prints each variant's `/opt/gg` layer digest as it builds. Identical
digests across the twenty-seven mean the layer is shared; distinct ones mean it is not.
That line is in every run-image build's log, so the current state is read rather than
inferred from registry manifests.

## The cheapest hypothesis to test first

`containers/gg/Dockerfile` carries no `# syntax=` directive, while `containers/base`,
`containers/tools` and `containers/gg-toolchains` all name the pinned external Dockerfile
frontend. A variant is therefore built with the daemon's vendored frontend, which is the
likeliest place `--link` is being dropped. Adding the directive may be the whole fix.

Measure it before shipping it, because the directive is expensive in exactly this file.
This Dockerfile is built twenty-seven times per run-image job, and `containers/build.sh`
prunes the builder cache between variants, which discards the cached frontend resolution
with it. The last run-image build made three Docker Hub frontend requests for all
fifty-five images; the directive would make it thirty per leg. One `toomanyrequests` then
fails a variant hours into a job that cannot be exercised before it merges.

The directive also carries an offline cost. `containers/README.md` documents pointing
`GG_TOOLCHAINS_IMAGE` at the published toolchain tag so that `./build.sh <name>-gg`
rebuilds nothing else, and on that path this Dockerfile is the only one built, so the
directive would be the only thing reaching a registry for a frontend.

Test it on a branch by building a handful of variants by hand and comparing the layer
digests they print. If it is the fix, land it with the frontend pinned by digest, and with
either the per-variant prune narrowed or the frontend pre-warmed, so that the thirty
requests do not become the next failure.

## Candidate approaches

Enable the containerd image store on the build agents (`features.containerd-snapshotter`
plus a daemon restart). This is the configuration in which merge-op refs export with
shared blobs. It swaps the image store under a job that also does `docker
create`/`cp`/`exec` for `gg selfcheck` and pushes fifty-five images, and it needs a daemon
restart on a hosted agent and on an organisation pool.

Build through a `docker-container` buildx builder, which is real BuildKit and exports
merge-ops properly. The images would stop landing in the local image store, so
`gg_selfcheck`'s `docker create`/`cp`/`exec` on a local tag would need restructuring, and
`--load` would re-import each variant and reintroduce the local cost.

Publish the toolchain tree as one image and stage it into the run container at start-up
rather than baking it into twenty-seven. This removes the duplication everywhere at once
and contradicts a documented decision: `containers/gg/Dockerfile` argues the compilers
must be on the turn path at image build time and that a variant is the same run image with
the same binaries, and `harness::gg_variant` in `crates/core` resolves a run to a baked
variant.

## Resolution

The layer was built from `scratch` as `--link` asks, on every builder tried; what differed
was the parent directory. `COPY --link --from=ggtools /opt/gg /opt/gg` made the copy create
`opt/` itself, and a directory the copy creates carries the moment of the build as its
mtime, so each variant's layer tar held an `opt/` entry with a different timestamp. Measured
on a stock Docker 28 daemon with the builtin builder, two variants of different parents got
distinct diff IDs with and without a `# syntax=` directive, with and without the containerd
image store, and with `SOURCE_DATE_EPOCH` set; so neither hypothesis above was the fix.

`containers/gg/Dockerfile` now copies `/opt`, the whole filesystem of the toolchain builder
image (`FROM scratch` plus `/opt/gg`), so the `opt/` entry is the builder image's own and
the layer is bit-identical from variant to variant: one diff ID on the stock image store and
on the containerd store alike, and the second push of it was mounted from the first
variant's repository. The `/opt/gg layer:` line `build_gg_variant` prints was empty because
`--format` appends a newline after the template's last `println`; it now prints the diff ID,
so a run-image build's log answers the sharing question with twenty-seven identical lines.
The reclaim stays, because the local store still chains each variant's copy under its own
parent.
