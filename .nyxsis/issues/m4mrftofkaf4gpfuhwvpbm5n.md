---
format: nyxsis-issue
version: 3
id: m4mrftofkaf4gpfuhwvpbm5n
zone: REPOS
number: 26
title: Move the Spec Cabinet's default port off 8792, which the repos forward holds
type: bug
priority: 2
state: open
created: 2026-10-24T04:52:49.874537546Z
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
