---
title: "Collaboration"
---

The user and the [assistant](/the-spec-cabinet/chat/) edit the same suites at the
same time through the same backend. This page defines how their concurrent edits
resolve, how the UI undoes and redoes edits from either of them, and when edits
are committed.

## Server-authoritative state

The backend holds the authoritative state of every suite, and the frontend
renders a projection of it. The user edits through the frontend's API requests
and the assistant through its agent surface, which runs the same operations, so both are
clients of one copy.

The backend decides the order writes apply in and broadcasts each applied change
on the change stream, `GET /api/changes`, over SSE. Every open page follows the
stream, so a change made by the user in another tab, by the assistant, by a
workflow run, or outside The Spec Cabinet appears without a reload.

## Resources and revisions

A resource is one file the backend reads and writes: a suite manifest, an
entity's file in a draft, or a source file such as a validator module. Every
resource carries a revision, and every read returns it.

The revision is a logical clock reconciled against a hash of the file on disk. A
file first seen is revision 0. A read whose content hashes the same keeps its
revision, while a read or a disk scan that finds changed content advances the
revision and broadcasts the change. An edit made through `git` or a text editor
is therefore detected like any other.

Deleting or moving a resource retires the revisions of the paths it vacated. A
file later created at a retired path starts again at revision 0.

## Actions

Every write, from any origin, is a list of actions applied to a resource. Each
action has an inverse, and each records the prior state that inverse needs.

| Action                                                   | Inverse                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Set a field                                              | Set it back to its prior value                             |
| Insert an element, such as a requirement or an asset id  | Remove it                                                  |
| Remove an element                                        | Re-insert it at its prior position with its full state     |
| Move elements                                            | Restore their prior positions                              |
| Splice text                                              | Splice the prior text back over the inserted text          |
| Create an entity                                         | Delete it                                                  |
| Delete an entity                                         | Recreate it with its full prior content                    |
| Rename an entity                                         | Rename it back                                             |
| Replace a resource's content, for a change found on disk | Restore the prior content                                  |

A write that replaces a whole entity, such as replacing a specification, is
recorded as the actions that take the prior model to
the new one. Every change is therefore invertible at the granularity of what it
touched.

A broadcast change carries the resource, its new revision, its actions with
their prior state, and its origin. The origin is one of the user's clients with
the client sequence number of the write, a chat run, a workflow run, or the disk.

## Compare-and-swap

Every write carries the revision its caller last read for the resource. The
backend applies the write while the resource is still at that revision, and
otherwise refuses it with a conflict naming the current revision. The rule is the
same for the user and the assistant.

A write that breaks a [save rule](/the-spec-cabinet/architecture/#validation),
such as a write to an exported version, is refused as a rejection rather than a
conflict, so neither party retries it.

### The user's client

The frontend applies the user's edits immediately and reconciles with the backend
afterwards. It keeps three sets of state per resource:

- Server state is what the client believes the backend holds. It changes only
  when a broadcast arrives.
- Client state is what the UI renders. It changes the instant the user acts.
- The pending buffer is the ordered list of actions applied to client state and
  awaiting confirmation, each tagged with a client sequence number.

Each edit is applied to client state, pushed onto the pending buffer, and sent as
a write. Typing is debounced, so a burst of keystrokes is sent as one write.

When a broadcast arrives for the resource, the client:

1. Applies the change to server state.
2. Pops the head of the pending buffer and stops when the change's client
   sequence number matches it.
3. Otherwise rebuilds client state by replaying the pending buffer on top of the
   new server state.
4. Discards a pending action that fails to replay, along with every action after
   it, and shows a notice that the edit could not be applied because the
   resource changed.

Values in client state awaiting confirmation render in a muted tone until their
broadcast arrives.

### Recovering discarded text

Before step 4 rebuilds client state, the client captures the text the user typed
in the discarded actions, including text the debounce has not yet sent. The
notice offers that text back to copy or re-apply, so a lost race never loses what
the user wrote.

The client flushes debounced edits as soon as a broadcast for the resource
arrives from another origin, which keeps the unsent part of a conflict small.

### The assistant

The backend tracks revisions for the assistant on the conversation, so the
model never handles a revision and a later run of the conversation keeps what
earlier runs read:

- A read records the revision it returned for the resource.
- A write carries only its new content, and the backend supplies the recorded
  revision.
- A write to a resource the conversation has not read is refused as a
  read-before-write.
- A write that lands records the new revision.

A conflict is returned as the call's result. The assistant then re-reads the
resource, which now includes the other change, recomputes its edit, and retries.

## Granular reads and edits

Specification prose and source files grow large, so the assistant reads and
edits them in parts. A text target is an entity's text field or a whole source
file.

- `text.read_window(target, offset, limit)` returns a window of the target
  along with its total line count, under the agent's
  [read mode](/the-spec-cabinet/harness/#reads). A window records the revision
  exactly as a whole read does.
- `text.splice(target, find, replace)` replaces the one occurrence of `find`. A
  `find` matching no occurrence or several occurrences is refused as a conflict.
- The entity writes replace whole values, for small fields and
  deliberate rewrites.

Anchoring a splice to matched text adds a region-local guard on top of the
revision, since a concurrent edit elsewhere in the text shifts offsets silently.

## Undo and redo

Undo and redo are held by the frontend, following two rules:

1. Undo applies the inverse of recorded actions rather than restoring a
   snapshot.
2. A history belongs to one open editor and the resources it edits, and lives as
   long as the editor is open.

### A history shared with the assistant

While an editor is open, every broadcast change to its resources is appended to
its history in the order the backend applied it, whatever its origin. A single
Undo takes back whichever change landed last, whether the user or the assistant
made it. The history reaches exactly as far as the editor's own resources.

Opening an editor starts an empty history. Closing the editor, by navigating
away, opening another entity, or closing the tab, discards its history, and a
reload starts afresh. Editors of an exported version are read-only and keep no
history.

### Steps

Undo and redo move one step at a time, and a step groups actions:

- A user gesture is one step, even when it is many actions. A typing burst ends
  at the debounce or when the field loses focus, and a drag or an operation on a
  selection covers everything it changed. The client opens the step when the
  gesture begins and closes it when the gesture ends.
- Consecutive changes from one chat run are one step until a change from another
  origin lands between them.
- A workflow run's applied changes are one step, and each change found on disk
  is one step.

### Applying a step

Undo pops the latest step, sends the inverse of its actions as an ordinary write,
and moves the step onto the redo stack. Redo pops the redo stack, sends the
step's original actions again, and moves the step back. A new step from any
origin clears the redo stack.

The write is ordinary in every respect. It applies optimistically, carries its
base revision, broadcasts to every other client, and reaches the assistant on its
next read. An undo or redo whose write is discarded by reconciliation removes the
step from the history along with the notice described above.

## Committing

Edits land on disk as they are applied and are committed once no open editor
holds them. Undo and redo therefore change only uncommitted state and produce no
commits of their own.

An open editor holds its resources. The frontend registers a hold when an editor
opens, with `POST /api/holds` naming its change stream connection, and releases
it with `DELETE /api/holds/{id}` when the editor closes. Closing a change stream
connection releases every hold registered against it.

The backend commits a resource's uncommitted changes:

- when the last hold on it is released;
- when the run that wrote it ends, for a resource no editor holds;
- at startup, for every uncommitted change in the checkout.

Changes committed at the same moment share a commit, with the subject
`feat(<slug>/<draft>): edit <entities>` naming each entity it touched. A resource
whose content has returned to its committed content has nothing to commit, so an
edit undone before its editor closes leaves no trace in the history of the test
suites repository. Every commit updates the superproject's submodule pointer.

Rebasing, discarding, and exporting a draft commit its uncommitted changes first,
so each acts on a committed state and a discarded draft stays recoverable in
full. Holds survive those operations, and an undo reaching past one of them is a
new uncommitted change.

## API

| Route                    | Operation                                                         |
| ------------------------ | ----------------------------------------------------------------- |
| `GET /api/changes`       | Stream every applied change over SSE, identifying the connection  |
| `POST /api/holds`        | Hold resources for an open editor on a change stream connection   |
| `DELETE /api/holds/{id}` | Release a hold                                                    |

Every entity write carries its base revision, its client sequence number, and
its actions. A conflict answers `409` with the resource's current revision.
