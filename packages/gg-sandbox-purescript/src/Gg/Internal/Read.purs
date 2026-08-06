-- | **Reading the far side's answers** — the other half of the bridge, and the only place in the SDK
-- | that turns a JavaScript value into one of [`Gg.Types`](Gg.Types)'s.
-- |
-- | Most of it is nothing at all, and that is the point of the types being records: a PureScript
-- | record *is* a JavaScript object, so a result whose fields are all strings, numbers, booleans and
-- | arrays needs no conversion — it is taken as it stands. What genuinely differs is narrow and
-- | listed here in one place:
-- |
-- | * a field the wire may omit becomes a `Maybe`;
-- | * a field that is one of a fixed set of words becomes a `data` type's arm;
-- | * a `{ kind: "text" | "image" }` object becomes a real sum type a program matches on.
-- |
-- | Nothing here is model-facing; a program imports [`Gg`](Gg) and sees only the types.
module Gg.Internal.Read
  ( fileRead
  , shellOutput
  , dirEntry
  , memoryUsage
  , openView
  , subagentResult
  , programSummary
  , archiveSearch
  ) where

import Prelude

import Data.Maybe (Maybe(..))
import Gg.Internal.Wire (Wire, field, optional, taken, text)
import Gg.Types
  ( AgentEnding(..)
  , ArchiveHit
  , ArchiveSearch
  , DirEntry
  , EntryKind(..)
  , FileRead(..)
  , MemoryUsage
  , MessageRole(..)
  , OpenView
  , ProgramSummary
  , ShellOutput
  , SubagentResult
  , ViewKind(..)
  )

-- | A read, narrowed to the arm its `kind` names.
-- |
-- | The text arm is taken as it stands: every one of its fields is a plain value under the same
-- | name, and the `kind` the wire also carries is a field this type does not declare, so nothing
-- | reading a `TextFile` can see it.
fileRead :: Wire -> FileRead
fileRead value = case text "kind" value of
  "image" -> ImageFile
    { mediaType: text "mediaType" value
    , label: text "label" value
    , bytes: field "bytes" value
    , shown: field "shown" value
    , notShownReason: optional "notShownReason" value
    }
  _ -> TextFile (taken value)

-- | A finished command. `exitCode` is absent when a signal killed the process.
shellOutput :: Wire -> ShellOutput
shellOutput value =
  { exitCode: optional "exitCode" value
  , output: text "output" value
  , truncated: field "truncated" value
  }

-- | One directory entry, with its kind as an arm rather than a word.
dirEntry :: Wire -> DirEntry
dirEntry value =
  { name: text "name" value
  , kind: entryKind (text "kind" value)
  }

-- | The memory budget, whose every maximum may be switched off.
memoryUsage :: Wire -> MemoryUsage
memoryUsage value =
  { count: field "count" value
  , maxCount: optional "maxCount" value
  , totalChars: field "totalChars" value
  , maxTotalChars: optional "maxTotalChars" value
  , indexChars: optional "indexChars" value
  , maxIndexChars: optional "maxIndexChars" value
  }

-- | One open view. A paged file view carries the window it covers; nothing else does.
openView :: Wire -> OpenView
openView value =
  { kind: viewKind (text "kind" value)
  , selector: text "selector" value
  , tokens: field "tokens" value
  , region: optional "region" value
  }

-- | One child agent's result. A child that produced no return value at all has no ending.
subagentResult :: Wire -> SubagentResult
subagentResult value =
  { id: text "id" value
  , status: agentEnding =<< optional "status" value
  , summary: text "summary" value
  }

-- | One program in the library's directory.
programSummary :: Wire -> ProgramSummary
programSummary value =
  { turn: field "turn" value
  , lines: field "lines" value
  , chars: field "chars" value
  , ok: field "ok" value
  , error: optional "error" value
  }

-- | An archive search, with each hit's role as an arm.
archiveSearch :: Wire -> ArchiveSearch
archiveSearch value =
  { archiveEmpty: field "archiveEmpty" value
  , hits: map archiveHit (field "hits" value)
  }

-- | One archived message.
archiveHit :: Wire -> ArchiveHit
archiveHit value =
  { seq: field "seq" value
  , role: messageRole (text "role" value)
  , text: text "text" value
  }

-- | What a directory entry is. Anything that is neither a file nor a directory is `OtherEntry`,
-- | which is the arm the wire's own `other` means.
entryKind :: String -> EntryKind
entryKind = case _ of
  "file" -> FileEntry
  "directory" -> DirectoryEntry
  _ -> OtherEntry

-- | Which kind of view this is. The wire's set is closed at three and gg owns it, so the fallback
-- | exists only because the conversion has to be total.
viewKind :: String -> ViewKind
viewKind = case _ of
  "file" -> FileView
  "docs" -> DocsView
  _ -> TextView

-- | Who said an archived message. Closed at four, and total for the same reason.
messageRole :: String -> MessageRole
messageRole = case _ of
  "system" -> SystemMessage
  "assistant" -> AssistantMessage
  "tool" -> ToolMessage
  _ -> UserMessage

-- | How a child ended.
-- |
-- | A word this SDK has no arm for is read as *no ending at all* rather than as one of the six it
-- | does know: a program that branches on a child's ending is deciding what to do about a failure,
-- | and quietly calling an unknown ending `AgentCompleted` is the one answer that could send it on.
agentEnding :: String -> Maybe AgentEnding
agentEnding = case _ of
  "completed" -> Just AgentCompleted
  "exhausted" -> Just AgentExhausted
  "timed_out" -> Just AgentTimedOut
  "model_error" -> Just AgentModelError
  "auth_error" -> Just AgentAuthError
  "limit_exceeded" -> Just AgentLimitExceeded
  _ -> Nothing
