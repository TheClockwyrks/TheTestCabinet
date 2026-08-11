-- | The types every other module's signatures name, and the three functions that read a failure.
-- |
-- | A capability module owns the types it produces, so `Gg.Files.FileRead` belongs to `Gg.Files` and
-- | `Gg.Board.IssueCreated` to `Gg.Board`. The two here belong to none of them because they belong
-- | to all: every call in this SDK throws a `ToolError`, and every one of them is classified by a
-- | `ToolErrorCode`.
-- |
-- | ```
-- | import Gg.Core as Gg.Core
-- | import Gg.Files as Gg.Files
-- |
-- | outcome <- Gg.Core.attempt (Gg.Files.readTextFile "notes.md" {})
-- | ```
-- |
-- | A failing call **throws** rather than handing back an `Either`. That is how effectful PureScript
-- | expresses a failure that is usually fatal to the work in hand, and it keeps the happy path
-- | unwrapped: `read <- Gg.Files.readTextFile "main.purs" {}` binds a `String`. An expected failure is
-- | narrowed with `attempt`, which converts one gg failure into an `Either` and re-throws anything
-- | that is not gg's.
module Gg.Core
  ( ToolError
  , ToolErrorCode(..)
  , attempt
  , toolError
  , toolErrorCode
  , lib
  ) where

import Prelude

import Data.Either (Either(..))
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe, maybe)
import Data.Nullable (Nullable, toMaybe)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Effect.Exception (Error, throwException, try)

-- | A gg call that failed, thrown by every function in this SDK.
-- |
-- | An expected failure is caught with `attempt` and branched on its `code`; an unexpected one is
-- | left to escape, and gg reports which call failed and where the program had reached.
-- |
-- | # Fields
-- |
-- | - `tool` — The gg call that failed, under gg's own name for it.
-- |
-- |   `read_file`, `spawn_subagent`: the vocabulary a run's enabled set is expressed in rather than
-- |   this SDK's spelling of it.
-- | - `code` — The failure class, so a catch site branches on a value rather than on prose.
-- | - `message` — What went wrong, in gg's words. Worth showing in a view; not worth matching on.
type ToolError =
  { tool :: String
  , code :: ToolErrorCode
  , message :: String
  }

-- | Why a gg call failed — the `code` a catch site branches on instead of matching on prose.
data ToolErrorCode
  -- | The arguments were malformed, ill-typed, or out of range.
  -- |
  -- | It covers a path that is absolute or climbs out of the workspace, and an agent name this run
  -- | does not declare.
  = InvalidArgument
  -- | The named thing does not exist.
  -- |
  -- | A file, a skill, a memory, a task, an epic, an issue, a subagent, a stored program, or a
  -- | documentation entry.
  | NotFound
  -- | Well-formed, and in conflict with the current state.
  -- |
  -- | An ambiguous edit, a dependency cycle, a duplicate id, a subagent that has already returned.
  | Conflict
  -- | gg refused the call on a rule about the session's state.
  -- |
  -- | A compaction in flight that this call is not the one it asked for, a memory call while
  -- | memories are read-only, a second ending or hand-over in a turn that already declared one, or a
  -- | hook that blocked it. A ceiling that was reached is `LimitExceeded` rather than this.
  | Refused
  -- | The call exists and this run's capability set does not offer it.
  -- |
  -- | Every name in this SDK is in scope whatever a run enables, because the library is compiled once
  -- | and a run's capability set is decided per run — so a withheld call arrives as this rather than
  -- | as a compile error.
  | Unavailable
  -- | A gg-side ceiling was reached.
  -- |
  -- | A shell timeout, a store cap, the delegation depth cap, or the run's wall-clock budget.
  | LimitExceeded
  -- | The underlying input, output or process failed.
  | IoError
  -- | The failure was not classified.
  -- |
  -- | Reserved for outcomes raised outside a tool implementation. The one this SDK can raise itself
  -- | is a call it declares that the run's guest does not export — a mismatch between the two
  -- | artifacts rather than anything a program did, and never a capability that was withheld, which
  -- | is `Unavailable` and comes from the host.
  | OtherFailure

derive instance Eq ToolErrorCode
derive instance Generic ToolErrorCode _
instance Show ToolErrorCode where
  show = genericShow

-- | The failure fields, dug out of whatever was thrown — `null` for anything that is not a gg
-- | failure.
foreign import toolErrorImpl
  :: Error -> Nullable { tool :: String, code :: String, message :: String }

-- | One export of one code module, or `null` when this session has no such module or that module has
-- | no such export.
foreign import libImpl :: forall a. String -> String -> Nullable a

-- | Run a gg call and hand back its failure instead of throwing it.
-- |
-- | Anything that is not a gg failure is re-thrown: `attempt` narrows, it does not swallow.
attempt :: forall a. Effect a -> Effect (Either ToolError a)
attempt action = do
  outcome <- try action
  case outcome of
    Right value -> pure (Right value)
    Left failure -> maybe (throwException failure) (pure <<< Left) (toolError failure)

-- | The gg failure inside an `Error` caught by `Effect.Exception.try`, or `Nothing` for anything
-- | else.
toolError :: Error -> Maybe ToolError
toolError failure = decode <$> toMaybe (toolErrorImpl failure)
  where
  decode raw =
    { tool: raw.tool
    , code: toolErrorCode raw.code
    , message: raw.message
    }

-- | The arm a wire code names.
-- |
-- | An unrecognised one is `OtherFailure`, which is what that arm is for: the set is gg's and is
-- | closed, and a program reading a code it has no arm for is better served by the unclassified arm
-- | than by a crash.
toolErrorCode :: String -> ToolErrorCode
toolErrorCode = case _ of
  "invalid-argument" -> InvalidArgument
  "not-found" -> NotFound
  "conflict" -> Conflict
  "refused" -> Refused
  "unavailable" -> Unavailable
  "limit-exceeded" -> LimitExceeded
  "io-error" -> IoError
  _ -> OtherFailure

-- | One export of a code module bound at `lib.<key>`, as the type the caller says it is.
-- |
-- | A skill or a memory may carry a PureScript module as well as prose. Reading it binds that
-- | module's exports under a key for the rest of the session, and the reply that answered the read
-- | names the key and what it exports.
-- |
-- | This is the one place in the SDK where the caller states the expected type, because nothing else
-- | can: a code module is compiled separately, so there is no `import` for `purs` to check it
-- | against.
-- |
-- | ```
-- | case Gg.Core.lib "helpers" "slugify" of
-- |   Just slugify -> Gg.Views.openText "slug" (slugify "Some Title" :: String)
-- |   Nothing -> Gg.Views.openText "slug" "the helpers module has no slugify"
-- | ```
lib :: forall a. String -> String -> Maybe a
lib key name = toMaybe (libImpl key name)
