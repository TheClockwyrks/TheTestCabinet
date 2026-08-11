-- | Managing the agent's own context window.
-- |
-- | These are the only calls whose effect is on the conversation rather than on the workspace. They
-- | are worth making from a program precisely because a program can decide *when* to: read a set of
-- | files, extract what matters, then evict the views in the same turn.
module Gg.Context
  ( evictFileView
  , archiveThread
  , searchArchive
  , compact
  , ReclaimReport
  , TurnRange
  , ArchiveHit
  , MessageRole(..)
  , ArchiveSearch
  , EvictOptions
  , CompactOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | Which file's views to drop. Optional; `{}` drops every file view held.
type EvictOptions = (path :: String)

-- | What a compaction reads afresh. Optional; `{}` reads nothing back.
type CompactOptions = (files :: Array String)

-- | What a context reclaim actually freed from the live context window.
-- |
-- | # Fields
-- |
-- | - `items` — Context items dropped from the live window.
-- | - `reclaimedTokens` — Approximately how many tokens that freed.
-- | - `paths` — The workspace paths whose views were evicted. Empty for an archive.
-- | - `detail` — The prose summary of what was reclaimed.
type ReclaimReport =
  { items :: Int
  , reclaimedTokens :: Int
  , paths :: Array String
  , detail :: String
  }

-- | An inclusive span of turn numbers, the unit an archive moves out of the window.
-- |
-- | The numbers are the ones on the header of every result the agent is given, so
-- | `{ from: 4, to: 19 }` means exactly the turns numbered 4 through 19, both ends included.
-- |
-- | # Fields
-- |
-- | - `from` — The first turn in the span.
-- | - `to` — The last turn in the span, inclusive.
type TurnRange =
  { from :: Int
  , to :: Int
  }

-- | Who said an archived message.
data MessageRole
  -- | The system prompt.
  = SystemMessage
  -- | A turn's input: a result, a view, or an operator's instruction.
  | UserMessage
  -- | Something the agent itself said.
  | AssistantMessage
  -- | A tool result, on a session that made tool calls rather than writing programs.
  | ToolMessage

derive instance Eq MessageRole
derive instance Generic MessageRole _
instance Show MessageRole where
  show = genericShow

-- | One archived message that matched a search.
-- |
-- | # Fields
-- |
-- | - `seq` — The archived message's sequence number.
-- | - `role` — Who said it.
-- | - `text` — The message text.
type ArchiveHit =
  { seq :: Int
  , role :: MessageRole
  , text :: String
  }

-- | What a search of the archive found.
-- |
-- | # Fields
-- |
-- | - `archiveEmpty` — Nothing has been archived yet, so there was nothing to search.
-- |
-- |   Deliberately distinct from a search that ran and matched nothing, so that a second archive is
-- |   not made in the belief that the first one failed.
-- | - `hits` — The matches, most recent first, at most 8.
type ArchiveSearch =
  { archiveEmpty :: Boolean
  , hits :: Array ArchiveHit
  }

-- | Drop the contents of files already read out of the context window, freeing the tokens they
-- | occupy.
-- |
-- | The files on disk are untouched: this forgets what was read, not what exists.
-- |
-- | # Operation
-- |
-- | context.evict_file_view
-- |
-- | # Arguments
-- |
-- | - `options` — Which file's views to drop; `{}` drops every file view held.
-- | - `options.path` — The file whose views to drop.
-- |
-- | # Returns
-- |
-- | How many context items went and roughly how many tokens that reclaimed, with `paths` naming the
-- | files whose views were dropped.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for a `path` that is given but empty; leaving it out altogether is how every
-- | file view is dropped.
evictFileView
  :: forall given rest
   . Union given rest EvictOptions
  => Record given
  -> Effect ReclaimReport
evictFileView options =
  Wire.call "evict_file_view" "context" "Gg.Context.evictFileView" [ Wire.pick "path" options ]

-- | Move whole turns out of the context window.
-- |
-- | Every result carries a header with its turn number and roughly what holding it costs, so the
-- | turns worth dropping can be named: a span is inclusive at both ends, so `[ { from: 4, to: 19 } ]`
-- | archives turns 4 through 19. The agent's own messages in an archived turn are dropped; the
-- | results are kept and stay searchable.
-- |
-- | # Operation
-- |
-- | context.archive_thread
-- |
-- | # Arguments
-- |
-- | - `ranges` — The inclusive spans of turn numbers to move out of the window.
-- |
-- | # Returns
-- |
-- | How many context items went and roughly how many tokens that reclaimed. `paths` is empty, since
-- | an archive drops turns rather than files.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for a span whose ends are not turn numbers.
archiveThread :: Array TurnRange -> Effect ReclaimReport
archiveThread ranges =
  Wire.call "archive_thread" "context" "Gg.Context.archiveThread" [ Wire.wire ranges ]

-- | Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
-- |
-- | `archiveEmpty` is worth checking before `hits`: it distinguishes nothing having been archived yet
-- | from a search that ran and matched nothing, so a second archive is not made in the belief that
-- | the first one failed.
-- |
-- | # Operation
-- |
-- | context.search_archive
-- |
-- | # Arguments
-- |
-- | - `query` — The substring to look for. Matching is case-insensitive.
-- |
-- | # Returns
-- |
-- | The matches, most recent first and at most 8, beside the `archiveEmpty` flag.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty query.
searchArchive :: String -> Effect ArchiveSearch
searchArchive query =
  archiveSearch <$> Wire.call "search_archive" "context" "Gg.Context.searchArchive" [ Wire.wire query ]

-- | Compact the context window: the detailed thread is dropped and restarted from a summary.
-- |
-- | Each path in `files` is read afresh into the restarted window. Skills, memories and the task list
-- | are kept as they are. gg asks for this call when the window is full, and refuses every other call
-- | until it is made.
-- |
-- | It does not stop the program: it registers the request and returns, and the rewrite happens once
-- | the program has ended. Everything not in the summary and not in `files` is gone, so the summary
-- | is written for the agent that resumes, and the files it will need in hand are named.
-- |
-- | # Operation
-- |
-- | context.compact
-- |
-- | # Arguments
-- |
-- | - `summary` — What the restarted window opens with. Everything not in it and not re-read from
-- |   `files` is gone.
-- | - `options` — What to read back into the restarted window; `{}` reads nothing back.
-- | - `options.files` — The paths to read afresh into the restarted window. Defaults to none.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for a blank summary. This is the one call gg does not refuse while a
-- | compaction is in flight, since nothing else can clear the window.
compact
  :: forall given rest
   . Union given rest CompactOptions
  => String
  -> Record given
  -> Effect Unit
compact summary options =
  Wire.call_ "compact" "context" "Gg.Context.compact" [ Wire.wire summary, Wire.pick "files" options ]


-- | An archive search, with each hit's role as an arm.
archiveSearch :: Wire.Wire -> ArchiveSearch
archiveSearch value =
  { archiveEmpty: Wire.field "archiveEmpty" value
  , hits: map archiveHit (Wire.field "hits" value)
  }

-- | One archived message.
archiveHit :: Wire.Wire -> ArchiveHit
archiveHit value =
  { seq: Wire.field "seq" value
  , role: messageRole (Wire.text "role" value)
  , text: Wire.text "text" value
  }

-- | Who said an archived message. Closed at four, and total because the conversion has to be.
messageRole :: String -> MessageRole
messageRole = case _ of
  "system" -> SystemMessage
  "assistant" -> AssistantMessage
  "tool" -> ToolMessage
  _ -> UserMessage
