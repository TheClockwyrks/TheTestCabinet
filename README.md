# The Test Cabinet

## Overview

The Test Cabinet is a benchmark for AI models and harnesses that uses a suite of
test cases inspired by old school arcade and flash games. These are used to
evaluate a model's coding and visual/spatial capabilities using test cases that
require significantly more code than most other commonly used software
development benchmarks.

For more information, see <https://docs.testcabinet.ai/>.

## Getting started

Open the repository in its dev container, which carries the tooling the gates
need. Before its first start, copy your host's file to `.devcontainer/.env`
(`.env.macos` on a Mac, `.env.podman` on a Linux Podman host; an Ubuntu Docker
host needs none). See
[Running](apps/docs/src/content/docs/development/running.md#the-dev-container).
After the container is created, it provisions gg's program-language toolchains
in the background; `bash scripts/devcontainer-setup.sh` resumes an interrupted
provisioning.

One command runs every gate:

```sh
make gate
```

Each gate is a file under `ci/gates/` whose stem is the gate's id, and that id is
what a commit hook, a pipeline step and an issue all call the check by.
`uv run --quiet --project ci gate list` names them all, and `make clean` removes
the build output. [Building](apps/docs/src/content/docs/development/building.md)
is the authoritative guide to the layout, the gates and the pipelines.

## The template

This repository is rendered from the k8s standard workspace template, a
[copier](https://copier.readthedocs.io) template. `.copier-answers.yml` records
the template's source, the version the repository was last rendered against,
and every answer. Files the template renders are never edited here; a change one
needs is made in the template and brought in with `copier update`. This file,
`CLAUDE.md`, the documentation's pages and the project's own code are seeds the
template never renders over.
