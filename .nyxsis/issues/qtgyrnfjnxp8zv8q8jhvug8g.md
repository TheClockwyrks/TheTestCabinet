---
format: nyxsis-issue
version: 3
id: qtgyrnfjnxp8zv8q8jhvug8g
zone: CASE
number: 1
title: Ship and seed the workspace lockfile so a run starts from a committed one
type: generic
state: done
created: 2026-10-18T23:42:30.801810532Z
done: 2026-10-20T03:46:55.690825333Z
outcome: |
  Landed as superrepo PR 4562 into nightly with contracts PR 4511, test-suites PRs
  4528 and 4530 and engines PR 4529: lockfile resolution checks in the suites
  crate, seeding that vendors the engine at its declared .vendor/packages path and
  holds vendored copies to the lockfile, a workspace-lockfiles tool in
  test-suites, and shipped lockfiles for all 42 workspaces of the unfrozen
  versions. Left for the user: carom (pong) v3.0.0 has prod runs but no .frozen
  marker and was edited in place; the lockfiles pin engines 1.1.1 and
  asset-contract 0.2.1, so an engines release means regenerating them. Not
  exercised: a run on a local or staging deployment reaching validation from the
  committed lockfile.
---

A code-producing case ships a `package.json` and no lockfile, its init runs `npm
install`, and the lockfile that install writes is left untracked in the seeded
repository for the model to commit. The documentation has the workspace ship the
`package-lock.json` that pins its `package.json`, links each package and engine
dependency at its vendored `file:` path, is committed in the seed commit like
every workspace file, and is installed by an init of `npm ci`:
`apps/docs/src/content/docs/testing/end-to-end/overview.md`, sections
"Workspace", "Init", "Seeding vendors the library into the run repository" and
"Engines", `apps/docs/src/content/docs/testing/end-to-end/manifests.md`, and
`apps/docs/src/content/docs/components/driver/execution.md`, section "Init".

On prod, two pong runs since 2026-10-17 (gemini-4-argon and muse-wonder) saw
the untracked lockfile in `git status`, deleted it before committing, and
ended `infrastructure` when validation's `npm ci` refused to run without one.

## What is missing

- Seeding vendoring the selected engine's runtime at the `file:` path the
  engine's workspace already declares, in place of writing the dependency into
  the seeded `package.json`.
- Resolution rejecting a workspace whose `package-lock.json` disagrees with
  its `package.json`, or whose vendored copies are versions other than the
  ones the lockfile links, before a run is spent.
- Each authored code-producing case, in a new version where the current one
  is frozen, shipping one workspace per engine with its `package.json` and
  `package-lock.json`, and declaring `npm ci` as its init.
- Tests for the seed and for the resolution check.

## Verify

`tcab seed` of pong on each of its engines leaves a repository whose seed
commit holds `package-lock.json`, in which `git status` is clean and
`npm ci` installs the vendored engine without touching the lockfile. A run on
a local deployment reaches validation with the lockfile still committed. The
driver's and the suites crate's gates pass, and `frozen-paths` passes in
`test-suites`.
