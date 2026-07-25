---
title: "Context visibility"
---

gg **tracks what is consuming the context window**, broken down by source: skills,
memories, file contents, the thread/history, tool output, and so on.

- Internally this is the accounting that powers the fullness signal in
  [agent-managed context](/gg/agent-managed-context/) and the trigger in
  [compaction](/gg/compaction/).
- Externally this breakdown is streamed as [telemetry](/gg/telemetry/) and rendered
  in the console as a **stacked line graph** showing how an agent's context window
  fills over the course of a run, by category.

## The window renders as an append-only prompt

**A turn never rewrites what an earlier turn already sent.** Everything already in the
window stays exactly where it is, byte for byte; a turn only *appends*. This is a rule
gg holds itself to, not an implementation detail, because it is the whole basis of
provider **prompt caching**: a request reads the cache only for a prefix the provider
has already seen, so any edit *behind* the end of the prompt throws away the cache for
every message after the edit. On a long run that is most of its token bill.

Two kinds of state make that non-trivial.

**Mutable blocks.** The memory block, the task list, the epic/issue board, and the
fullness signal are each rebuilt from their backing store at every turn boundary so the
model always sees current state, and each is a *single* live block. Two rules keep the
rebuild append-only:

- **An unchanged block does not move.** When it comes back byte-identical the rebuild is
  skipped and the block keeps its position, rather than being lifted to the tail behind
  the history accumulated since. Re-appending an unchanged block would rewrite the prompt
  just before its end *every turn*, so no turn would ever extend the last one.
- **A changed block is superseded, not removed.** The old copy is left exactly where it
  sits and retagged as ordinary ephemeral history; the new one is appended at the tail.
  Deleting it instead would be at its most expensive precisely when the block had held
  still longest, since that is when the most history sits behind it.

A superseded copy is the honest record of what the model was told at that point in the
thread — no different from a tool result — and the model reads the newest block as
current. It costs one block's worth of tokens per real change, is accounted as history
rather than inflating the source's own band, and a compaction summarizes it away. The
same rule is why the fullness signal reports
[rounded figures](/gg/agent-managed-context/): a line that moved by a handful of tokens
would otherwise supersede itself every turn for no benefit.

**File views.** A `read_file` result is a snapshot of the file *as it was read*, and
nothing later rewrites it — not a `write_file`, not an `edit_file`, not a re-read. Each
read appends its own view. So the agent's own writes never silently rewrite the prompt
behind them, and an agent that needs the current contents of a file it has changed reads
it again, which appends. This is also the honest reading: the earlier view is what the
agent actually saw at that point, and editing history to show contents the agent never
read would be a lie about the thread as well as a cache miss.

Three things do remove material from the middle of the window, and each is a deliberate
choice whose point is to reclaim tokens: `evict_file_view` and `archive_thread`, both
[invoked by the agent](/gg/agent-managed-context/), and a
[compaction](/gg/compaction/) boundary, which rewrites the window wholesale. Each
necessarily resets the cache; that is the price of the space they buy back.
