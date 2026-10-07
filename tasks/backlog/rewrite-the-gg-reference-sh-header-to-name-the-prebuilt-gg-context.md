# Rewrite the gg-reference.sh header to name the prebuilt gg context

`scripts/gg-reference.sh`'s header has a section headed "WHO RUNS IT, AND WHY THERE ARE
EXACTLY TWO ANSWERS". Its first answer states that
`deployments/images/services.Dockerfile`'s `gg-build` stage projects the reference
documents from the binary it just linked, and that a deployed backend therefore serves
documents from that link. For every image deployed to staging or production this is now
incomplete.

`scripts/ci/service-image.sh` passes `--build-context gg-build=<dir>` for the backend and
driver targets, which replaces that stage. The documents come from `gg-reference.tar.gz`
in the gates stage's `gg-<arch>` artifact, staged by `scripts/ci/gg-prebuilt.sh`. The
claim holds only on the offline local path, which is `make -C deployments/local images`
and `docker compose -f deployments/local/compose.yml up backend`.

Rewrite the first answer so it distinguishes the two, matching the stage header in
`deployments/images/services.Dockerfile`. The property the section argues for is
unchanged: the documents still come from the same link of gg that the driver image bakes
and the run images are self-checked against.

## Why it is not already done

When this was filed, `scripts/gg-*.sh` was one of the paths the Rust CI image's tag was
content-addressed over, so editing this file forced a CI image rebuild and pin bump. On the
template layout it no longer is: `scripts/ci/ci-image.sh inputs rust` names only the
image's own files, so the edit is free. The authoritative description in
`apps/docs/src/content/docs/gg/reference.md` is already correct, so the stale text is
confined to this one header.
