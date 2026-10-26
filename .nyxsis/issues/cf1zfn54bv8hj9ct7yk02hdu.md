---
format: nyxsis-issue
version: 3
id: cf1zfn54bv8hj9ct7yk02hdu
zone: NYX
number: 10
title: Resolve the conflict landing ARENA-1
type: conflict
priority: 0
state: done
branch: issue/tdr9hbk4hq2c93hj9maqvdez
created: 2026-10-26T21:24:27.656922816Z
modified: 2026-10-26T21:48:46.247685468Z
done: 2026-10-26T21:48:46.247685468Z
outcome: |
  Rebased `issue/tdr9hbk4hq2c93hj9maqvdez` onto `nightly` (9839203f3). The three
  conflicts came from BACK-4's replica coordination landing beside ARENA-1's
  tournament recording. In `crates/backend/src/db.rs` both modules are kept
  (`db.replicas.rs` and `db.tournaments.rs`). In `crates/backend/src/lib.test.rs`
  both tests are kept: the draining test with its `open` helper, and the
  tournament routes test with its `send_json` helper. In
  `crates/migration/src/lib.rs`, ARENA-1's migration is renumbered to
  `m20261026_000069_record_tournament_progress`, after nightly's
  `000068_create_relay_tables`.

  The rebase also showed that ARENA-1's `engines` and `microservice-arena` commits
  sat on older bases than the master commits nightly pins, so landing them would
  have rolled back nightly's CI image and release commits. Both submodule branches
  are rebased onto `origin/master` without conflict (engines 3765b96, arena
  5ec4572), and the superrepo records the new pins. The remotes' `nightly`
  branches still hold the old, pre-rebase commits the earlier landing pushed
  (83696d6, 6f4dad2), so the next landing has to replace them.

  Verified: the superrepo's rust gates (clippy, doc, doctest, fmt; nextest
  1522/1522), plus the docs, format, k8s and shell gates. Engines' own gates pass
  except `cspell`, whose `npm run spell` checks no files: a gate fault, not caused
  by this change, which touches only Rust. The arena builds clean under clippy and
  passes 58/58 tests against the local `contracts` and `engines` checkouts, using
  a temporary `cargo update` that was thrown away. Its standalone lock still pins
  contracts v0.2.3 and engines v1.1.2, which lack the new APIs, so a standalone
  build waits on contracts and engines releases.

  Left for nightly (NYX-8), not caused by this branch: `dependency-graph` and two
  `ci-tests` fail on testcabinet.ai's CI image pin and the unlinked
  `@clockwyrks/preview-tags` and `@clockwyrks/share-links` packages that SITE-2
  brought. `workspace-test` fails in the engines web packages with "Cannot find
  module", untouched by this change.
---

The landing of ARENA-1 stopped at the rebase: rebasing
`issue/tdr9hbk4hq2c93hj9maqvdez` onto `nightly` conflicted, so the rebase was
aborted and the worktree stands clean on its branch with nothing landed.

- The worktree's branch: `issue/tdr9hbk4hq2c93hj9maqvdez`, at
  `f22ed15ba7e3a7c72473e71242afc4a388c1524e`.
- The branch it lands on: `nightly`, at
  `d66f4f6a78ef5be7a9173a48234f56d7fdf8e45f`.

Git's conflict output:

```text
Auto-merging crates/backend/src/api.rs
Auto-merging crates/backend/src/db.rs
CONFLICT (content): Merge conflict in crates/backend/src/db.rs
Auto-merging crates/backend/src/lib.test.rs
CONFLICT (content): Merge conflict in crates/backend/src/lib.test.rs
Auto-merging crates/entities/src/lib.rs
Auto-merging crates/migration/src/lib.rs
CONFLICT (content): Merge conflict in crates/migration/src/lib.rs
Rebasing (1/12)Rebasing (2/12)Executing: <the landing's submodule re-pin>
Rebasing (3/12)
error: could not apply 659edc37d... feat(backend): record tournaments as the arena plays them
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 659edc37d... # feat(backend): record tournaments as the arena plays them
```

Before it stopped, the landing pushed the target branch of these submodules to
each one's remote, which therefore holds each work no commit on the main
checkout's upstream records yet: `microservice-arena`, `engines`, `contracts`.

Rebase `issue/tdr9hbk4hq2c93hj9maqvdez` onto `nightly` in this worktree, resolve
each conflict and continue the rebase until it completes, then close this issue.
Once it is closed, Nyxsis lands the branch again, the check command included.
