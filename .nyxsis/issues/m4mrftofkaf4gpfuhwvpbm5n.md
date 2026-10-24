---
format: nyxsis-issue
version: 3
id: m4mrftofkaf4gpfuhwvpbm5n
zone: REPOS
number: 26
title: Move the Spec Cabinet's default port off 8792, which the repos forward holds
type: bug
priority: 2
state: done
created: 2026-10-24T04:52:49.874537546Z
done: 2026-10-24T05:01:34.099392532Z
outcome: |
  The Spec Cabinet now binds `127.0.0.1:8793` by default, clear of every port
  `local-forward` holds (8787, 8790, 8791, 8792, 3000). The new default is the
  same in all of its places: `DEFAULT_BIND` in
  `crates/spec-cabinet/src/config.rs`, `DEFAULT_API` in
  `apps/spec-cabinet/vite.config.ts`, `DEFAULT_BIND` in
  `scripts/lib/spec-cabinet.mjs`, `.env.spec-cabinet.example` and the app README.
  The test `the_default_bind_is_clear_of_every_port_the_local_forward_holds` used
  to list 8789, which the forward does not hold, and left out 8792, which it does.
  It now lists the ports the forward actually holds. That change is commit 6c46694
  of `the-spec-cabinet`, and the superrepo's pointer now names that commit.

  `development/running.md`, `quickstarts/development/launch-the-spec-cabinet.md`
  and `the-spec-cabinet/architecture.md` now give 8793 as the default, and the
  `TCAB_SPEC_CABINET_BIND=127.0.0.1:8793` workaround is gone.

  The config, provider and scripts tests pass, as do rustfmt, prettier,
  markdownlint and the docs build and typecheck. The cspell gate cannot run in a
  worktree under `.git/nyxsis/`, because its `**/.git/**` ignore pattern skips
  every file there. The changed prose was spell-checked from a copy outside
  `.git/` instead and had no issues. The Verify step was not run, because no local
  stack was up.
---

`apps/docs/src/content/docs/development/running.md` has
`make -C deployments/local local-forward` forward the repos service to
`127.0.0.1:8792` (`deployments/local/Makefile`). The Spec Cabinet binds the
same port by default, and the `the-spec-cabinet` repository says in three
places that the port is clear of the local stack. Those places are
`crates/spec-cabinet/src/config.rs` (`DEFAULT_BIND`, along with its module
docs), `apps/spec-cabinet/vite.config.ts` (`DEFAULT_API`) and
`.env.spec-cabinet.example`.

## What is missing

- A default bind port that no forward of the local stack uses, held the same
  way in the backend's default, the Vite proxy's default and the example env
  file.
- The quickstart `quickstarts/development/launch-the-spec-cabinet.md` and the
  page `the-spec-cabinet/architecture.md` give the new default. They currently
  tell a reader running beside the stack to set
  `TCAB_SPEC_CABINET_BIND=127.0.0.1:8793`; once the default changes, that
  workaround should be dropped.
- The superrepo's `the-spec-cabinet` pointer moved to the commit that does
  this.

## Verify

With `local-forward` running, `npm run spec-cabinet` in the checkout starts
without setting `TCAB_SPEC_CABINET_BIND`, and the UI reaches its backend.
