---
format: nyxsis-issue
version: 3
id: cf1zfn54bv8hj9ct7yk02hdu
zone: NYX
number: 10
title: Resolve the conflict landing ARENA-1
type: conflict
priority: 0
state: open
branch: issue/tdr9hbk4hq2c93hj9maqvdez
created: 2026-10-26T21:24:27.656922816Z
modified: 2026-10-26T21:24:27.656922816Z
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
Rebasing (1/12)Rebasing (2/12)Executing: git ls-files -s | while read -r m s t p; do [ "$m" = 160000 ] || continue; n=$(printf '%s\n' "$NYXSIS_REPLACED" | sed -n "s/^$s //p"); [ -z "$n" ] || git update-index --cacheinfo "160000,$n,$p" || exit 1; done && { git diff --cached --quiet --ignore-submodules=none || git -c core.hooksPath=/dev/null commit --amend --no-edit --no-verify --quiet --allow-empty --cleanup=verbatim; }
Rebasing (3/12)error: could not apply 659edc37d... feat(backend): record tournaments as the arena plays them
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 659edc37d... # feat(backend): record tournaments as the arena plays them
before it stopped, the landing pushed the target branch of these submodules to each one's remote, which therefore holds each work no commit on the main checkout's upstream records yet: `microservice-arena`, `engines`, `contracts`
```

Rebase `issue/tdr9hbk4hq2c93hj9maqvdez` onto `nightly` in this worktree, resolve
each conflict and continue the rebase until it completes, then close this issue.
Once it is closed, Nyxsis lands the branch again, the check command included.
