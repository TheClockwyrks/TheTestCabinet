-- | The `memory` object: durable notes that survive context compaction.
-- |
-- | A run picks one of three memory strategies, and only that strategy's functions are bound — so
-- | `memory.list` is the honest answer to "what can I do with memory here?". The scratchpad keeps
-- | every memory in the context window (`writeMemory`/`updateMemory`); the two file-shaped strategies
-- | keep the contents *outside* it (`createMemory`/`readMemory`/`editMemory`), one behind an index
-- | that is always in context and one behind `searchMemories`. `deleteMemory` is bound under all
-- | three.
-- |
-- | Every mutation hands back the budget after it, so a program can decide whether to write another
-- | memory by reading numbers rather than by parsing a sentence about them.
module Gg.Memory
  ( memory
  , writeMemory
  , updateMemory
  , createMemory
  , readMemory
  , editMemory
  , searchMemories
  , deleteMemory
  , MemoryCodeOptions
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Read (memoryUsage)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FunctionSummary, MemoryHit, MemoryUsage)
import Prim.Row (class Union)

-- | The two code halves every write of a memory accepts, and may leave out.
type MemoryCodeOptions = (code :: String, onUse :: String)

-- | durable memories that survive context compaction
memory
  :: { writeMemory ::
         forall given rest
          . Union given rest MemoryCodeOptions
         => { name :: String, description :: String, body :: String | given }
         -> Effect MemoryUsage
     , updateMemory ::
         forall given rest
          . Union given rest MemoryCodeOptions
         => { name :: String, description :: String, body :: String | given }
         -> Effect MemoryUsage
     , createMemory ::
         forall given rest
          . Union given rest MemoryCodeOptions
         => { name :: String, description :: String, body :: String | given }
         -> Effect MemoryUsage
     , readMemory :: String -> Effect String
     , editMemory ::
         { name :: String, search :: String, replace :: String } -> Effect MemoryUsage
     , searchMemories :: Array String -> Effect (Array MemoryHit)
     , deleteMemory :: String -> Effect MemoryUsage
     , list :: Effect (Array FunctionSummary)
     }
memory =
  { writeMemory
  , updateMemory
  , createMemory
  , readMemory
  , editMemory
  , searchMemories
  , deleteMemory
  , list: listOn "memory"
  }

-- | Record a durable memory that survives context compaction, and hand back how much of the memory
-- | budget is now used.
-- |
-- | A memory may also carry **code**. `code` is a PureScript module whose exports are bound at
-- | `lib.<name>` in every later program you write, so a helper you get right once you never write
-- | again; `onUse` is a script gg runs the first time the memory comes into use, whose views reach
-- | you on your next turn. Neither is context — they cost you no window, are never shown back to
-- | you, and count against no body limit — and both are bounded on their own.
-- |
-- | # Arguments
-- |
-- | - `memory` — The memory to record. Its name must not already be taken.
-- | - `memory.name` — The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other
-- |   memory call takes, and no two memories may share one.
-- | - `memory.description` — A one-line description of what the memory holds. Where the run keeps a
-- |   memory index this is the memory's line in it, and so all you see of the memory until you read
-- |   it.
-- | - `memory.body` — The memory's contents.
-- | - `memory.code` — A PureScript module whose exports are bound at `lib.<name>` for the rest of
-- |   your session. Leave it out for a memory that is only prose.
-- | - `memory.onUse` — A script gg runs the first time the memory comes into use; whatever it shows
-- |   you arrives on your next turn. Leave it out for a memory that runs nothing.
-- |
-- | # Raises
-- |
-- | `Conflict` on a duplicate name, and `LimitExceeded` when the body would breach the run's caps —
-- | revise or delete a memory rather than accruing more.
writeMemory
  :: forall given rest
   . Union given rest MemoryCodeOptions
  => { name :: String, description :: String, body :: String | given }
  -> Effect MemoryUsage
writeMemory written =
  memoryUsage <$> Wire.call "write_memory" "memory" "writeMemory" [ Wire.lower {} written ]

-- | Replace an existing memory's description and body, keyed on its `name`, and hand back the memory
-- | budget.
-- |
-- | Its `code` and `onUse` are replaced too — leaving them out clears them.
-- |
-- | # Arguments
-- |
-- | - `memory` — The replacement, keyed on its `name`. Every other field replaces what the existing
-- |   memory held, and one left out clears it.
-- | - `memory.name` — The slug of the memory to replace.
-- | - `memory.description` — The one-line description to replace the old one with.
-- | - `memory.body` — The contents to replace the old ones with.
-- | - `memory.code` — A PureScript module whose exports are bound at `lib.<name>`. Leaving it out
-- |   clears the code the memory had.
-- | - `memory.onUse` — A script gg runs the first time the memory comes into use. Leaving it out
-- |   clears the one the memory had.
-- |
-- | # Raises
-- |
-- | `NotFound` when no memory has that name.
updateMemory
  :: forall given rest
   . Union given rest MemoryCodeOptions
  => { name :: String, description :: String, body :: String | given }
  -> Effect MemoryUsage
updateMemory written =
  memoryUsage <$> Wire.call "update_memory" "memory" "updateMemory" [ Wire.lower {} written ]

-- | Record a new memory whose contents are kept OUT of your context window until you read them, and
-- | hand back the memory budget.
-- |
-- | Give it a slug, a one-line description — required where the run keeps an index, since that is the
-- | memory's line in it — and the initial contents. It may also carry `code` (a module bound at
-- | `lib.<name>` once you read the memory) and `onUse` (a script run on that first read).
-- |
-- | # Arguments
-- |
-- | - `memory` — The memory to record. Its `body` stays out of your context window until you read
-- |   it, and its name must not already be taken.
-- | - `memory.name` — The memory's slug: letters, digits, `-`, `_` and `.`.
-- | - `memory.description` — A one-line description of what the memory holds, which is its line in
-- |   the index.
-- | - `memory.body` — The memory's initial contents.
-- | - `memory.code` — A PureScript module whose exports are bound at `lib.<name>` once you read the
-- |   memory. Leave it out for a memory that is only prose.
-- | - `memory.onUse` — A script gg runs on that first read. Leave it out for a memory that runs
-- |   nothing.
-- |
-- | # Raises
-- |
-- | `Conflict` on a duplicate slug, and `LimitExceeded` when the contents, or the index entry, would
-- | breach a limit.
createMemory
  :: forall given rest
   . Union given rest MemoryCodeOptions
  => { name :: String, description :: String, body :: String | given }
  -> Effect MemoryUsage
createMemory written =
  memoryUsage <$> Wire.call "create_memory" "memory" "createMemory" [ Wire.lower {} written ]

-- | Read one memory's full contents, by slug — the only thing that brings them into your context.
-- |
-- | If the memory carries code, reading it also loads that code: the reply names the `lib.<key>` it
-- | is bound at, and it stays bound for the rest of your session.
-- |
-- | # Arguments
-- |
-- | - `name` — The memory's slug.
-- |
-- | # Raises
-- |
-- | `NotFound` when no memory has that slug.
readMemory :: String -> Effect String
readMemory name = Wire.call "read_memory" "memory" "readMemory" [ Wire.wire name ]

-- | Revise a memory in place by replacing the one exact occurrence of `search` with `replace`, and
-- | hand back the memory budget.
-- |
-- | Append by quoting the last line and replacing it with itself plus what you are adding.
-- |
-- | # Arguments
-- |
-- | - `edit` — The revision to make.
-- | - `edit.name` — The slug of the memory to revise.
-- | - `edit.search` — The exact text to find in its contents. It must appear exactly once.
-- | - `edit.replace` — The text to put in its place.
-- |
-- | # Raises
-- |
-- | `NotFound` when the text does not appear, `Conflict` when it appears more than once,
-- | `LimitExceeded` when the result would be too long, and `InvalidArgument` when the edit would
-- | leave the memory empty — delete it instead.
editMemory :: { name :: String, search :: String, replace :: String } -> Effect MemoryUsage
editMemory edit =
  memoryUsage <$> Wire.call "edit_memory" "memory" "editMemory" [ Wire.wire edit ]

-- | Find the memories mentioning any of `keywords`, best first.
-- |
-- | Plain case-insensitive substring matching over each memory's slug, description and contents,
-- | ranked by how many of your keywords a memory mentions and then by how often. Pass several
-- | specific words rather than one sentence, then `memory.readMemory` the hits worth having in full.
-- | A search that matches nothing is an empty array.
-- |
-- | # Arguments
-- |
-- | - `keywords` — The words to look for. Several specific words rank better than one sentence,
-- |   because a memory is ranked by how many of them it mentions.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` when every keyword is empty.
searchMemories :: Array String -> Effect (Array MemoryHit)
searchMemories keywords =
  Wire.call "search_memories" "memory" "searchMemories" [ Wire.wire keywords ]

-- | Evict a memory by name, freeing room in the budget, and hand back what is left in use.
-- |
-- | # Arguments
-- |
-- | - `name` — The memory's slug.
-- |
-- | # Raises
-- |
-- | `NotFound` when no memory has that name.
deleteMemory :: String -> Effect MemoryUsage
deleteMemory name =
  memoryUsage <$> Wire.call "delete_memory" "memory" "deleteMemory" [ Wire.wire name ]
