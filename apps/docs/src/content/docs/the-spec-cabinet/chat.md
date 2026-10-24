---
title: "Chat"
---

The chat sidebar lets a user direct The Spec Cabinet's assistant to make changes
to a suite while they work in the UI. The assistant is an agent run by The Spec
Cabinet's [harness](/the-spec-cabinet/harness/), on the model of the `assistant`
[slot](/the-spec-cabinet/harness/#models).

The user and the assistant edit the same suites at the same time through the
same backend. How their concurrent edits resolve, how the UI undoes and redoes
them, and when they are committed is covered in
[Collaboration](/the-spec-cabinet/collaboration/). The sidebar itself is
described in [User Interface](/the-spec-cabinet/user-interface/#chat-sidebar).

## The assistant

The assistant's configuration lives at `crates/spec-cabinet/chat/` in the
`the-spec-cabinet` repository:

- `agent.toml` declares the operations the assistant is granted, its ceilings,
  its execution mode, its context window override, and its compaction settings,
  as described in
  [Agent configuration](/the-spec-cabinet/harness/#agent-configuration);
- `agent.local.toml` holds the current user's changes to those fields and is
  ignored by git;
- `system.hbs` is the system prompt, following gg's `agent-prompts` skill,
  `.claude/skills/agent-prompts/SKILL.md` in the `gg` repository.

The configuration is read from disk when a message is sent. The run it starts
records the merged configuration and the model.

## Reach

The assistant can do everything the UI can do, across every suite in the
checkout, through the [agent surface](/the-spec-cabinet/harness/#the-agent-surface).
Its committed configuration grants every operation, which covers:

- creating suites and editing suite manifests;
- creating, rebasing, discarding, comparing, previewing, and exporting drafts;
- reading every entity of a draft or an exported version, and writing every
  entity of a draft;
- running the checks the editors run, such as typechecking validators and
  building demonstrations;
- starting, running, waiting on, and cancelling workflow runs;
- reading the skills its grants offer, the suite format and engine
  documentation;
- reading [the user's location](#the-users-location);
- the [granular reads and edits](/the-spec-cabinet/collaboration/#granular-reads-and-edits)
  for large text.

Under tool calling, the assistant is offered the curated
[tools](/the-spec-cabinet/harness/#tools). Under responses as code, it writes
programs over the [SDK](/the-spec-cabinet/harness/#sdk), whose functions follow
the API operations.

## The user's location

Every message carries a snapshot of where the user was when they sent it. The
assistant reads that snapshot with `session.read_location` when a request needs
it, such as one naming what the user is looking at rather than what it is
called. The snapshot is what the assistant knows about where the user is, and it
is what a `page.read_field` or `page.set_field` call may address. Every other
operation acts on the checkout wherever the user is looking.

The snapshot holds:

1. The page: its route, its section, and the suite, draft or version, and entity
   it shows.
2. The fields on the page: each field's label as the user reads it, the resource
   and field path it edits, and the operations that read and write it.
3. The page's operations: the operations behind page-level actions, such as
   creating, deleting, or reordering entities.
4. The selection: the focused field and any selected elements.

Each page declares the descriptor its snapshot is built from, because the page is
the one place that knows both the label a user reads and the field it edits. The
mapping resolves a request such as "make this shorter" to the focused field and
the operation that writes it.

`session.read_location` answers with the snapshot of the message the run is
answering, so the assistant reasons from where the user was at the moment they
spoke. The answer follows the [call output](/the-spec-cabinet/harness/#call-output)
policy like any other call's.

### The page's own fields

A field whose value the page holds, such as an entry of the New Suite wizard, belongs
to no saved resource. The snapshot marks such a field, and the assistant reads and
fills it with `page.read_field` and `page.set_field`, each addressing it by the
resource and path the snapshot publishes. A field backed by a saved resource is
written through the operation its descriptor names, and `page.set_field` refuses it
and names that operation.

The value stays in the browser, so a call reaches the page as a `pageCall` event on
the conversation's stream and the page answers it through the conversation's answer
route, which the backend records as a `pageResult`. The call blocks until the page
answers, the run is cancelled, the run reaches its runtime ceiling, or ten seconds
pass with nothing answering, which is what a closed tab looks like and leaves the
assistant to act on the checkout instead. The page refuses a pair no field of it
carries and a field the user has focused, whose text filling it would take out from
under them.

A field the assistant filled is marked as the assistant's until the user edits it,
with a Restore action beside the mark that puts back what the field held.

## Runs

Sending a message starts a run, which drives the
[harness turn loop](/the-spec-cabinet/harness/#the-turn-loop) over the whole
conversation. The run ends when the assistant calls `stop(message)`, and the
message is shown to the user as the assistant's reply. `stop` requires a
non-empty message. A turn that calls no tool is an error turn answered with a
message naming `stop`, and text accompanying a tool call or program is shown to
the user as a progress note.

The prompt holds the system prompt followed by the conversation: each user
message under its [heading](/the-spec-cabinet/harness/#messages), each tool call
or program with its results, and each `stop` message. After a compaction, every
later run's prompt starts from the restarted context the compaction recorded,
with its named resources read again at the start of the run, followed by the
conversation since the compaction.

Reaching a ceiling ends the run with an error naming the ceiling. A run that ends
as `context_exceeded` or `compaction_failed` leaves the conversation accepting no
further messages, so the user continues in a new conversation.

One run at a time belongs to a conversation, while separate conversations run
concurrently. During a run, the composer keeps accepting text and its Send
action becomes Stop. Stop cancels the run at the next call boundary, which
stops a running program at its next call, and every
edit the run made stays in place, since each landed when its call ran.

## Conversations

Each conversation is recorded at `<state>/chats/<chat-id>/`, under the state root
described in [Architecture](/the-spec-cabinet/architecture/#backend):

- `chat.json`: the title, the creation time, the model and merged configuration
  of each run, and the conversation's usage and cost;
- `events.ndjson`: every event, from which the transcript is rebuilt;
- `journal.ndjson`: each model request and response, each program's source and
  outcome, and each call's full result.

The title is the first line of the conversation's first message. Conversations sit
under the state root rather than in the suites checkout, which holds suite data
alone. A run found in flight at startup is marked `interrupted`.

## Events

Everything a run does is an event, appended to `events.ndjson` and streamed to
the sidebar over SSE.

| Event              | Carries                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userMessage`      | The message text and its location snapshot                                                                                                            |
| `phase`            | `promptBuilt`, `modelCall`, `receiving`, `executing`, or `compacting`, with the live output token count                                               |
| `program`          | A submitted program's source and whether it compiled, ran, or failed, with the error                                                                  |
| `toolCall`         | The operation, its arguments, and the resources it targets, whether a tool or a program made the call                                                 |
| `toolResult`       | The outcome (`ok`, `refused`, `conflict`, or `failed`), its message, and each change it made                                                          |
| `compaction`       | The summary, the resources re-read, and the tokens before and after                                                                                   |
| `assistantMessage` | The text, marked as a progress note or as the `stop` message                                                                                          |
| `pageCall`         | A call on the page: its id, the operation, the field's resource and path, and the value for a write                                                   |
| `pageResult`       | What the call came to (`applied`, `refused`, or `unanswered`), its reason, and the value for a read                                                   |
| `runComplete`      | Input tokens, the share served from the prompt cache, output tokens, cost, the context occupancy, and the window                                      |
| `error`            | Why the run ended (a ceiling, `context_exceeded`, `compaction_failed`, a cancellation, an interruption, a failed opening turn, or a provider failure) |

The sidebar renders a user's message from its `userMessage` event rather than
inserting it optimistically. `modelCall` ends at the first streamed delta of any
kind, reasoning included. The context occupancy is the input size of the run's
last model call, and the window is the one the assistant works against after any
override and compaction headroom. An `error` carries the run's usage too.

A client that reconnects reads the conversation's events and resumes the stream
after the last one it holds.

## API

| Route                                    | Operation                                        |
| ---------------------------------------- | ------------------------------------------------ |
| `GET /api/chats`                         | List conversations, newest first                 |
| `POST /api/chats`                        | Start a conversation                             |
| `GET /api/chats/{id}`                    | Read a conversation and its events               |
| `DELETE /api/chats/{id}`                 | Delete a conversation                            |
| `POST /api/chats/{id}/messages`          | Send a message with its location and start a run |
| `GET /api/chats/{id}/events`             | Stream events over SSE                           |
| `POST /api/chats/{id}/cancel`            | Stop the running run at the next call boundary   |
| `POST /api/chats/{id}/page-calls/{call}` | Answer a call the assistant made on the page     |

Sending a message is refused while the conversation has a run in flight, while
`OPENROUTER_API_KEY` is unset, while the settings file or the assistant's
configuration cannot be used, and after the conversation ended as
`context_exceeded` or `compaction_failed`. A run whose
[context window](/the-spec-cabinet/harness/#context-window) cannot be determined
is refused as well.
