---
title: "Architecture"
---

The Spec Cabinet is two pieces: a Rust backend that owns the test suites
checkout on disk, and a React frontend that talks to it over HTTP. The split
exists so that a single component is responsible for every byte written into the
suite tree, and so that the authoring UI can be rebuilt or replaced without
changing the format contract.

## Backend

The backend is the crate `test-cabinet-spec-cabinet` at the-spec-cabinet's
`crates/spec-cabinet/`, producing the binary `tcab-spec-cabinet`. It reads,
validates, and writes test suites, exports their versions, and serves a JSON
HTTP API describing them.

Configuration is environment-driven:

- `TCAB_SPEC_CABINET_BIND` is the listen address, defaulting to
  `127.0.0.1:8792`.
- `TCAB_SPEC_CABINET_ROOT` points at the test suites submodule checkout and is
  the only suite tree the backend reads or writes. It defaults to
  `../test-suites`, the superrepo's submodule beside the `the-spec-cabinet`
  checkout.
- `TCAB_SPEC_CABINET_STATE` points at the state root, holding the assistant's
  conversations, workflow runs, runs imported from the local stack, and the
  working directories reference implementations are built in. It defaults to
  `./.scab` and is created at startup, and a relative value is resolved against
  the working directory there, since the toolchains that compile an agent's
  programs run from folders inside it. It is a sibling of the checkout rather
  than a folder inside it, so the checkout holds suite data alone.
- `TCAB_SPEC_CABINET_AGENTS` is the directory holding the `workflows/` and
  `chat/` agent configurations. It defaults to `crates/spec-cabinet/` in the
  the-spec-cabinet source tree the binary was built from, and must be set when
  that directory does not exist.
- `TCAB_SPEC_CABINET_BACKEND_URL` is the URL of the local development stack's
  Test Cabinet backend. Previews are ingested into it, suites are published to
  it, and runs are imported from it. It defaults to `http://127.0.0.1:8787`,
  where `make -C deployments/local local-forward` holds the k3d cluster's
  backend.
- `TCAB_SPEC_CABINET_ARTIFACTS_URL` overrides the artifact service URL the local
  stack's backend reports, for a backend that advertises an in-cluster address.
- `TCAB_SPEC_CABINET_CONSOLE_URL` is the web console a previewed test case
  definition is launched from, defaulting to `http://127.0.0.1:1430`.
- `TCAB_ACCESS_TOKEN`, `TCAB_ACCESS_CLIENT_ID`, and `TCAB_ACCESS_CLIENT_SECRET`
  are the Access credentials the staging and production environments are read
  and published through, the same variables `tcab` reads. A user token reads
  what an environment holds, and publishing takes the service token.
- `OPENROUTER_API_KEY` is the key workflows and the assistant call models with,
  and both are unavailable while it is unset. It is resolved at the moment it is
  needed, on each status read, each workflow run start, and each assistant
  message, re-reading `.env.spec-cabinet` each time, so adding it to that file
  and re-checking the status makes workflows and the assistant available while
  the application runs. A value exported in the shell takes precedence over the
  file. Every other variable is read once at startup.
- `TCAB_SPEC_CABINET_SETTINGS` names the settings file holding the models
  workflows and the assistant run on. It defaults to `tcab-spec-cabinet/settings.toml` beneath
  `$XDG_CONFIG_HOME`, or beneath `~/.config` when that is unset.

Outside the checkout and the state root, the backend writes only the settings file
and the `.local.toml` agent configuration files described in
[Harness](/the-spec-cabinet/harness/#agent-configuration). Both hold the current
user's choices and are never committed. A missing settings file means the default
models, and a missing local configuration means the committed one.

The default bind address is loopback because The Spec Cabinet runs on a
development machine and edits a working copy of the test suites repository.

Inside the checkout the backend writes suite folders and the previews described in
[Test Suites](/the-spec-cabinet/test-suites/#previews), and nothing else. The
backend is the only writer of the submodule's working tree. Every change is
written to disk as it is applied and committed in the submodule as described in
[Collaboration](/the-spec-cabinet/collaboration/#committing). When a superproject
tracks the checkout, as the superrepo tracks `test-suites`, each commit also
updates the superproject's submodule pointer to the new commit, so the
superproject names every committed suite state.

In a non-development build the backend also serves the built frontend assets
from the directory `TCAB_SPEC_CABINET_UI` names, so the whole application is the
one binary, its built UI, and the checkout it is rooted at.

## Frontend

The frontend is `@clockwyrks/spec-cabinet` at the-spec-cabinet's
`apps/spec-cabinet/`, a React application. During development it runs under
the Vite dev server on port 1432 and proxies API calls to the backend.

The frontend reaches the filesystem only through the backend's API. Every view
it renders is built from an API response, and every change it makes is an API
request.

## The write model

Every write is a whole-file rewrite of canonically formatted TOML. The backend
loads a file into its typed model, applies the write's
[actions](/the-spec-cabinet/collaboration/#actions) to that model, and serializes
the entire model back over the file.

Two properties follow:

- The on-disk result of an edit depends only on the resulting model, never on
  how the edit was made. The same suite state produces the same bytes whether it
  was reached through one edit or twenty.
- A suite hand-edited in a text editor round-trips unchanged. Loading and saving
  a canonically formatted file with no modifications rewrites it byte for byte,
  so opening a suite in the UI never produces a diff on its own.

Canonical formatting covers key order, table order, indentation, string quoting,
and array layout. Because it is fixed, a suite's diff in git reflects the change
that was made and nothing else.

The typed model represents any partial state of a suite. Every key the test
suite format requires is optional in the model, and every reference is held as
the text the file declares whether or not it resolves. A draft is therefore
loaded, edited, and saved in any state it can reach.

## Validation

The backend validates a draft when it loads the draft and after every save, and
reports the result as problems attributed to the entities that caused them. Every
read and save response carries the draft's current problems. Validation applies
two sets of rules.

Save rules decide whether a change can be written at all. A save is refused, and
the files on disk are left as they were, when the change would:

- write to an exported version;
- declare an identifier that is not kebab-case, or one that duplicates another
  identifier in the same file;
- name a path that resolves outside the draft folder.

Export rules are exactly the invariants stated in
[Test Suites](/test-suites/overview/). They include requirement identity and
uniqueness, each validator module path being claimed by exactly one
requirement, each test case definition's workspace map covering every engine it
declares, and the presence of every referenced path. A change that breaks an
export rule is saved and reported as a problem. An export is refused while any
export rule is broken.

## API shape

The API is JSON over HTTP, rooted at `/api`. Suites are addressed by slug.
Within a suite, drafts are addressed by draft name and exported versions by
version.

Resources are:

- Suites, each with its suite manifest.
- Drafts, with operations to create, rebase, discard, compare with the base,
  preview, and export.
- Exported versions.
- The entities within a draft or an exported version:
  - The version manifest.
  - Specifications, and the requirements within them.
  - Validators.
  - Debug API nodes, meaning the modules and functions of the suite's debug API
    tree.
  - Test case definitions.
  - Demonstrations.
  - Assets.
  - Reference implementations.
  - The showcase.
- Agent configurations, described in
  [Harness](/the-spec-cabinet/harness/#runs).
- Conversations with the assistant, described in
  [Chat](/the-spec-cabinet/chat/#api).
- The change stream and editor holds, described in
  [Collaboration](/the-spec-cabinet/collaboration/#api).

Suite manifest writes are addressed by suite slug, and entity writes by suite
slug and draft name. Entity reads are
addressed by suite slug and either a draft name or a version. A request naming a
suite, draft, or version with no matching folder fails, since suites and drafts
come into existence only through their create operations and exported versions
only through export.

Reads return the validated model together with its problems and its revision, so
the frontend sees the suite exactly as the backend understands it rather than as
raw file contents. Writes carry the revision they were based on and are refused
with a conflict once the resource has moved past it.
