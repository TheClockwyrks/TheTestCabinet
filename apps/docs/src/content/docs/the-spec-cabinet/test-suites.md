---
title: "Test Suites"
---

In The Spec Cabinet, a test suite is the project a user opens. A suite is
declared by its suite manifest and holds two kinds of state: drafts, which the
user authors, and exported versions, which are produced from drafts. Every entity
other than the suite manifest belongs to exactly one draft or one exported
version.

The format of a suite's files is described by
[Test Suites](/test-suites/overview/). This page covers how The Spec Cabinet
organizes that content, edits it, and exports it.

## Layout

Test suites live in their own repository, checked out as the superrepo's
`test-suites/` submodule beside the `the-spec-cabinet/` checkout. That checkout
is the only place The Spec Cabinet reads suites from and writes them to. Each
suite is a folder named by its slug:

```text
carom/
  suite.toml
  drafts/
    main/
      draft.toml
      version.toml
      specifications/
      ...
    physics-rework/
      draft.toml
      ...
  versions/
    v1.0.0/
      version.toml
      specifications/
      ...
.previews/
```

The checkout holds suite data alone. `.previews/` is the one exception: it holds
the preview versions described below, which are suite trees the local stack
ingests. Everything else The Spec Cabinet records sits under the state root named
by `TCAB_SPEC_CABINET_STATE`, as described in
[Architecture](/the-spec-cabinet/architecture/#backend).

`suite.toml` is the [suite manifest](/test-suites/suite-manifest/), declaring
the suite's slug and display name. A draft folder and an exported version folder
hold the same suite tree. A draft folder also holds `draft.toml`, which is left
out when the draft is exported.

The Spec Cabinet scans the checkout on startup and whenever it changes on disk,
so a suite, draft, or exported version added by any means appears in the UI.

## Creating a suite

Creating a suite takes a slug and a display name. It writes the suite manifest
and creates the suite's first draft, named `main`. Every other entity is
authored into that draft from there. Creating a suite refuses a slug the
checkout already holds.

A suite is created through the New Suite wizard described in
[User Interface](/the-spec-cabinet/user-interface/#new-suite-wizard). The `main`
draft is empty unless the wizard's About step supplies content for it. About
writes the summary and tags into `version.toml` and the description prose into
`description.md`.

The suite manifest, the `main` draft, and everything About supplies are written
in one commit.

A suite's display name is edited through its suite manifest, and the change
applies wherever the suite and its exported versions are presented. A suite's
slug is fixed at creation.

## Drafts

A draft is a named, editable state of a suite. Its name is a kebab-case slug
matching its folder, unique within the suite. Drafts are independent of each
other, so an edit to one draft leaves every other draft and every exported
version as it was.

### draft.toml

```toml
# <slug>/drafts/<draft>/draft.toml
base = "1.0.0"  # the exported version this draft follows (optional)
```

- `base` names the exported version the draft's changes are measured against.
  It decides which version numbers the draft may export as and which version
  the draft is compared with. A draft that declares no base is base-less.

### Incomplete drafts

A draft may be incomplete in any way. Any key the test suite format requires may
be absent, any reference may name an entity that has not been authored, and any
folder may be empty. The Spec Cabinet reports each place a draft falls short of
the test suite invariants as a problem attributed to the entity that caused it.
A requirement with no validators is reported on its specification, and an asset
id with no matching asset is reported on the test case definition naming it.

Problems never block a save. A save is refused only when the change cannot be
represented in a draft at all, as described in
[Architecture](/the-spec-cabinet/architecture/#validation). A draft's problems
are exactly what stands between that draft and an export.

A file that fails to parse is itself a problem. The Spec Cabinet loads the rest
of the draft and presents the unparseable file with its parse error.

### Creating a draft

A draft is created from one of three starting points:

- Nothing. The draft holds only its `draft.toml` and is base-less.
- An exported version. The draft is a copy of the version folder, and its base
  is that version.
- Another draft. The draft is a copy of the source draft, including its base.

The source of a copy is left untouched. Creating a draft refuses a name the
suite already uses.

### Rebasing

Rebasing a draft sets its base to a different exported version and changes
nothing else in the draft. A draft is rebased when a newer version has been
exported since the draft was created, so that it is compared with and numbered
after the version it follows.

### Discarding

Discarding a draft removes its folder, and the draft stays recoverable from the
test suites repository's history. The suite itself remains, so a suite may hold
no drafts at all.

## Exported versions

An exported version is the immutable result of exporting a draft, stored at
`<slug>/versions/v<major>.<minor>.<patch>/`. The Spec Cabinet refuses every
write to an exported version. An exported version is changed by creating a draft
from it and exporting that draft as a new version.

Exported versions are the only suite states The Test Cabinet ingests, and every
exported version satisfies every invariant stated in
[Test Suites](/test-suites/overview/).

### Exporting a draft

Exporting a draft takes the version number to export as and proceeds in the
following order:

1. Validate the draft, refusing the export while any problem remains.
2. Commit the draft's uncommitted changes.
3. Copy the draft folder to the new version folder, leaving out `draft.toml`.
4. Write `version` into the copied `version.toml`.
5. Commit the new version and tag the commit `<slug>-v<major>.<minor>.<patch>`.
6. Rebase the draft onto the version it produced.

The draft remains after export, so authoring continues in the same draft toward
the next version. A draft that has served its purpose is discarded.

### Version numbers

The user chooses a version number by how it relates to the draft's base rather
than by typing one:

- Origin, either `0.1.0` or `1.0.0`. It is available only to a base-less draft of
  a suite with no exported versions.
- Increment major, minor, or patch. Base `1.4.2` exports as `2.0.0`, `1.5.0`, or
  `1.4.3` respectively.

The resulting number must be free within the suite. A base-less draft of a suite
that already has exported versions is rebased before it is exported.

### Comparing with the base

The Spec Cabinet compares a draft with its base entity by entity, reporting each
entity as added, removed, modified, or unchanged. The comparison is what the
draft's `changelog.md` is written from before an export. A base-less draft has
nothing to compare with.

## Previews

A preview makes a draft runnable in the local development stack's Test Cabinet
before the draft is complete. The Spec Cabinet uses previews to run a draft's
full stack test case and import the assets it produces, as described in
[Assets](/the-spec-cabinet/assets/).

A test case definition is complete when neither it nor any entity it references
carries a problem. A preview holds a draft's complete test case definitions and
every entity they reference, and a draft with no complete definition cannot be
previewed.

Previewing a draft copies the suite manifest to `.previews/<slug>/suite.toml`
and writes the preview to `.previews/<slug>/v0.0.0-preview.<draft>/` in the
checkout. It writes that version and `experimental = true` into the preview's
`version.toml`, then asks the local development stack's backend to ingest the
preview with `force`. Previewing the same draft again replaces the previous
preview.

The test suites repository ignores `.previews/`, so previews are never committed
and never reach a deployment. A backend reads previews only when configured to,
as described in [Backend](/components/backend/overview/#test-case-definitions).

## Committing

Creating a suite and creating, rebasing, discarding, or exporting a draft each
commit in the test suites repository when they complete. Edits to a suite
manifest or to a draft's entities land on disk as they are made and are committed
once no open editor holds them, as described in
[Collaboration](/the-spec-cabinet/collaboration/#committing).

Every commit updates the superproject's submodule pointer to the new commit, so
the superproject names the suite state that commit produced.
