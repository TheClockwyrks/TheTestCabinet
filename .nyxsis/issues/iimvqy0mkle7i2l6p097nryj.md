---
format: nyxsis-issue
version: 3
id: iimvqy0mkle7i2l6p097nryj
zone: REPOS
number: 23
title: Move the testcabinet.ai pointer to its master merge after the prod deploy
type: generic
priority: 3
state: done
created: 2026-10-22T11:50:07.23380437Z
done: 2026-10-22T14:59:02.858745461Z
outcome: |
  PR 5008 completed in testcabinet.ai and its master run 18216 deployed the Pages
  project the-test-cabinet from master merge 4600d3ba (production deployment
  0b882875; https://testcabinet.ai/, /runs and a run page answer 200). The GitHub
  mirror TheClockwyrks/testcabinet.ai defaults to master, which equals Azure's
  master. The superrepo's testcabinet.ai pointer moved to 4600d3ba in PR 5016 into
  nightly (15b72382c); dependency-graph, ci-tests and shell-tests passed on the
  branch.
---

The superrepo's `testcabinet.ai` submodule names the repository's `staging`
commit, and the GitHub mirror's default branch is `nightly`. The
documentation pins a repository at a commit its `master` pipeline built and
has every mirror default to `master`:
`apps/docs/src/content/docs/development/repositories.md`, sections "How a
dependency is named" and "The mirror", and
`apps/docs/src/content/docs/development/releasing.md`, section "Gallery
(Cloudflare Pages and Workers, one-time)".

## What is missing

Once the repository's pull request of `staging` into `master` has completed
and its `master` run has deployed the Pages project `the-test-cabinet`:

- The submodule pointer moved to the `master` merge commit, with
  `dependency-graph` and `ci-tests` passing.
- The GitHub mirror `TheClockwyrks/testcabinet.ai` defaulting to `master`
  with `master` mirrored.

The superrepo's `master` must receive the pointer only after that deploy,
since the daily Pages deploy hook builds from the superrepo mirror's `master`
until the hook is retired.

## Verify

`https://testcabinet.ai/` and a run page answer 200 from the `master`
pipeline's deployment, `git -C testcabinet.ai log -1` names the `master`
merge, and `make gate` passes in the superrepo.
