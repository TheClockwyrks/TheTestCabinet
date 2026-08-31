-- | Durable notes that survive context compaction.
-- |
-- | A run picks one of three memory strategies and binds only that strategy's functions. The
-- | scratchpad strategy keeps every memory in the context window; the two file-shaped strategies keep
-- | the contents outside it until a memory is read, one behind an index that is always in context and
-- | one behind a keyword search.
-- |
-- | Every mutation hands back the memory budget after it.
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
-- | some of them. `Nothing` means nothing bounds that axis.
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
-- | A memory may also carry code. `code` is a PureScript module every later program may import as
-- | `Lib.<Key>`; `onUse` is a script gg runs on every use of the memory, whose views arrive on the
-- | next turn. Neither costs window, neither is shown back, and both are bounded on their own rather
-- | than against the body limit.
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
-- | - `memory.code` — A PureScript module later programs import as `Lib.<Key>` for the rest of the
-- |   session. Left out for a memory that is only prose.
-- | - `memory.onUse` — A script gg runs on every use of the memory, whose views arrive on the next
-- |   turn. Left out for a memory that runs nothing.
-- |
-- | # Returns
-- |
-- | The memory budget the write left behind. A maximum this run does not bound is `Nothing`.
-- |
-- | # Throws
-- |
-- | `Conflict` on a duplicate name, and `LimitExceeded` when the body would breach the run's caps.
writeMemory
  :: forall given rest
   . Union given rest MemoryCodeOptions
  => { name :: String, description :: String, body :: String | given }
  -> Effect MemoryUsage
writeMemory written =
  Wire.callMap memoryUsage "write_memory" "memories" "Gg.Memories.writeMemory" [ Wire.lower {} written ]

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
-- | - `memory.code` — A PureScript module later programs import as `Lib.<Key>`. Leaving it out
-- |   clears the code the memory had.
-- | - `memory.onUse` — A script gg runs on every use of the memory. Leaving it out clears the one the
-- |   memory had.
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
  Wire.callMap memoryUsage "update_memory" "memories" "Gg.Memories.updateMemory" [ Wire.lower {} written ]

-- | Record a new memory whose contents stay out of the context window until they are read.
-- |
-- | It takes a slug, a one-line description — required where the run keeps an index, since that is
-- | the memory's line in it — and the initial contents. It may also carry `code`, a module later
-- | programs import as `Lib.<Key>` once the memory is read, and `onUse`, a script run on every
-- | read.
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
-- | - `memory.code` — A PureScript module later programs import as `Lib.<Key>` once the memory is
-- |   read. Left out for a memory that is only prose.
-- | - `memory.onUse` — A script gg runs on every read. Left out for a memory that runs nothing.
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
  Wire.callMap memoryUsage "create_memory" "memories" "Gg.Memories.createMemory" [ Wire.lower {} written ]

-- | Read one memory's full contents by slug — the only call that brings them into the context window.
-- |
-- | A memory that carries code loads that code as it is read: gg opens a documentation view of each
-- | function the module declares, and every later program may import it.
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
-- | The memory's body. Where it carried code, that code is loaded as well, and what it declares
-- | arrives as documentation views rather than in this reply.
-- |
-- | # Throws
-- |
-- | `NotFound` when no memory has that slug.
readMemory :: String -> Effect String
readMemory name = Wire.call "read_memory" "memories" "Gg.Memories.readMemory" [ Wire.wire name ]

-- | Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.
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
  Wire.callMap memoryUsage "edit_memory" "memories" "Gg.Memories.editMemory" [ Wire.wire edit ]

-- | Find the memories mentioning any of the given keywords, best first.
-- |
-- | Case-insensitive substring matching over each memory's slug, description and contents, ranked by
-- | how many of the keywords a memory mentions and then by how often.
-- |
-- | # Operation
-- |
-- | memories.search_memories
-- |
-- | # Arguments
-- |
-- | - `keywords` — The words to look for. A memory is ranked by how many of them it mentions.
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
-- | `Gg.Memories.readMemory` with the slug taken out of the hit, which carries an excerpt and
-- | nothing more.
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
-- | The memory's body. Where it carried code, that code is loaded as well, and what it declares
-- | arrives as documentation views rather than in this reply.
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
  Wire.callMap memoryUsage "delete_memory" "memories" "Gg.Memories.deleteMemory" [ Wire.wire name ]


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
