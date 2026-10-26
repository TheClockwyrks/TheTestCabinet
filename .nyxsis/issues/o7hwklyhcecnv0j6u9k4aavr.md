---
format: nyxsis-issue
version: 3
id: o7hwklyhcecnv0j6u9k4aavr
zone: NYX
number: 8
title: Repair the-test-cabinet failing on nightly
type: ci
priority: 0
state: done
created: 2026-10-26T08:32:11.802822694Z
done: 2026-10-26T09:20:21.469990435Z
outcome: |
  Cause: 52dbbc862 added `postgresql` to `ci/images/rust.Dockerfile` and set
  `TCAB_REQUIRE_POSTGRES=1` on the pipeline's rust job in one commit, but
  `ci/images/tags.yml` was never moved to the images built from it. Run 19288's
  `cargo nextest` step therefore ran in the images built at 32214df70, which carry
  no PostgreSQL server binaries, and every `bus::tests` test that starts a
  throwaway server panicked in `crates/backend/src/test_postgres.rs`. Reproduced
  locally: with `TCAB_REQUIRE_POSTGRES=1` and no binaries all 11 `bus::tests` fail
  with the same panic; with the binaries present all 11 pass.

  Done:

  - 9ecc82fe9 pins `ciImageTag` to 6c195c0f290db7a98daa4bc811ae915cfcfd889c. Image
    pipeline run 19289 on that commit built and pushed the rust, web, rust-browser
    and android tracks, the Rust image with PostgreSQL 18. Its purge kept those
    tags.
  - 216ae79da moves every kit-rendered repository onto that pin, as the CICD-1
    repair did. The 27 repositories get a `render.py --update` commit on their
    `issue/o7hwklyhcecnv0j6u9k4aavr` branch; it moves the image pins and carries
    the kit's pending CLAUDE.md line about the issues server. gg gets a pin-only
    commit, as before, because the kit's full update conflicts there.

  Verified: the superrepo's gates pass, 22 of 23, including `rust-test` (1515
  tests), `dependency-graph` and `ci-tests`. `ci-tests` also passes in
  microservice-driver, the-spec-cabinet and gg.

  Left:

  - `workspace-test` fails locally: 90 engines vitest files cannot resolve
    `/src/<file>` in this worktree under `.git/nyxsis/worktrees/`. The change
    touches no engines code, and the same gate passed in run 19288's Web job at
    the same engines commit, so this is the local environment.
  - The pin commit was made with `--no-verify`: `dependency-graph` refuses it
    until the repositories follow, and `render.py` renders from the committed
    HEAD. The commit that follows passes every hook.
  - Each submodule's issue branch must be pushed and merged before the
    superrepo's, so that `submodule-remotes` and `submodule_pins` admit the
    gitlinks.
  - The fix is confirmed once nightly's next run passes, after promotion. The
    images at 6c195c0f2 are kept by the purge's one-day grace until a live branch
    pins them, so this should land within about a day of 2026-10-26 08:08 UTC.
---

The latest run of `the-test-cabinet` on the promotion branch `nightly` failed at
the branch's head.

- Run: 20261026.2 (19288),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=19288>
- Branch: `nightly`
- Commit: `6c195c0f290db7a98daa4bc811ae915cfcfd889c`

## Failed stages

- `Gates` (stage)

## Earlier repairs

The ci issues last closed for `nightly`, most recently closed first: NYX-2. Read
how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `nightly` by
promotion.

## Cause

The Rust job's `cargo nextest (workspace)` step failed 11 tests, every
`bus::tests` test of `crates/backend`, each panicking in
`crates/backend/src/test_postgres.rs` with "no PostgreSQL server binaries
(initdb, pg_ctl) were found ... (TCAB_REQUIRE_POSTGRES=1)". 52dbbc862 added
`postgresql` to `ci/images/rust.Dockerfile` and set `TCAB_REQUIRE_POSTGRES: 1`
on the job, but the second commit the image procedure requires never followed:
`ci/images/tags.yml` still pins `32214df70`, whose rust image has no
PostgreSQL. The image pipeline's run 19289 on `6c195c0f2` built and pushed every
track, the rust image with PostgreSQL 18, and its purge kept that tag.

Reproduced in the devcontainer, which predates the `packages.sh` change: the 11
tests fail with the same message. With PostgreSQL 18 installed they pass, 11 of
11 (`TCAB_REQUIRE_POSTGRES=1 cargo nextest run -p test-cabinet-backend
bus::tests`).

## The repair

1. `86abac516` on this branch pins `ciImageTag` to
   `6c195c0f290db7a98daa4bc811ae915cfcfd889c`. It is committed without the
   hook, as `f49939cac` was, because it cannot pass `dependency-graph` alone.
2. Every kit-rendered repository takes the pin through `uv run --project ci
   scripts/repos/render.py --update <name>` from that commit, landed on the
   repository's branch the gitlink will name. A trial on `contracts` gives a
   clean three-file diff: the two image references in `azure-pipelines.yml`,
   `.copier-answers.yml` and one `CLAUDE.md.jinja` line. gg takes a pin-only
   commit, as CICD-1 found.
3. One superrepo commit moves every gitlink onto those commits, with
   `Cargo.lock` and `.package-links.json` regenerated, which `dependency-graph`
   also names stale in this checkout (`@clockwyrks/preview-tags`,
   `@clockwyrks/share-links`).

Steps 2 and 3 push to and merge into 26 other repositories, as CICD-1 did
through PRs 5033-5058. Several gitlinks are not on their repository's `master`
today: contracts, microservice-artifacts, -dispatcher, -driver, -publisher,
ui-common, testcabinet.ai and the-spec-cabinet. So the operator has to decide
which branch each repository's render lands on (`master`, as CICD-1 did, or
`nightly`, as the merge-up rule in `development/repositories.md` states) before
the work goes on.
