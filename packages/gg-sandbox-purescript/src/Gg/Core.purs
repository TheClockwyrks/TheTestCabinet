-- | The types every other module's signatures name, and the three functions that read a failure.
-- |
-- | A capability module owns the types it produces, so `Gg.Files.FileRead` belongs to `Gg.Files` and
-- | `Gg.Board.IssueCreated` to `Gg.Board`. The two here belong to none of them because they belong
-- | to all: every call in this SDK throws an `ApiError`, and every one of them is classified by an
-- | `ApiErrorCode`.
-- |
-- | ```
-- | import Gg.Core as Gg.Core
-- | import Gg.Docs as Gg.Docs
-- |
-- | outcome <- Gg.Core.attempt (Gg.Docs.search { query: "files" })
-- | ```
-- |
-- | A failing call **throws** rather than handing back an `Either`. That is how effectful PureScript
-- | expresses a failure that is usually fatal to the work in hand, and it keeps the happy path
-- | unwrapped: `page <- Gg.Docs.search { query: "files" }` binds a `Gg.Docs.DocSearch`. An expected
-- | failure is narrowed with `attempt`, which converts one gg failure into an `Either` and re-throws
-- | anything that is not gg's.
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
-- | An expected failure is caught with `attempt` and branched on its `code`; an unexpected one is
-- | left to escape, and gg reports which call failed and where the program had reached.
-- |
-- | # Fields
-- |
-- | - `operation` — The gg call that failed, by the key of the operation the program reached for.
-- |
-- |   `read_file`, `spawn_subagent`: the vocabulary a run's grant is expressed in rather than this
-- |   SDK's spelling of it.
-- | - `code` — The failure class, so a catch site branches on a value rather than on prose.
-- | - `message` — What went wrong, in gg's words. Worth showing in a view; not worth matching on.
type ApiError =
  { operation :: String
  , code :: ApiErrorCode
  , message :: String
  }

-- | Why a gg call failed — the `code` a catch site branches on instead of matching on prose.
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
  -- | Reserved for outcomes thrown outside a tool implementation. The one this SDK can throw itself
  -- | is a call it declares that the run's guest does not export — a mismatch between the two
  -- | artifacts rather than anything a program did, and never a capability that was withheld, which
  -- | is `Unavailable` and comes from the host.
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
