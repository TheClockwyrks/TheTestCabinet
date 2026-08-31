-- | The epic and issue board: work decomposed into dispatchable units.
-- |
-- | An issue carries a scope, a non-scope and completion criteria, which are what a delegated child
-- | agent is briefed from.
-- |
-- | Two patch fields are three-way: leaving `description` out keeps it and `Nothing` clears it;
-- | leaving `epicId` out leaves the grouping alone and `Nothing` detaches the issue from its epic.
module Gg.Board
  ( createEpic
  , createIssue
  , updateIssue
  , setIssueBlockedBy
  , removeEpic
  , removeIssue
  , waitForIssue
  , waitFor
  , BoardUsage
  , EpicCreated
  , IssueCreated
  , IssueStatus(..)
  , CreateIssueOptions
  , UpdateIssueOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Nullable (toNullable)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The parts of a new issue that may be left out.
type CreateIssueOptions =
  ( description :: String
  , blockedBy :: Array String
  , epicId :: String
  , reviewers :: Array String
  )

-- | The fields an issue revision may change. Leaving one out leaves it alone.
type UpdateIssueOptions =
  ( title :: String
  , description :: Maybe String
  , inScope :: String
  , outOfScope :: String
  , completionCriteria :: String
  , status :: IssueStatus
  , epicId :: Maybe String
  )

-- | Where an issue stands.
data IssueStatus
  -- | Not started, and dispatchable once its blockers are done.
  = IssueOpen
  -- | Dispatched, with its assigned agent working on it.
  | IssueInProgress
  -- | Finished and, where this run requires reviewers, approved.
  | IssueDone

derive instance Eq IssueStatus
derive instance Generic IssueStatus _
instance Show IssueStatus where
  show = genericShow

-- | How much of the run's board budget is used, after the call that returned it.
-- |
-- | # Fields
-- |
-- | - `epics` — Epics currently on the board.
-- | - `maxEpics` — The most epics this run allows.
-- | - `issues` — Issues currently on the board.
-- | - `maxIssues` — The most issues this run allows.
type BoardUsage =
  { epics :: Int
  , maxEpics :: Int
  , issues :: Int
  , maxIssues :: Int
  }

-- | An epic that was just created: the id its prefix resolved to, and the board budget.
-- |
-- | # Fields
-- |
-- | - `id` — The epic's id: the given prefix, upper-cased, so `auth` becomes `AUTH`.
-- |
-- |   It is what groups an issue under the epic, and the stem the epic's issues are numbered from
-- |   (`AUTH-1`).
-- | - `board` — How much of the board budget is used.
type EpicCreated =
  { id :: String
  , board :: BoardUsage
  }

-- | An issue that was just created: the id the board assigned it, and the board budget.
-- |
-- | # Fields
-- |
-- | - `id` — The id the board assigned, such as `AUTH-1`.
-- |
-- |   The board chooses it rather than the caller. It is what blocks a later issue on this one, and
-- |   what waits for it.
-- | - `board` — How much of the board budget is used.
type IssueCreated =
  { id :: String
  , board :: BoardUsage
  }

-- | Create an epic to group related issues.
-- |
-- | A prefix is 3-6 letters naming the epic. It is upper-cased and becomes the epic's id, which is
-- | also what its issues are numbered from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`,
-- | and so on.
-- |
-- | # Operation
-- |
-- | board.create_epic
-- |
-- | # Arguments
-- |
-- | - `epic` — The epic to create.
-- | - `epic.prefix` — 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
-- |   issues are numbered from.
-- | - `epic.title` — A short line naming the body of work.
-- | - `epic.description` — What the epic covers, for a reader who has not seen its issues.
-- |
-- | # Returns
-- |
-- | The id the prefix resolved to, and the board budget the epic left behind.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` when the prefix is not 3-6 letters, and `Conflict` when another epic already
-- | holds it.
createEpic
  :: { prefix :: String, title :: String, description :: String } -> Effect EpicCreated
createEpic epic = Wire.call "create_epic" "board" "Gg.Board.createEpic" [ Wire.wire epic ]

-- | Create a self-contained, dispatchable issue.
-- |
-- | `inScope`, `outOfScope` and `completionCriteria` are what a child agent is briefed from.
-- |
-- | # Operation
-- |
-- | board.create_issue
-- |
-- | # Arguments
-- |
-- | - `issue` — The issue to create.
-- | - `issue.title` — A short line naming the work.
-- | - `issue.description` — What the work is, written for a child agent with no other context.
-- | - `issue.inScope` — What the issue covers, precisely. Part of the brief a child agent is given.
-- | - `issue.outOfScope` — What the issue deliberately does not cover, so the work stops where it was
-- |   meant to.
-- | - `issue.completionCriteria` — What must be true for the issue to be done. It is what a reviewer
-- |   checks the work against.
-- | - `issue.blockedBy` — The ids of every issue that must be done before this one. Defaults to none.
-- | - `issue.epicId` — The id of an existing epic to group it under. Left out, the issue stays
-- |   ungrouped and is numbered under `ISSUE`.
-- | - `issue.agent` — The agent the issue is dispatched to. It must be one this session may spawn.
-- | - `issue.reviewers` — The agents that must approve the work, from that same set. Required when
-- |   this run's reviewers feature is on.
-- |
-- | # Returns
-- |
-- | The id the board assigned, and the board budget the issue left behind. It is numbered under its
-- | epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it has no epic, and the caller does
-- | not choose it.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` when `agent` or a reviewer is not one this session may assign, and `Conflict`
-- | on a blocker edge that would close a cycle.
createIssue
  :: forall given rest
   . Union given rest CreateIssueOptions
  => { title :: String
     , inScope :: String
     , outOfScope :: String
     , completionCriteria :: String
     , agent :: String
     | given
     }
  -> Effect IssueCreated
createIssue issue = Wire.call "create_issue" "board" "Gg.Board.createIssue" [ Wire.lower {} issue ]

-- | Revise an issue, changing at least one of its fields.
-- |
-- | An omitted field is left alone, `description: Nothing` clears the description, and
-- | `epicId: Nothing` detaches the issue from its epic.
-- |
-- | # Operation
-- |
-- | board.update_issue
-- |
-- | # Arguments
-- |
-- | - `id` — The issue to revise.
-- | - `patch` — The fields to change. At least one is required; an omitted field is left alone.
-- | - `patch.title` — The title to replace the old one with.
-- | - `patch.description` — `Just` the description to replace the old one with, or `Nothing` to clear
-- |   it.
-- | - `patch.inScope` — The scope statement to replace the old one with.
-- | - `patch.outOfScope` — The non-scope statement to replace the old one with.
-- | - `patch.completionCriteria` — The completion criteria to replace the old ones with.
-- | - `patch.status` — Where the issue now stands.
-- | - `patch.epicId` — `Just` the epic to regroup it under, or `Nothing` to detach it from the one it
-- |   has.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown id.
updateIssue
  :: forall given rest
   . Union given rest UpdateIssueOptions
  => String
  -> Record given
  -> Effect Unit
updateIssue id patch =
  Wire.call_ "update_issue" "board" "Gg.Board.updateIssue"
    [ Wire.wire id
    , Wire.lower
        { description: toNullable, epicId: toNullable, status: issueStatus }
        patch
    ]

-- | Replace an issue's whole blocker set; an empty array clears every blocker.
-- |
-- | # Operation
-- |
-- | board.set_issue_blocked_by
-- |
-- | # Arguments
-- |
-- | - `id` — The issue whose blockers to replace.
-- | - `blockedBy` — The ids of every issue that must now be done before it. An empty array clears
-- |   them all.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown id, and `Conflict` when an edge would close a cycle.
setIssueBlockedBy :: String -> Array String -> Effect Unit
setIssueBlockedBy id blockedBy =
  Wire.call_ "set_issue_blocked_by" "board" "Gg.Board.setIssueBlockedBy"
    [ Wire.wire id, Wire.wire blockedBy ]

-- | Remove an epic, keeping its issues and ungrouping them.
-- |
-- | # Operation
-- |
-- | board.remove_epic
-- |
-- | # Arguments
-- |
-- | - `id` — The epic to remove.
-- |
-- | # Returns
-- |
-- | The board budget the removal left behind.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown id.
removeEpic :: String -> Effect BoardUsage
removeEpic id = Wire.call "remove_epic" "board" "Gg.Board.removeEpic" [ Wire.wire id ]

-- | Remove an issue and every blocker edge pointing at it.
-- |
-- | # Operation
-- |
-- | board.remove_issue
-- |
-- | # Arguments
-- |
-- | - `id` — The issue to remove.
-- |
-- | # Returns
-- |
-- | The board budget the removal left behind.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown id.
removeIssue :: String -> Effect BoardUsage
removeIssue id = Wire.call "remove_issue" "board" "Gg.Board.removeIssue" [ Wire.wire id ]

-- | Register a wait on an issue and hand back an acknowledgement.
-- |
-- | Nothing blocks inside the program: the wait is recorded and the call returns at once. Once the
-- | program ends the run suspends until the issue is terminal — done, or failed if its assigned
-- | agent could not complete it — and then resumes on the next turn. The issue this session was
-- | assigned to implement may not be waited on.
-- |
-- | # Operation
-- |
-- | board.wait_for_issue
-- |
-- | # Arguments
-- |
-- | - `id` — The issue to wait on. It may not be the issue this session was assigned.
-- |
-- | # Returns
-- |
-- | gg's acknowledgement that the wait is registered, which says what happens once the program
-- | ends.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown id.
waitForIssue :: String -> Effect String
waitForIssue id = Wire.call "wait_for_issue" "board" "Gg.Board.waitForIssue" [ Wire.wire id ]

-- | Register a wait on an issue that was just created.
-- |
-- | `Gg.Board.waitForIssue` with the id taken out of the record that created the issue.
-- |
-- | # Alias
-- |
-- | board.wait_for_issue
-- |
-- | # Arguments
-- |
-- | - `issue` — The issue to wait on, as `Gg.Board.createIssue` handed it back.
-- |
-- | # Returns
-- |
-- | gg's acknowledgement that the wait is registered, which says what happens once the program
-- | ends.
-- |
-- | # Throws
-- |
-- | `NotFound` when the issue has since been removed.
waitFor :: IssueCreated -> Effect String
waitFor issue = waitForIssue issue.id


-- | gg's own word for a status, which is what both execution modes report.
issueStatus :: IssueStatus -> String
issueStatus = case _ of
  IssueOpen -> "open"
  IssueInProgress -> "in_progress"
  IssueDone -> "done"
