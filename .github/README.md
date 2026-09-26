# The GitHub mirror

This repository lives on Azure Repos. `TheClockwyrks/TheTestCabinet` on GitHub
is its mirror, there so that anyone can read the code behind the benchmark.

Nothing is pushed to the mirror by hand. The Azure pipeline pushes `master`,
`staging`, `nightly` and every `v*` tag there once a commit has passed its gates
([`scripts/ci/mirror.sh`](../scripts/ci/mirror.sh)), and nothing else writes to
the mirror. The push is forced, so anything committed on GitHub directly is
lost.

The mirror runs no CI of its own. Every gate, image build, release and deploy
runs in the Azure pipeline; see [`scripts/ci/README.md`](../scripts/ci/README.md).

## Submodules

The superproject names each submodule by a relative URL such as
`../cold-storage`, so a clone from GitHub fetches it from that repository's own
mirror, `TheClockwyrks/cold-storage`. The pipeline's pin gate
([`scripts/ci/submodule-pins.sh`](../scripts/ci/submodule-pins.sh)) holds every
pinned submodule commit to that submodule's `master`, which is what its mirror
receives, so every commit here names submodule commits its mirror already holds.

## The credentials

| What                                               | Where it is kept                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The deploy key the pipeline pushes the mirror with | Azure Pipelines secure file `github-mirror-key`; the public half is a deploy key on the GitHub repository, with write access |
