-- | The `tasks` object: your task list, which is a DAG rather than a list of lines.
-- |
-- | One spelling in here is worth reading twice. `updateTask`'s `description` is a **three-way**
-- | edit, and a record with optional fields says all three without a sentinel: leave the field out to
-- | keep the description you have, pass `Nothing` to clear it, pass `Just` to replace it.
module Gg.Tasks
  ( tasks
  , addTask
  , updateTask
  , setBlockedBy
  , completeTask
  , removeTask
  , AddTaskOptions
  , UpdateTaskOptions
  ) where

import Prelude

import Data.Maybe (Maybe)
import Data.Nullable (toNullable)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (FunctionSummary, TaskStatus(..), TaskUsage)
import Prim.Row (class Union)

-- | The parts of a new task you may leave out.
type AddTaskOptions = (description :: String, blockedBy :: Array String)

-- | The fields a task revision may change. Leave one out to leave it alone.
type UpdateTaskOptions =
  (title :: String, description :: Maybe String, status :: TaskStatus)

-- | your task list
tasks
  :: { addTask ::
         forall given rest
          . Union given rest AddTaskOptions
         => { id :: String, title :: String | given }
         -> Effect TaskUsage
     , updateTask ::
         forall given rest
          . Union given rest UpdateTaskOptions
         => String
         -> Record given
         -> Effect Unit
     , setBlockedBy :: String -> Array String -> Effect Unit
     , completeTask :: String -> Effect Unit
     , removeTask :: String -> Effect TaskUsage
     , list :: Effect (Array FunctionSummary)
     }
tasks =
  { addTask
  , updateTask
  , setBlockedBy
  , completeTask
  , removeTask
  , list: listOn "tasks"
  }

-- | Add a task to the task DAG and hand back the task budget.
-- |
-- | `blockedBy` names the tasks that must finish before this one and defaults to none.
-- |
-- | # Arguments
-- |
-- | - `task` — The task to add.
-- | - `task.id` — The id you choose for it. It is what every other task call takes, and no two tasks
-- |   may share one.
-- | - `task.title` — A short line naming the work.
-- | - `task.description` — What the work is, at whatever length is useful.
-- | - `task.blockedBy` — The ids of the tasks that must be done before this one. Defaults to none.
-- |
-- | # Raises
-- |
-- | `Conflict` on a duplicate id or on an edge that would close a cycle.
addTask
  :: forall given rest
   . Union given rest AddTaskOptions
  => { id :: String, title :: String | given }
  -> Effect TaskUsage
addTask task = Wire.call "add_task" "tasks" "addTask" [ Wire.lower {} task ]

-- | Revise a task's title, description and/or status; supply at least one.
-- |
-- | An omitted `description` leaves it alone, `Nothing` clears it, and `Just` replaces it.
-- |
-- | # Arguments
-- |
-- | - `id` — The task to revise.
-- | - `patch` — The fields to change. Supply at least one; an omitted field is left alone.
-- | - `patch.title` — The title to replace the old one with.
-- | - `patch.description` — `Just` the description to replace the old one with, or `Nothing` to
-- |   clear it.
-- | - `patch.status` — Where the task now stands.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
updateTask
  :: forall given rest
   . Union given rest UpdateTaskOptions
  => String
  -> Record given
  -> Effect Unit
updateTask id patch =
  Wire.call_ "update_task" "tasks" "updateTask"
    [ Wire.wire id
    , Wire.lower { description: toNullable, status: taskStatus } patch
    ]

-- | Replace a task's whole blocker set; an empty array clears every blocker.
-- |
-- | # Arguments
-- |
-- | - `id` — The task whose blockers to replace.
-- | - `blockedBy` — The ids of every task that must now be done before it. An empty array clears
-- |   them all.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id, and `Conflict` when an edge would close a cycle.
setBlockedBy :: String -> Array String -> Effect Unit
setBlockedBy id blockedBy =
  Wire.call_ "set_blocked_by" "tasks" "setBlockedBy" [ Wire.wire id, Wire.wire blockedBy ]

-- | Mark a task done. Tasks it was blocking become actionable once every one of their blockers is
-- | done.
-- |
-- | # Arguments
-- |
-- | - `id` — The task to mark done.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
completeTask :: String -> Effect Unit
completeTask id = Wire.call_ "complete_task" "tasks" "completeTask" [ Wire.wire id ]

-- | Remove a task and every blocker edge pointing at it, and hand back the task budget.
-- |
-- | # Arguments
-- |
-- | - `id` — The task to remove.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
removeTask :: String -> Effect TaskUsage
removeTask id = Wire.call "remove_task" "tasks" "removeTask" [ Wire.wire id ]

-- | gg's own word for a status, which is what both execution modes report.
taskStatus :: TaskStatus -> String
taskStatus = case _ of
  TaskPending -> "pending"
  TaskInProgress -> "in_progress"
  TaskDone -> "done"
