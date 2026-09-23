# Address submodules by relative URL and mirror them to GitHub

Make every submodule resolvable from both hosts by writing its URL relative to
the superproject, mirroring each submodule repository to GitHub, and gating the
superproject on pins that the mirror already holds.

## Current state

`.gitmodules` on `feat/the-spec-cabinet` points `test-suites` at
`git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/test-suites`. Development
stays on Azure and the Azure repositories stay private, so a clone from the
GitHub mirror cannot fetch that submodule. The cold-storage submodule added by
[`move-validation-baselines-into-the-cold-storage-submodule.md`](done/move-validation-baselines-into-the-cold-storage-submodule.md)
has the same problem.

Nyxsis already mirrors to GitHub: `scripts/ci/mirror.sh` force-pushes the gated
commit with a deploy key kept as a pipeline secure file, from a job that runs
after the gates. Its `submodules.sh` rewrites each SSH URL to HTTPS with the job
token so a build agent can fetch.

## Design

### Relative URLs

Each submodule URL is written relative to the superproject: `../cold-storage`
and, on the Spec Cabinet branch, `../test-suites`. Git resolves a relative URL
against the remote the superproject was cloned from. On Azure that is the
sibling repository in the same project, and on GitHub it is
`TheClockwyrks/<same name>`. The superproject's own name may differ between
hosts; only the submodule names must match.

Every repository in the Azure project follows one address pattern,
`git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/<name>`, with `<name>` one
of `the-test-cabinet`, `cold-storage`, `test-suites`, `contracts`, `gg`,
`the-spec-cabinet` and `blog.testcabinet.ai`. A relative `../cold-storage` in a
clone of `the-test-cabinet` therefore resolves to
`git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/cold-storage`, and a clone
over HTTPS resolves to the same repository's HTTPS address.

### Mirrors

Each submodule repository has a GitHub mirror named exactly as on Azure
(`cold-storage`, `test-suites`), created empty with the mirror's deploy key
installed. Each submodule repository carries its own Azure pipeline whose only
job mirrors `master` after its gates, using the same script and secure-file
pattern as Nyxsis. The GitHub copies are mirrors and receive nothing by hand.

### The pin gate

The superproject's pipeline gains a gate that every pinned submodule commit is an
ancestor of that submodule's `master`. A commit can only be pinned once it is on
the submodule's `master`, and `master` is what the submodule mirrors, so a
superproject commit that reaches the GitHub mirror always names a submodule
commit the mirror already holds.

### Fetching in CI

The Azure checkout task fetches a same-project submodule over HTTPS with the job
token when the submodule URL is relative, which replaces the Nyxsis URL
rewriting script. Jobs that need a submodule set `submodules: true`; the rest
keep it off.

### Documentation

`development/building.md` describes cloning with and without submodules and
what each choice downloads. The ingest sidecar's clone from the GitHub mirror
includes the submodule, as the cold-storage issue specifies.

`cold-storage` gets this treatment on `feat/gg` now. `test-suites` gets it when
`feat/the-spec-cabinet` lands.

## Done when

- [ ] `.gitmodules` names every submodule by a relative URL.
- [ ] `git clone --recurse-submodules` succeeds from Azure and from the GitHub
      mirror.
- [ ] `cold-storage` and `test-suites` exist on GitHub under their Azure names,
      and each is pushed only by its own pipeline's mirror job.
- [ ] The superproject pipeline fails on a submodule pin that is absent from
      that submodule's `master`.
- [ ] An Azure job with submodules on fetches them with the job token and no
      URL rewriting.
- [ ] `development/building.md` documents both clone shapes.
- [ ] Gates green.
