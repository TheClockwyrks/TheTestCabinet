---
format: nyxsis-issue
version: 3
id: gqnjiavonjtzht3qdi6iqind
zone: NYX
number: 12
title: Resolve the conflict landing DEPLOY-2
type: conflict
priority: 0
state: open
branch: issue/ak5nksdbxdkkx19zwqvv9jo7
created: 2026-10-26T21:27:36.96747467Z
modified: 2026-10-26T21:27:36.96747467Z
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
the submodule `microservice-repos`'s branch `issue/ak5nksdbxdkkx19zwqvv9jo7` at b51c21ac2a72893b083bbd2935066399cef7182e could not be rebased onto its target branch `nightly` at 783a27ea37a26303d0e78cbe1af3f57e70f6e9ff, its work past the commit 30f3f78dd18b614b411689a5659d44fbc4d3565d the main checkout's branch records for it replayed alone:
CONFLICT (modify/delete): crates/repos/src/api.rs deleted in HEAD and modified in 266f30e (feat(repos): drain in-flight requests on SIGTERM).  Version 266f30e (feat(repos): drain in-flight requests on SIGTERM) of crates/repos/src/api.rs left in tree.
CONFLICT (modify/delete): crates/repos/src/api.test.rs deleted in HEAD and modified in 266f30e (feat(repos): drain in-flight requests on SIGTERM).  Version 266f30e (feat(repos): drain in-flight requests on SIGTERM) of crates/repos/src/api.test.rs left in tree.
CONFLICT (modify/delete): crates/repos/src/lib.rs deleted in HEAD and modified in 266f30e (feat(repos): drain in-flight requests on SIGTERM).  Version 266f30e (feat(repos): drain in-flight requests on SIGTERM) of crates/repos/src/lib.rs left in tree.
Auto-merging crates/repos/src/main.rs
CONFLICT (content): Merge conflict in crates/repos/src/main.rs
Rebasing (1/2)error: could not apply 266f30e... feat(repos): drain in-flight requests on SIGTERM
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 266f30e... # feat(repos): drain in-flight requests on SIGTERM
```

Rebase `issue/ak5nksdbxdkkx19zwqvv9jo7` in the submodule `microservice-repos`
onto its target branch `nightly`, resolve each conflict and continue the rebase
until it completes, then close this issue. Once it is closed, Nyxsis lands the
branch again, the check command included.
