-- | The types every other module's signatures name, and the three functions that read a failure.
-- |
-- | Every call in this SDK throws an `ApiError`, classified by an `ApiErrorCode`, rather than handing
-- | back an `Either`, so the happy path binds the value itself. `attempt` runs one call and converts
-- | a gg failure into an `Either`, re-throwing anything that is not gg's.
module Gg.Core
  ( ApiError
  , ApiErrorCode(..)
  , attempt
  , apiError
  , apiErrorCode
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
-- | A failure that is not caught ends the turn, and gg reports which call failed and where the
-- | program had reached.
-- |
-- | # Fields
-- |
-- | - `operation` — The gg call that failed, by the key of the operation the program reached for:
-- |   `read_file`, `spawn_subagent`.
-- | - `code` — The failure class.
-- | - `message` — What went wrong, in gg's words.
type ApiError =
  { operation :: String
  , code :: ApiErrorCode
  , message :: String
  }

-- | Why a gg call failed.
data ApiErrorCode
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
  -- | Every name in this SDK is in scope whatever a run enables, so a withheld call arrives as this
  -- | rather than as a compile error.
  | Unavailable
  -- | A gg-side ceiling was reached.
  -- |
  -- | A shell timeout, a store cap, the delegation depth cap, or the run's wall-clock budget.
  | LimitExceeded
  -- | The underlying input, output or process failed.
  | IoError
  -- | The failure was not classified.
  -- |
  -- | Reserved for outcomes thrown outside a tool implementation. A capability that was withheld is
  -- | `Unavailable` instead.
  | OtherFailure

derive instance Eq ApiErrorCode
derive instance Generic ApiErrorCode _
instance Show ApiErrorCode where
  show = genericShow

-- | The failure fields, dug out of whatever was thrown — `null` for anything that is not a gg
-- | failure.
foreign import apiErrorImpl
  :: Error -> Nullable { operation :: String, code :: String, message :: String }

-- | Run a gg call and hand back its failure instead of throwing it.
-- |
-- | Anything that is not a gg failure is re-thrown: `attempt` narrows, it does not swallow.
attempt :: forall a. Effect a -> Effect (Either ApiError a)
attempt action = do
  outcome <- try action
  case outcome of
    Right value -> pure (Right value)
    Left failure -> maybe (throwException failure) (pure <<< Left) (apiError failure)

-- | The gg failure inside an `Error` caught by `Effect.Exception.try`, or `Nothing` for anything
-- | else.
apiError :: Error -> Maybe ApiError
apiError failure = decode <$> toMaybe (apiErrorImpl failure)
  where
  decode raw =
    { operation: raw.operation
    , code: apiErrorCode raw.code
    , message: raw.message
    }

-- | The arm a wire code names.
-- |
-- | An unrecognised one is `OtherFailure`, which is what that arm is for: the set is gg's and is
-- | closed, and a program reading a code it has no arm for is better served by the unclassified arm
-- | than by a crash.
apiErrorCode :: String -> ApiErrorCode
apiErrorCode = case _ of
  "invalid-argument" -> InvalidArgument
  "not-found" -> NotFound
  "conflict" -> Conflict
  "refused" -> Refused
  "unavailable" -> Unavailable
  "limit-exceeded" -> LimitExceeded
  "io-error" -> IoError
  _ -> OtherFailure
