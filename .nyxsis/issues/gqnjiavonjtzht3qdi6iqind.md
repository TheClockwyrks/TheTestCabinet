---
format: nyxsis-issue
version: 3
id: gqnjiavonjtzht3qdi6iqind
zone: NYX
number: 12
title: Resolve the conflict landing DEPLOY-2
type: conflict
priority: 0
state: done
branch: issue/ak5nksdbxdkkx19zwqvv9jo7
created: 2026-10-26T21:27:36.96747467Z
modified: 2026-10-27T19:02:35.23887283Z
done: 2026-10-27T19:02:35.23887283Z
outcome: |
  The operator fast-forwarded `microservice-repos`' `nightly` to `30f3f78`, so its
  branch `issue/ak5nksdbxdkkx19zwqvv9jo7` (`b51c21a`) now stands on `nightly` and
  rebases as a no-op.

  Since the landing would stop next at other submodules whose `nightly` moved,
  each DEPLOY-2 submodule branch was rebased onto its `nightly` too:

  - `microservice-arena` (`a839c42`): a real merge with nightly's tournament
    record/resume. The branch's drain latch was folded into nightly's `Shutdown`
    (Serving → Draining → Refusing). `/readyz` answers 503 at SIGTERM while
    `/healthz` stays 200, and live streams end. Requests are served through the 5
    s drain delay, then refused with 503 `stopping`, judged by arrival. Each
    tournament finishes and records its current match within
    `TCAB_ARENA_SHUTDOWN_GRACE_SECONDS` (50), and the arena exits 0. The listener
    now closes at the end of the delay instead of staying open until the last
    tournament stops, and the error code is `stopping` instead of `shutting_down`
    (nothing else uses it).
  - `console.testcabinet.ai` (`5d3ac37`): only the stop-signal commit was replayed
    onto `nightly`, which is a separate lineage from the `master` the branch sat
    on.
  - `microservice-artifacts` (`c491f09`) and `microservice-dispatcher` (`f3831c6`)
    rebased cleanly.

  The superrepo branch was rebased onto `nightly`.
  `deployments/k8s/base/arena.yaml` keeps nightly's comments plus DEPLOY-2's note
  that the arena has no disruption budget. The arena's Shutdown section in
  `components/arena/overview.md` was rewritten for the merged behaviour. The
  submodule pointers now record the rebased commits. NYX-9's issue file was
  wrapped so markdownlint passes.

  Gates:
  - artifacts, dispatcher, repos: every gate passes. cspell can't run without an
    npm install, and it checks only Markdown, which these commits don't touch.
  - superrepo: 19 of 23 pass, including rust-test (1528), docs-build and
    k8s-manifests. These failures are already on `nightly`:
    - dependency-graph: the submodules' pipelines name the CI images at
      `2610dc98c`, but `ciImageTag` is `32214df70`, and the root lock reports
      stale. No DEPLOY-2 commit touches a manifest or lock.
    - ci-tests: two tests that mirror those gates.
    - workspace-test: the engines packages aren't installed in this worktree
      ("Cannot find module").
  - arena: in its own checkout, `rust-clippy`, `rust-doc` and `rust-test` fail to
    compile against the `contracts` `v0.2.3` and `engines` `v1.1.2` tags it pins.
    That comes from nightly's 6f4dad2 and is filed as ARENA-2. The merge itself
    passes fmt, clippy, doc and 70/70 tests in a build against `contracts` 48d4118
    and `engines` bf06d7f.

  Left: ARENA-2, and nightly's CI image pin following `2610dc98c`.
---

The landing of DEPLOY-2 stopped at a submodule's rebase, in the submodule
`microservice-repos`: the submodule's branch `issue/ak5nksdbxdkkx19zwqvv9jo7`
could not be rebased onto its target branch `nightly`, so the rebase was aborted
and the submodule stands clean on its branch with nothing landed.

- The submodule: `microservice-repos`.
- The submodule's branch: `issue/ak5nksdbxdkkx19zwqvv9jo7`, at
  `b51c21ac2a72893b083bbd2935066399cef7182e`.
- Its target branch: `nightly`, at `783a27ea37a26303d0e78cbe1af3f57e70f6e9ff`.

Git's output:

```text
the submodule `microservice-repos`'s branch `issue/ak5nksdbxdkkx19zwqvv9jo7` at
  b51c21ac2a72893b083bbd2935066399cef7182e could not be rebased onto its target
  branch `nightly` at 783a27ea37a26303d0e78cbe1af3f57e70f6e9ff, its work past
  the commit 30f3f78dd18b614b411689a5659d44fbc4d3565d the main checkout's branch
  records for it replayed alone:
CONFLICT (modify/delete): crates/repos/src/api.rs deleted in HEAD and modified
  in 266f30e (feat(repos): drain in-flight requests on SIGTERM).  Version
  266f30e (feat(repos): drain in-flight requests on SIGTERM) of
  crates/repos/src/api.rs left in tree.
CONFLICT (modify/delete): crates/repos/src/api.test.rs deleted in HEAD and
  modified in 266f30e (feat(repos): drain in-flight requests on SIGTERM).
  Version 266f30e (feat(repos): drain in-flight requests on SIGTERM) of
  crates/repos/src/api.test.rs left in tree.
CONFLICT (modify/delete): crates/repos/src/lib.rs deleted in HEAD and modified
  in 266f30e (feat(repos): drain in-flight requests on SIGTERM).  Version
  266f30e (feat(repos): drain in-flight requests on SIGTERM) of
  crates/repos/src/lib.rs left in tree.
Auto-merging crates/repos/src/main.rs
CONFLICT (content): Merge conflict in crates/repos/src/main.rs
Rebasing (1/2)error: could not apply 266f30e... feat(repos): drain in-flight
  requests on SIGTERM
Could not apply 266f30e... # feat(repos): drain in-flight requests on SIGTERM
```

Rebase `issue/ak5nksdbxdkkx19zwqvv9jo7` in the submodule `microservice-repos`
onto its target branch `nightly`, resolve each conflict and continue the rebase
until it completes, then close this issue. Once it is closed, Nyxsis lands the
branch again, the check command included.

## Findings

The submodule's `nightly` (`origin/nightly`, also `origin/staging`) is stale:
it stands at `783a27e` (chore: scaffold the microservice-repos repository), an
ancestor of `30f3f78`, the commit the superrepo's `nightly` pins for
`microservice-repos`. The submodule's branch already contains `783a27e`, so it
is already on top of `nightly`; there is nothing on `nightly` to rebase over.

Replaying only the two DEPLOY-2 commits (`266f30e`, `b51c21a`) onto the scaffold
cannot keep both sides' intent: the scaffold lacks the whole service the commits
modify (`api.rs`, `lib.rs`, the full `main.rs`, about 8,000 lines added on
`master` between `783a27e` and `30f3f78`). Resolving it would mean either
dropping the service or folding all of `master`'s history into the DEPLOY-2
commits, and a plain `git rebase nightly` flattens `master`'s merge commits,
rewriting history already on `origin/master`. None of these is correct, so the
branch is left unchanged at `b51c21a`.

The fix is to bring the submodule's `nightly` up to what the superrepo's
`nightly` pins: fast-forward `origin/nightly` of `microservice-repos` to
`30f3f78` (`git push origin
30f3f78dd18b614b411689a5659d44fbc4d3565d:refs/heads/nightly` in the submodule).
The DEPLOY-2 commits then replay onto it cleanly, since `30f3f78` is their
parent. `staging` stands at the same scaffold commit and likely needs the same
move before a staging landing.
