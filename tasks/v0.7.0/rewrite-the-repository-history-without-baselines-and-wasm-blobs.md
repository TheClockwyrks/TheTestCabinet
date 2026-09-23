# Rewrite the repository history without baselines and wasm blobs

Rewrite every branch and tag from the root so the pack holds neither the
baseline media nor the sandbox wasm binaries, then force-push the result to both
hosts and re-clone everywhere.

This issue runs after
[`move-validation-baselines-into-the-cold-storage-submodule.md`](done/move-validation-baselines-into-the-cold-storage-submodule.md)
and
[`port-the-gg-and-tooling-changes-from-the-spec-cabinet-branch-onto-feat-gg.md`](port-the-gg-and-tooling-changes-from-the-spec-cabinet-branch-onto-feat-gg.md),
and before the mirror job in
[`build-ci-cd-on-azure-pipelines-with-deploys-to-staging-and-prod.md`](build-ci-cd-on-azure-pipelines-with-deploys-to-staging-and-prod.md)
is enabled and before
[`cut-v0-7-0-through-the-azure-release-route.md`](cut-v0-7-0-through-the-azure-release-route.md).

## Current state

The pack is dominated by two kinds of blob that the tree no longer needs.

| Reachable set                                       | Compressed size |
| --------------------------------------------------- | --------------- |
| Whole pack                                          | 5.37 GiB        |
| `validation-baseline/` blobs across all refs        | 4.61 GiB        |
| `crates/gg/src/sandbox` wasm and gz blobs, all refs | 0.19 GiB        |
| `master` alone                                      | 0.89 GiB        |
| Expected after the rewrite                          | about 0.3 GiB   |

The wasm and gz files are already deleted from the tree. The baselines leave the
tree in the cold-storage issue, so by the time this runs both kinds exist only in
history.

GitHub holds `master` at v0.6.3, `staging`, `nightly`, and the tags v0.5.0
through v0.6.3. Published run records reference no commit sha, and the data
recorded before v1.0 is disposable, so nothing consumes the old hashes.

## Design

### Prune first

The dead remote branches are deleted before the rewrite so that only `master`,
`staging`, `nightly`, `feat/gg`, `feat/the-spec-cabinet` and `feat/share-links`
are rewritten. The deletions are `feat/card-games`, `feat/e2e-rework`,
`feat/full-stack-easy`, `feat/full-stack-rework`, `feat/gantry-bringup`,
`feat/puzzle-games`, `feat/v0.7.0-finalization-set-1` through `-5`,
`feat/v0.7.0-test-cases`, `fix/declank-assest-generation-cases`, `rel/v0.7.0`,
and `ttc/arc-foundry`, `ttc/caldera`, `ttc/carom`, `ttc/cascade`, `ttc/fathom`,
`ttc/meltdown`.

`feat/share-links` is kept because
[`move-the-gallery-origin-design-pages-onto-the-share-links-branch.md`](move-the-gallery-origin-design-pages-onto-the-share-links-branch.md)
resets it afterwards. `rel/v0.7.0` is stale and the release issue recreates it.

### The rewrite

On a fresh clone, `git filter-repo` strips the two path sets from every commit:

```sh
git filter-repo \
  --path-glob '*/validation-baseline/*' \
  --path-glob 'crates/gg/src/sandbox/*.wasm' \
  --path-glob 'crates/gg/src/sandbox/*.gz' \
  --invert-paths
```

Tags are rewritten with the commits they point at. Frozen markers in old commits
record digests that no longer match those commits; only the tip is checked, and
the cold-storage issue re-freezes the tip.

### Publishing the result

Every branch and tag is force-pushed to Azure and then to GitHub. On Azure the
branch policies on `master` are lifted for the push and force push is granted
to the pushing identity, then both are restored. GitHub Releases stay attached
to their tag names. Azure reports the smaller size only after its background
garbage collection runs.

Every existing clone is discarded and re-cloned, including the devcontainer's.

## Done when

- [ ] The listed branches are deleted on Azure.
- [ ] A fresh clone of `master` holds no `validation-baseline/` blob and no
      sandbox wasm or gz blob in any reachable commit.
- [ ] Every surviving branch and tag on Azure and on GitHub points at a
      rewritten commit, and each GitHub Release still resolves at its tag.
- [ ] The frozen check passes at the tip of every surviving branch.
- [ ] The devcontainer clones fresh and builds.
