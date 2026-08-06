-- | **How a gg call fails**, and how a PureScript program handles it.
-- |
-- | Every function in this SDK is an `Effect`, and a failing one **throws** rather than handing back
-- | an `Either`. That is the way effectful PureScript expresses a failure that is usually fatal to
-- | what you were doing, and it is deliberate here: a surface where every call returned
-- | `Effect (Either ToolError a)` would force a branch after every line, and a program that reads
-- | three files and writes one would be a staircase of `case` expressions instead of a `do` block.
-- |
-- | So the happy path is already unwrapped — `read <- fs.readTextFile "main.purs" {}` binds a
-- | `String` — and a failure you *expect* is caught with [`attempt`](#v:attempt).
module Gg.Error
  ( ToolError
  , ToolErrorCode(..)
  , attempt
  , toolError
  , toolErrorCode
  ) where

import Prelude

import Data.Either (Either(..))
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.Nullable (Nullable, toMaybe)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Effect.Exception (Error, throwException, try)

-- | A gg call that failed.
-- |
-- | Thrown by every function in this SDK. Catch it with `attempt` when a failure is expected and
-- | branch on its `code`; let it escape when it is not, and gg reports which call failed and where
-- | your program was.
-- |
-- | ```
-- | outcome <- attempt (fs.readTextFile "notes.md" {})
-- | case outcome of
-- |   Left failure | failure.code == NotFound -> void (fs.writeFile "notes.md" "")
-- |   Left failure -> throwException (error failure.message)
-- |   Right notes -> view.openText "notes" notes
-- | ```
-- |
-- | `attempt` is what turns a throwing call into an `Either`; anything that is not a gg failure —
-- | a `Partial` crash in your own code, a division you guarded wrongly — is re-thrown by it rather
-- | than caught, because it is not something a `code` can be branched on. `toolError` is the same
-- | narrowing applied to an `Error` you already caught with `Effect.Exception.try`.
-- |
-- | # Fields
-- |
-- | - `tool` — The gg call that failed, under gg's own name for it (`read_file`,
-- |   `spawn_subagent`).
-- | - `code` — The failure class, so a catch site branches on a value rather than on prose.
-- | - `message` — What went wrong, in gg's words. Worth showing yourself; not worth matching on.
type ToolError =
  { tool :: String
  , code :: ToolErrorCode
  , message :: String
  }

-- | Why a gg call failed — the `code` on a `ToolError`, and the value a catch site branches on
-- | instead of matching on prose.
data ToolErrorCode
  -- | The arguments were malformed, ill-typed, or out of range — including a path that is absolute
  -- | or climbs out of the workspace, and an agent name this run does not declare.
  = InvalidArgument
  -- | The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation
  -- | entry does not exist.
  | NotFound
  -- | Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
  -- | duplicate id, a subagent that already returned.
  | Conflict
  -- | gg refused the call on a rule about your state: a compaction in flight that this call is not
  -- | the one it asked for, a memory call while your memories are read-only, a second ending or
  -- | hand-over in a turn that already declared one, or a hook that blocked it. A ceiling you ran
  -- | into is `LimitExceeded`, not this.
  | Refused
  -- | The call exists but this run's capability set does not offer it.
  | Unavailable
  -- | A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the
  -- | view caps this program spends, or the run's wall-clock budget.
  | LimitExceeded
  -- | The underlying I/O or process failed.
  | IoError
  -- | The failure was not classified. Reserved for outcomes raised outside a tool implementation;
  -- | nothing you call produces it.
  | OtherFailure

derive instance Eq ToolErrorCode
derive instance Generic ToolErrorCode _
instance Show ToolErrorCode where
  show = genericShow

-- | The failure fields, dug out of whatever was thrown — `null` for anything that is not a gg
-- | failure.
foreign import toolErrorImpl
  :: Error -> Nullable { tool :: String, code :: String, message :: String }

-- | Run a gg call and hand back its failure instead of throwing it.
-- |
-- | Anything that is not a gg failure is re-thrown: `attempt` narrows, it does not swallow.
attempt :: forall a. Effect a -> Effect (Either ToolError a)
attempt action = do
  outcome <- try action
  case outcome of
    Right value -> pure (Right value)
    Left failure -> case toolError failure of
      Just tool -> pure (Left tool)
      Nothing -> throwException failure

-- | The gg failure inside an `Error` you caught yourself, or `Nothing` when it is something else.
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
-- | closed, and a program reading a code it has no arm for is better off with the unclassified one
-- | than with a crash.
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
