---
description: Required reading when updating this workspace against the template it was rendered from, whether through a template update tool or by hand with copier update, and when resolving the conflicts or taking the steps a template update left. Holds one migration guide per template version.
name: template-migration
---

# Moving this workspace to a newer template version

## Overview

This repository is rendered from a copier template, and `.copier-answers.yml`
records the template's source as `_src_path` and the version it was last
rendered or updated against as `_commit`. An update to a later version is a
three-way merge: copier renders the recorded version and the target with the
recorded answers and applies to the working tree what changed between the two.
What the project changed and the template did not stays as the project wrote
it, and a line both changed is left inline as a conflict.

A merge cannot do everything a version needs. Some versions ask a question
the workspace never answered, drop one it did, or need a step only the
workspace can take, such as writing a pin, copying a file every machine keeps
for itself or rebuilding the devcontainer. Each version therefore carries a
guide of its own, `versions/<tag>.md` beside this file, named by its tag, and
each guide states, in this order:

1. What the update brings into a workspace.
2. The questions the version adds or stops asking, and what an existing answer
   becomes.
3. Each step the workspace takes by hand once the merge lands, or a line saying
   there is none.

## Moving to a version

1. Read `_commit` in `.copier-answers.yml` for the version the workspace moves
   from. Once an update has been applied to the working tree, the file there
   already records the target, so read the committed one instead:
   `git show HEAD:.copier-answers.yml`. A tool that applies the update for the
   session names both versions in its result.
2. Read the guide of every version after that one, up to and including the
   target, in version order, under `versions/`. A tool that applies the update
   names those guide files in its result; read them by those paths, since this
   skill may have arrived with the update itself. A guide names any step to
   take before the merge where one exists; take it first when updating by hand.
3. Resolve the conflicts the update left inline in the checkout's working tree,
   then commit the result. A conflict is a region between
   `<<<<<<< before updating`, the project's version, and
   `>>>>>>> after updating`, the template's, split by `=======`; a hunk the
   merge could not place is left in a `.rej` file beside the file it belongs
   to. Keep what the project changed on purpose, take what the template
   changed, and combine the two where both matter. `git grep -n '^<<<<<<<'`
   and `git status --short` find what is left. Every `.rej` file is folded
   into its file by hand and then deleted.
4. Take each step the guides list by hand, oldest version first, and commit
   what each one changes. A step that has to happen on every machine the
   workspace is worked on, such as copying a file that is not committed or
   rebuilding the devcontainer, is stated to the person working there rather
   than done once.

The update by hand, run in a checkout whose every change is committed, is:

```sh
copier update --trust --conflict inline
```

`--vcs-ref <tag>` names a version other than the newest, and `--defaults` keeps
every recorded answer rather than asking again.

## This project's edits of rendered files

Some files the template renders carry project edits that an update will meet
as a conflict, or merge silently into a shape the project no longer holds.
Each is listed here with what to keep, so a conflict in it is resolved by
keeping the project's side of these regions and taking the template's
everywhere else.

- `.dockerignore`: the template renders a short allowlist; the project's is a
  much longer one, with a comment per re-inclusion, and the template's lines
  are a subset of it. Keep the project's file and fold in any new template
  line. Its `SUBMODULES` paragraph, above `*`, says how a path in a submodule
  enters the build context and that the image jobs initialize it with
  `scripts/ci/submodules.sh init --build-context`; keep it, and keep any
  re-inclusion of a submodule path below it. `scripts/ci/build-context.sh`
  reads the file for that set (`--submodules`), so a re-inclusion lost in a
  merge drops the submodule from the image jobs' init as well as from the
  context.
