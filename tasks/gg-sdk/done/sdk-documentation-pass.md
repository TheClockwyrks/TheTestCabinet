# Bring SDK Documentation Onto Its Policies

Every gg SDK's function and type documentation follows
`.claude/skills/gg-sdk-documentation/SKILL.md`. Audit each arm and rewrite the
documentation that does not.

The documentation is reflected out of each SDK's own source comments at build
time, so the edits land in `packages/gg-sandbox-*/`.

## A worked offender

`views.openFile` violates several policies at once:

```
Read a file and show it to the agent, handing the program the same value `gg.files.readFile` does.

The split from `gg.files.readFile` is the point: that call gets bytes for the program, this one puts the file in front of the agent, so a program that reads forty files to grep them adds nothing to the window. Two pages of one file are two views that coexist, while re-opening the same page replaces what it showed rather than piling up a duplicate.

An image file is shown as a picture, and this is the only way to look at one: `gg.files.readFile` of an image describes it without showing it.

The view's text is held to the same 65,536-byte cap a text view's body is: a window that would carry more is refused, naming the size and the bound, and nothing is opened. Nothing is ever silently truncated, so the way through is to narrow the window with `offset` and `limit`, or to cut its long lines with `maxLineChars`, in the same turn. A picture is not a text body and is bounded by gg's image cap alone.
```

It refers to the agent, references `gg.files.readFile` four times, argues how the
function should be used, and writes narrative prose.

The `readFile` references are the clearest case for the Minimize References
policy. `readFile` is deliberately absent from the auto-opened documentation
views, so a model reading `openFile` is pointed at a page it has not been given.

## Design

Read the policies, then audit every arm. An arm's documentation is generated from
its own source, so the same function may violate different policies in different
languages.

Record the audit as a list of functions and types with the policies each breaks,
then rewrite.

## Done when

- [x] Every arm's function and type documentation is audited against the policies.
- [x] Documentation that breaks a policy is rewritten.
- [x] `views.openFile` reads as a statement of what the function does.
- [x] Gates green.
