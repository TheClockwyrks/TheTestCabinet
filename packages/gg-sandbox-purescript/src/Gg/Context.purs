-- | The `context` object: managing your own context window.
-- |
-- | These are the only calls whose effect is on the conversation rather than on the workspace. They
-- | are worth making from a program precisely because a program can decide *when* to: read a set of
-- | files, extract what matters, then evict the views in the same turn.
module Gg.Context
  ( context
  , evictFileView
  , archiveThread
  , searchArchive
  , compact
  , EvictOptions
  , CompactOptions
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Read (archiveSearch)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (ArchiveSearch, FunctionSummary, ReclaimReport, TurnRange)
import Prim.Row (class Union)

-- | Which file's views to drop. Optional; `{}` drops every file view you hold.
type EvictOptions = (path :: String)

-- | What a compaction reads afresh. Optional; `{}` reads nothing back.
type CompactOptions = (files :: Array String)

-- | manage your own context window
context
  :: { evictFileView ::
         forall given rest
          . Union given rest EvictOptions
         => Record given
         -> Effect ReclaimReport
     , archiveThread :: Array TurnRange -> Effect ReclaimReport
     , searchArchive :: String -> Effect ArchiveSearch
     , compact ::
         forall given rest
          . Union given rest CompactOptions
         => String
         -> Record given
         -> Effect Unit
     , list :: Effect (Array FunctionSummary)
     }
context =
  { evictFileView
  , archiveThread
  , searchArchive
  , compact
  , list: listOn "context"
  }

-- | Drop the contents of files you have read out of your context window, freeing the tokens they
-- | occupy, and report what that reclaimed.
-- |
-- | The files on disk are untouched — this forgets what you read, not what exists.
-- |
-- | # Arguments
-- |
-- | - `options` — Which file's views to drop; pass `{}` to drop every file view you hold.
-- | - `options.path` — The file whose views to drop.
evictFileView
  :: forall given rest
   . Union given rest EvictOptions
  => Record given
  -> Effect ReclaimReport
evictFileView options =
  Wire.call "evict_file_view" "context" "evictFileView" [ Wire.pick "path" options ]

-- | Move whole turns out of your context window and report what that reclaimed.
-- |
-- | Every result you are given carries a header with its turn number and roughly what holding it
-- | costs, so name the turns worth dropping: a span is inclusive at both ends, and
-- | `context.archiveThread [ { from: 4, to: 19 } ]` archives turns 4 through 19. Your own messages
-- | in an archived turn are dropped; the results are kept and stay searchable with
-- | `context.searchArchive`.
-- |
-- | # Arguments
-- |
-- | - `ranges` — The inclusive spans of turn numbers to move out of your window.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` for a span whose ends are not turn numbers.
archiveThread :: Array TurnRange -> Effect ReclaimReport
archiveThread ranges =
  Wire.call "archive_thread" "context" "archiveThread" [ Wire.wire ranges ]

-- | Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
-- |
-- | Check `archiveEmpty` before reading `hits`: it distinguishes "nothing has been archived yet" from
-- | "the search ran and matched nothing", so you do not archive again believing the first archive
-- | failed.
-- |
-- | # Arguments
-- |
-- | - `query` — The substring to look for. Matching is case-insensitive.
searchArchive :: String -> Effect ArchiveSearch
searchArchive query =
  archiveSearch <$> Wire.call "search_archive" "context" "searchArchive" [ Wire.wire query ]

-- | Compact your context window: the detailed thread is dropped and restarted from `summary`, plus a
-- | fresh read of each path in `files`.
-- |
-- | Your skills, memories and task list are kept as they are. You are asked to call this when your
-- | window is full, and every other call is refused until you do.
-- |
-- | It does NOT stop your program: it registers the request and returns, and the rewrite happens once
-- | your program has ended. Everything not in your summary and not in `files` is gone, so write the
-- | summary for your future self and name the files you will actually need in hand.
-- |
-- | # Arguments
-- |
-- | - `summary` — What your restarted window opens with. Write it for your future self: everything
-- |   not in it and not re-read from `files` is gone.
-- | - `options` — What to read back into the restarted window; pass `{}` to read nothing back.
-- | - `options.files` — The paths to read afresh into the restarted window. Defaults to none.
-- |
-- | # Raises
-- |
-- | `Refused` when a compaction is already in flight and this call is not the one it asked for.
compact
  :: forall given rest
   . Union given rest CompactOptions
  => String
  -> Record given
  -> Effect Unit
compact summary options =
  Wire.call_ "compact" "context" "compact" [ Wire.wire summary, Wire.pick "files" options ]
