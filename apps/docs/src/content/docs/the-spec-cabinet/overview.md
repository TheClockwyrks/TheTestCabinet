---
title: "Overview"
---

The Spec Cabinet is a companion app designed to run exclusively on development
machines. Its purpose is to author and maintain test suites, and to export the
versions of them that The Test Cabinet consumes.

The Spec Cabinet is a specialized IDE for test suites. A test suite is the
project a user opens and works in. Each of The Spec Cabinet's editors targets one
entity of a suite and presents the operations that entity supports.

The Spec Cabinet also implements authoring workflows as agentic workflows. Each
workflow runs an agent configuration committed to The Spec Cabinet's source tree,
which the current user may override locally. Its model comes from the
development machine's settings. See [Harness](/the-spec-cabinet/harness/).

A chat sidebar on every page lets the user direct The Spec Cabinet's assistant to
make changes while they work in the UI. The assistant runs on the same harness,
and it edits alongside the user with undo and redo shared between them. See
[Chat](/the-spec-cabinet/chat/) and
[Collaboration](/the-spec-cabinet/collaboration/).

## Drafts and exported versions

Authoring a test suite is iterative. A suite is built up over many sessions, and
most of the states it passes through are incomplete, such as a specification
with no requirements yet or a test case definition naming a starter workspace
that has not been written. The Spec Cabinet therefore separates the states a
suite is authored in from the states The Test Cabinet runs.

- A draft is an editable state of a suite. A suite holds any number of drafts,
  and a draft is saved as it is edited whether or not it is complete.
- An exported version is an immutable, numbered snapshot of a draft that
  satisfies every test suite invariant. Exported versions are the only suite
  states The Test Cabinet ingests.

Taking a suite from nothing to a complete suite is a sequence of saves to a
draft, and each save may leave the draft incomplete. Exporting is a separate,
deliberate act that succeeds only once the draft is complete. See
[Test Suites](/the-spec-cabinet/test-suites/) for the full lifecycle of drafts
and exported versions.

## Components

The Spec Cabinet is one application built from two pieces, both held in the
`the-spec-cabinet` repository, which is checked out as a submodule at
`the-spec-cabinet/`.

- The Rust backend is the crate `test-cabinet-spec-cabinet` at
  `crates/spec-cabinet/`, which builds the binary `tcab-spec-cabinet`. It owns
  reading, validating, and writing the test suites submodule checkout, and it
  is the only writer of that tree. It exposes that ownership as a JSON HTTP API
  and serves the frontend's built assets.
- The React frontend is `@clockwyrks/spec-cabinet` at `apps/spec-cabinet/`. It
  owns the authoring experience, meaning the task-specific editors and the
  controls that start the agentic workflows, and it reaches the filesystem only
  through the backend's API.

The repository depends on `contracts` for the suite format, its runtime, and the
backend client, on `engines` for the built-in engine catalog and the engine
documentation the harness serves, and on `ui-common` for `@clockwyrks/ui`. See
[Repositories](/development/repositories/).

How the two are wired together, how the API is shaped, and how a write reaches
disk are covered in [Architecture](/the-spec-cabinet/architecture/). How the UI
is organized is covered in [User Interface](/the-spec-cabinet/user-interface/).

## Scope

The Spec Cabinet edits every entity a test suite is made of:

- The suite manifest, declaring the suite's identity.
- The version manifest and the prose describing a version.
- Specifications and the RFC 2119 requirements they carry.
- The suite's debug API.
- Validators, and the requirement each one is claimed by.
- Test case definitions.
- Demonstrations.
- Assets and their specifications.
- Reference implementations.
- The suite showcase.

The suite manifest is edited on the suite itself. Every other entity is edited
within a draft, and an exported version is presented through the same editors in
read-only form.

The on-disk format of each of these is authoritative documentation in its own
right. See [Test Suites](/test-suites/overview/) for the layout and the schema
The Spec Cabinet reads and writes.
