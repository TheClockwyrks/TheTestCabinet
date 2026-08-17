-- | Durable notes that survive context compaction.
-- |
-- | A run picks one of three memory strategies and binds only that strategy's functions, so what
-- | this module offers is the honest answer to what memory can do here. The scratchpad keeps every
-- | memory in the context window (`writeMemory` and `updateMemory`); the two file-shaped strategies
-- | keep the contents outside it (`createMemory`, `readMemory` and `editMemory`), one behind an index
-- | that is always in context and one behind `searchMemories`. Deleting is bound under all three.
-- |
-- | Every mutation hands back the budget after it, so a program decides whether to write another
-- | memory by reading numbers rather than by parsing a sentence about them.
module Gg.Memories
  ( writeMemory
  , updateMemory
  , createMemory
  , readMemory
  , editMemory
  , searchMemories
  , readHit
  , deleteMemory
  , MemoryUsage
  , MemoryHit
  , MemoryCodeOptions
  ) where

import Prelude

import Data.Maybe (Maybe)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The two code halves every write of a memory accepts, and may leave out.
type MemoryCodeOptions = (code :: String, onUse :: String)

-- | How much of the run's durable-memory budget is used, after the call that returned it.
-- |
-- | Every maximum is optional: each limit can be turned off, and a run's memory strategy applies only
-- | some of them, so `Nothing` means nothing bounds that axis and is worth checking before
-- | subtracting.
-- |
-- | # Fields
-- |
-- | - `count` — Memories currently held.
-- | - `maxCount` — The most memories this run allows, if it limits the count.
-- | - `totalChars` — Characters of body currently held, across all memories.
-- | - `maxTotalChars` — The most characters of body this run allows in total, if it limits the
-- |   aggregate.
-- | - `indexChars` — Characters the memory index occupies, under a run that keeps one.
-- | - `maxIndexChars` — The most characters the index may occupy, if it is limited.
type MemoryUsage =
  { count :: Int
  , maxCount :: Maybe Int
  , totalChars :: Int
  , maxTotalChars :: Maybe Int
  , indexChars :: Maybe Int
  , maxIndexChars :: Maybe Int
  }

-- | One memory a search matched, and the numbers it was ranked by.
-- |
-- | # Fields
-- |
-- | - `name` — The memory's slug, which is what a read takes.
-- | - `description` — Its description, or `""` when it was created without one.
-- | - `matched` — How many distinct keywords of the query it matched — the primary ranking.
-- | - `occurrences` — How many times those keywords occur in it — the tiebreak.
-- | - `excerpt` — A short window of the memory around its first match.
type MemoryHit =
  { name :: String
  , description :: String
  , matched :: Int
  , occurrences :: Int
  , excerpt :: String
  }

-- | Record a durable memory that survives context compaction.
-- |
-- | A memory may also carry **code**. `code` is a PureScript module whose exports are bound at
-- | `lib.<name>` in every later program, so a helper got right once is never written again; `onUse`
-- | is a script gg runs the first time the memory comes into use, whose views arrive on the next
-- | turn. Neither is context — they cost no window, are never shown back, and count against no body
-- | limit — and both are bounded on their own.
-- |
-- | # Operation
-- |
-- | memories.write_memory
-- |
-- | # Arguments
-- |
-- | - `memory` — The memory to record. Its name must not already be taken.
-- | - `memory.name` — The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other
-- |   memory call takes, and no two memories may share one.
-- | - `memory.description` — A one-line description of what the memory holds. Where the run keeps a
-- |   memory index this is the memory's line in it.
-- | - `memory.body` — The memory's contents.
-- | - `memory.code` — A PureScript module whose exports are bound at `lib.<name>` for the rest of the
-- |   session. Left out for a memory that is only prose.
-- | - `memory.onUse` — A script gg runs the first time the memory comes into use, whose views arrive
-- |   on the next turn. Left out for a memory that runs nothing.
-- |
-- | # Returns
-- |
-- | The memory budget the write left behind. A maximum this run does not bound is `Nothing`, which
-- | is worth checking before subtracting.
-- |
-- | # Throws
-- |
-- | `Conflict` on a duplicate name, and `LimitExceeded` when the body would breach the run's caps —
-- | revising or deleting a memory beats accruing more.
writeMemory
  :: forall given rest
   . Union given rest MemoryCodeOptions
  => { name :: String, description :: String, body :: String | given }
  -> Effect MemoryUsage
writeMemory written =
  memoryUsage <$> Wire.call "write_memory" "memories" "Gg.Memories.writeMemory" [ Wire.lower {} written ]

-- | Replace an existing memory's description and body, keyed on its name.
-- |
-- | Its `code` and `onUse` are replaced too, so leaving them out clears them.
-- |
-- | # Operation
-- |
-- | memories.update_memory
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
-- | # Returns
-- |
-- | The memory budget the replacement left behind.
-- |
-- | # Throws
-- |
-- | `NotFound` when no memory has that name.
updateMemory
  :: forall given rest
   . Union given rest MemoryCodeOptions
  => { name :: String, description :: String, body :: String | given }
  -> Effect MemoryUsage
updateMemory written =
  memoryUsage <$> Wire.call "update_memory" "memories" "Gg.Memories.updateMemory" [ Wire.lower {} written ]

-- | Record a new memory whose contents stay out of the context window until they are read.
-- |
-- | It takes a slug, a one-line description — required where the run keeps an index, since that is
-- | the memory's line in it — and the initial contents. It may also carry `code`, a module bound at
-- | `lib.<name>` once the memory is read, and `onUse`, a script run on that first read.
-- |
-- | # Operation
-- |
-- | memories.create_memory
-- |
-- | # Arguments
-- |
-- | - `memory` — The memory to record. Its body stays out of the context window until it is read, and
-- |   its name must not already be taken.
-- | - `memory.name` — The memory's slug: letters, digits, `-`, `_` and `.`.
-- | - `memory.description` — A one-line description of what the memory holds, which is its line in
-- |   the index.
-- | - `memory.body` — The memory's initial contents.
-- | - `memory.code` — A PureScript module whose exports are bound at `lib.<name>` once the memory is
-- |   read. Left out for a memory that is only prose.
-- | - `memory.onUse` — A script gg runs on that first read. Left out for a memory that runs nothing.
-- |
-- | # Returns
-- |
-- | The memory budget the new memory left behind.
-- |
-- | # Throws
-- |
-- | `Conflict` on a duplicate slug, and `LimitExceeded` when the contents, or the index entry, would
-- | breach a limit.
createMemory
  :: forall given rest
   . Union given rest MemoryCodeOptions
  => { name :: String, description :: String, body :: String | given }
  -> Effect MemoryUsage
createMemory written =
  memoryUsage <$> Wire.call "create_memory" "memories" "Gg.Memories.createMemory" [ Wire.lower {} written ]

-- | Read one memory's full contents by slug — the only call that brings them into the context window.
-- |
-- | A memory that carries code loads that code as it is read: the reply names the `lib.<key>` it is
-- | bound at, and it stays bound for the rest of the session.
-- |
-- | # Operation
-- |
-- | memories.read_memory
-- |
-- | # Arguments
-- |
-- | - `name` — The memory's slug.
-- |
-- | # Returns
-- |
-- | The memory's body, and — where it carried code — the `lib.<key>` its exports are now bound at.
-- |
-- | # Throws
-- |
-- | `NotFound` when no memory has that slug.
readMemory :: String -> Effect String
readMemory name = Wire.call "read_memory" "memories" "Gg.Memories.readMemory" [ Wire.wire name ]

-- | Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.
-- |
-- | Appending is quoting the last line and replacing it with itself plus what is being added.
-- |
-- | # Operation
-- |
-- | memories.edit_memory
-- |
-- | # Arguments
-- |
-- | - `edit` — The revision to make.
-- | - `edit.name` — The slug of the memory to revise.
-- | - `edit.search` — The exact text to find in its contents. It must appear exactly once.
-- | - `edit.replace` — The text to put in its place.
-- |
-- | # Returns
-- |
-- | The memory budget the revision left behind.
-- |
-- | # Throws
-- |
-- | `NotFound` when the text does not appear, `Conflict` when it appears more than once,
-- | `LimitExceeded` when the result would be too long, and `InvalidArgument` when the edit would
-- | leave the memory empty — deleting it is the call for that.
editMemory :: { name :: String, search :: String, replace :: String } -> Effect MemoryUsage
editMemory edit =
  memoryUsage <$> Wire.call "edit_memory" "memories" "Gg.Memories.editMemory" [ Wire.wire edit ]

-- | Find the memories mentioning any of the given keywords, best first.
-- |
-- | Plain case-insensitive substring matching over each memory's slug, description and contents,
-- | ranked by how many of the keywords a memory mentions and then by how often. Several specific
-- | words rank better than one sentence, and the hits worth having in full are then read.
-- |
-- | # Operation
-- |
-- | memories.search_memories
-- |
-- | # Arguments
-- |
-- | - `keywords` — The words to look for. Several specific words rank better than one sentence,
-- |   because a memory is ranked by how many of them it mentions.
-- |
-- | # Returns
-- |
-- | The memories that matched, best first, each with an excerpt and the two counts it was ranked
-- | by. A search that matches nothing is an empty array.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` when every keyword is empty.
searchMemories :: Array String -> Effect (Array MemoryHit)
searchMemories keywords =
  Wire.call "search_memories" "memories" "Gg.Memories.searchMemories" [ Wire.wire keywords ]

-- | Read the full contents of a memory a search matched.
-- |
-- | `Gg.Memories.readMemory` with the slug already taken out of the hit, for the common case where
-- | the search that found it is the thing in hand. A hit carries an excerpt and nothing more, so
-- | this is how the rest of a promising one is read.
-- |
-- | # Alias
-- |
-- | memories.read_memory
-- |
-- | # Arguments
-- |
-- | - `hit` — The memory to read, as `Gg.Memories.searchMemories` matched it.
-- |
-- | # Returns
-- |
-- | The memory's body, and — where it carried code — the `lib.<key>` its exports are now bound at.
-- |
-- | # Throws
-- |
-- | `NotFound` when the memory has since been deleted.
readHit :: MemoryHit -> Effect String
readHit hit = readMemory hit.name

-- | Evict a memory by name, freeing room in the budget.
-- |
-- | # Operation
-- |
-- | memories.delete_memory
-- |
-- | # Arguments
-- |
-- | - `name` — The memory's slug.
-- |
-- | # Returns
-- |
-- | The memory budget the eviction left behind.
-- |
-- | # Throws
-- |
-- | `NotFound` when no memory has that name.
deleteMemory :: String -> Effect MemoryUsage
deleteMemory name =
  memoryUsage <$> Wire.call "delete_memory" "memories" "Gg.Memories.deleteMemory" [ Wire.wire name ]


-- | The memory budget, whose every maximum may be switched off.
memoryUsage :: Wire.Wire -> MemoryUsage
memoryUsage value =
  { count: Wire.field "count" value
  , maxCount: Wire.optional "maxCount" value
  , totalChars: Wire.field "totalChars" value
  , maxTotalChars: Wire.optional "maxTotalChars" value
  , indexChars: Wire.optional "indexChars" value
  , maxIndexChars: Wire.optional "maxIndexChars" value
  }
