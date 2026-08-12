---
title: "Context spend"
---

The [context graph](/gg/context-visibility/) says how many tokens each band held
at a point in time and the Cost widget says what the run spent. Neither answers
the question a configuration is tuned on: which material drove the bill. Which
file sat in the window for eighty turns, which tool returned output nobody read
again, whether the [autoloaded specifications](/gg/autoload-specifications/) are
worth what they cost. The Agents panel's context spend answers it.

## The arithmetic

gg's window is [append-only](/gg/context-visibility/): a turn re-sends everything
still in it. A message's cost is therefore its size multiplied by every turn it
survived, not what it cost to bring in once. A 900-token specification read on
turn 2 of a 90-turn run outspends a 5,000-token file read on the last turn by an
order of magnitude, and a read that ranks material by per-message tokens gets
that backwards.

The console folds the [message log](/gg/context-visibility/#the-message-log) turn
by turn. Each turn's reported input tokens (uncached plus cached) and the cost
those carry at the agent's model's rates are split across that turn's request
messages in proportion to each message's estimated share of the request.
Summing per message, then per band, per view and per tool, gives what each is
answerable for across the whole run, grounded in reported usage rather than
estimates alone. The console's word for the middle grain is Views, since a view
is what a window item is: a file the agent read, or material it composed and
showed itself.

Two figures come out of the fold and they mean different things. A material's own
size counts each message once and is what it cost to bring in. Its billed tokens
sum the same material over every turn it was resident and are what it cost to
keep. The bars rank the second.

Only the input side is attributed. Output and reasoning tokens are what the model
produced rather than material the window carried, so they are no file's or tool's
doing and stay with the Cost widget's own account.

## Attributing a view to its selector

The `context_message` event's `label` carries the window item's selector tag:

- A file view's workspace path, the same tag `evict_file_view { path }` targets.
- The label a program opened an
  [agent view](/gg/responses-as-code/views/) under, which `gg.views.close(label)`
  targets.
- For a documentation view, the name of the thing it documents, which is both its
  heading (`Documentation: openText`) and what `gg.docs.close` names.

The tag rides on the pooled definition, emitted once per distinct message, rather
than on each turn's pointer, because it is a property of the material rather than
of the turn. It also survives what the message envelope does not: a locked,
autoloaded specification is re-framed as a `user` message across a
[compaction](/gg/compaction/) boundary, which discards the `tool_call_id` pairing
its synthesized read was answered under, so the tag is the only thing left that
says which file the biggest band in the window is.

A stream recorded before gg carried the tag falls back to the `read_file` call
the view answers. Whatever neither resolves is reported as unattributed rather
than dropped, so the view list never understates the band it decomposes. A path
and a label are kept apart even when they read the same: a workspace file called
`notes` and a view an agent labelled `notes` are two different things, and
summing them would invent a row that was never in the window.
