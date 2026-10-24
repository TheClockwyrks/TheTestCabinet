---
title: Launch The Spec Cabinet
---

## Overview

Start [The Spec Cabinet](/the-spec-cabinet/overview/) from a fresh checkout of
the superrepo and create a test suite in it. The Spec Cabinet runs from the
`the-spec-cabinet` checkout beside the local service stack, which previews,
publishing, and run import need. Creating a suite needs only the test suites
submodule.

The launch and its configuration are covered in full in
[Running](/development/running/#the-spec-cabinet-against-the-local-stack).

## Prerequisites

- The devcontainer, which carries the Rust toolchain and Node.js and checks out
  the `the-spec-cabinet` and `test-suites` submodules.
- Read access to the test suites repository, which the `test-suites` submodule
  checks out.
- For previews, publishing, and run import, the local stack up and forwarded per
  [Run the Local Service Stack](/quickstarts/development/run-the-local-service-stack/).
- For workflows and the assistant, an `OPENROUTER_API_KEY`.

## Steps

From the superrepo's root, check out the two submodules:

```sh
git submodule update --init the-spec-cabinet test-suites
```

Then, from the `the-spec-cabinet/` checkout:

```sh
npm ci                                            # the repository's npm workspace
scripts/ci/install-sandbox-toolchains.sh          # once: the harness sandbox's toolchains
cp .env.spec-cabinet.example .env.spec-cabinet    # every variable the backend reads
npm run spec-cabinet                              # backend and frontend; Ctrl-C stops both
```

Set `OPENROUTER_API_KEY` in `.env.spec-cabinet` to run workflows and use the
assistant, either before launching or at any point afterwards. Open
<http://127.0.0.1:1432>, then:

1. Read the status strip along the bottom of the page. The checkout is tracked
   by the superproject, the local stack's backend is reachable once the stack is
   forwarded, and the provider key is set when you added it. Adding the key now
   and selecting Check again picks it up.
2. Select New Suite, enter the suite's display name, and keep or edit the slug
   derived from it.
3. Create the suite. The Spec Cabinet opens the suite's `main` draft.

## Check

The new suite is committed in the test suites submodule, and the superrepo's
submodule pointer names that commit. From the `the-spec-cabinet/` checkout:

```sh
git -C ../test-suites log -1 --oneline
git -C .. log -1 --oneline -- test-suites
```

## Next steps

- [User Interface](/the-spec-cabinet/user-interface/) covers the draft's editors.
- [Test Suites](/the-spec-cabinet/test-suites/) covers drafts and exported
  versions.
