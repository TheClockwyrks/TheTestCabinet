---
format: nyxsis-issue
version: 2
id: lk0nqbngol05n14gw1yeo972
zone: REPOS
number: 2
title: Split the Spec Cabinet into its own repository
type: generic
state: open
created: 2026-10-13T21:11:39.153491809Z
---

The Spec Cabinet lives on `feat/the-spec-cabinet` in the superrepo. The
documentation places it in the `the-spec-cabinet` repository, an application
depending on `contracts` and on nothing else of the project:
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories" and "The edges".

## What is missing

- The `the-spec-cabinet` repository on Azure, populated from the branch's
  Spec Cabinet paths with their history, rendered by the repository kit as
  the "The kit" section states, and building on its own against the suites
  crate of `contracts`.
- The test-suite support in shared code that the branch also carries, landed
  on the superrepo's `nightly` and none of the Spec Cabinet paths with it.
- `feat/the-spec-cabinet` deleted once both hold its content.

## Verify

`make gate` passes in the new repository and in the superrepo, the
`dependency-graph` gate accepts the new edge, and the superrepo's `nightly`
holds no `spec-cabinet` crate, app or package.
