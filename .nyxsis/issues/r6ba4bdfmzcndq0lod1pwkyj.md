---
format: nyxsis-issue
version: 3
id: r6ba4bdfmzcndq0lod1pwkyj
zone: NYX
number: 9
title: Resolve the conflict landing SITE-1
type: conflict
priority: 0
state: done
branch: issue/z2c61iiajegk8huhkfbjyc28
created: 2026-10-26T21:21:25.932035906Z
modified: 2026-10-26T21:29:14.95852369Z
done: 2026-10-26T21:29:14.95852369Z
outcome: |
  Rebased `testcabinet.ai`'s branch `issue/z2c61iiajegk8huhkfbjyc28` onto
  `nightly` (f94a699), now at df38522. The conflicts in `CLAUDE.md` and
  `README.md` keep both sides: nightly's preview-tag and share-link Worker rows
  and its `deploy-workers.sh` paragraph, plus the branch's runtime snapshot reader
  (`apps/site/src/snapshot/`), which replaces the build-time plugin row. Both "not
  here yet" paragraphs are dropped, because the Workers and the runtime read are
  now both present.

  Also rebased the superrepo branch onto `nightly`. `deployment/public-gallery.md`
  keeps nightly's "Each Worker only reads its bucket binding" and adds the
  branch's CORS paragraph. The `testcabinet.ai` pointer moves to df38522, and the
  `microservice-artifacts` checkout is fast-forwarded to the aa49638 that nightly
  pins.

  Gates run:
  - testcabinet.ai: the `scripts/ci` shell tests pass. prettier and markdownlint
    pass on the two resolved files, run with the superrepo's tools.
  - testcabinet.ai: the workspace's npm gates (typescript, web-lint, cspell,
    format, markdownlint) could not run, because `npm install` from the package
    feed failed with E401 in this container.
  - Superrepo: format, cspell and docs-build pass. markdownlint fails only on two
    overlong lines of quoted git output in this issue file, which were left as
    Nyxsis wrote them.
---

The landing of SITE-1 stopped at a submodule's rebase, in the submodule
`testcabinet.ai`: the submodule's branch `issue/z2c61iiajegk8huhkfbjyc28` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `testcabinet.ai`.
- The submodule's branch: `issue/z2c61iiajegk8huhkfbjyc28`, at
  `0988b776787a1986f8f5d7b07bc091ded1d14776`.
- Its target branch: `nightly`, at `f94a6990b2a2e5a006cf27e1a4346193c72ead30`.

Git's output:

```text
the submodule `testcabinet.ai`'s branch `issue/z2c61iiajegk8huhkfbjyc28` at
0988b776787a1986f8f5d7b07bc091ded1d14776 could not be rebased onto its target
branch `nightly` at f94a6990b2a2e5a006cf27e1a4346193c72ead30, its work past the
commit 6449eed43de017849266d26eeec9780257c737c1 the main checkout's branch
records for it replayed alone:
Auto-merging .azure/project/stages.yml
Auto-merging CLAUDE.md
CONFLICT (content): Merge conflict in CLAUDE.md
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
Auto-merging eslint.config.js
Rebasing (1/1)
error: could not apply 0988b77... feat(site): read the published dataset from the bucket
at runtime
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 0988b77... # feat(site): read the published dataset from the bucket at
runtime
```

Rebase `issue/z2c61iiajegk8huhkfbjyc28` in the submodule `testcabinet.ai` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
