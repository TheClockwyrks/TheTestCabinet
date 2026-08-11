-- | Handing scoped work to child agents, and handing this session to another agent.
-- |
-- | Waiting can dominate a turn's wall clock — it blocks while real agents run — and the run's budget
-- | keeps ticking while it does. A program is therefore best shaped to spawn broadly and wait once,
-- | rather than to spawn and wait in a loop.
-- |
-- | The brief is where this arm's types earn their keep: a child is briefed either with a
-- | self-contained `Prompt` or with a board `Issue`, and because that choice is a sum type rather than
-- | two optional fields, "both" and "neither" are programs that do not compile.
module Gg.Delegation
  ( spawnSubagent
  , waitForSubagents
  , sendMessage
  , send
  , transitionState
  , exec
  , fork
  , Brief(..)
  , SubagentHandle
  , AgentEnding(..)
  , SubagentResult
  , WaitOptions
  , TransitionOptions
  , ExecOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | Which children to wait for. Optional; `{}` waits for every one still outstanding.
type WaitOptions = (ids :: Array String)

-- | What the next state's agent is told. Optional.
type TransitionOptions = (note :: String)

-- | What the agent this session becomes is told. Optional.
type ExecOptions = (prompt :: String)

-- | What a child agent is briefed with.
-- |
-- | The choice is a type rather than a pair of optional fields, so "both" and "neither" are programs
-- | that do not compile instead of calls that fail at run time.
data Brief
  -- | Self-contained instructions for a child that needs no other context.
  = Prompt String
  -- | The id of a board issue to brief the child from.
  | Issue String

derive instance Eq Brief
derive instance Generic Brief _
instance Show Brief where
  show = genericShow

-- | A child agent that was spawned and is now running in parallel.
-- |
-- | # Fields
-- |
-- | - `id` — The child's id, which is what waits for it or sends it a message.
-- | - `slot` — The agent profile it runs as.
-- | - `modelId` — The model actually bound to that agent.
type SubagentHandle =
  { id :: String
  , slot :: String
  , modelId :: String
  }

-- | How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them.
data AgentEnding
  -- | It finished normally, and its summary is what it returned.
  = AgentCompleted
  -- | It reached the per-run turn ceiling.
  | AgentExhausted
  -- | It passed its wall-clock deadline.
  | AgentTimedOut
  -- | A model turn failed.
  | AgentModelError
  -- | The run's credential was refused.
  | AgentAuthError
  -- | An execution ceiling stopped it: consecutive errors, error rate, or cost.
  | AgentLimitExceeded

derive instance Eq AgentEnding
derive instance Generic AgentEnding _
instance Show AgentEnding where
  show = genericShow

-- | One child agent's collected result.
-- |
-- | # Fields
-- |
-- | - `id` — The child's id.
-- | - `status` — How it finished; `Nothing` when it produced no return value at all.
-- | - `summary` — Its final message.
type SubagentResult =
  { id :: String
  , status :: Maybe AgentEnding
  , summary :: String
  }

-- | Delegate scoped work to a child agent, which runs in parallel while this program continues.
-- |
-- | The `agent` names the profile to run it as — one of the agents this one may spawn, which the
-- | system prompt lists — and it selects the child's model, tools and instructions. The brief is
-- | either `Gg.Delegation.Prompt "self-contained instructions"` or `Gg.Delegation.Issue "AUTH-1"`.
-- | The child shares this agent's workspace.
-- |
-- | # Operation
-- |
-- | delegation.spawn_subagent
-- |
-- | # Arguments
-- |
-- | - `agent` — The agent profile to run the child as, from the ones this agent may spawn. It selects
-- |   the child's model, tools and instructions.
-- | - `brief` — What the child is to do: `Gg.Delegation.Prompt` with self-contained instructions, or
-- |   `Gg.Delegation.Issue` with the id of a board issue to brief it from.
-- |
-- | # Returns
-- |
-- | The child's handle: the id that waits for it or sends it a message, the agent profile it runs
-- | as, and the model actually bound to that profile.
-- |
-- | # Throws
-- |
-- | `LimitExceeded` at the delegation depth cap, and `InvalidArgument` when `agent` is not one this
-- | agent may spawn.
spawnSubagent :: String -> Brief -> Effect SubagentHandle
spawnSubagent agent brief =
  Wire.call "spawn_subagent" "agents" "Gg.Delegation.spawnSubagent"
    [ case brief of
        Prompt prompt -> Wire.wire { agent, prompt }
        Issue issueId -> Wire.wire { agent, issueId }
    ]

-- | Block until the named children have finished, and collect their results in dispatch order.
-- |
-- | With `{}` it waits for every outstanding child. The run's wall-clock budget keeps running while
-- | it waits, so one wait for many children costs far less than one wait per child.
-- |
-- | # Operation
-- |
-- | delegation.wait_for_subagents
-- |
-- | # Arguments
-- |
-- | - `options` — Which children to wait for; `{}` waits for every one still outstanding.
-- | - `options.ids` — The children to wait for, as their handles named them.
-- |
-- | # Returns
-- |
-- | One result per child, in dispatch order, each carrying its final message and how it ended. A
-- | child that produced no return value at all has no `status`.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown id.
waitForSubagents
  :: forall given rest
   . Union given rest WaitOptions
  => Record given
  -> Effect (Array SubagentResult)
waitForSubagents options =
  map subagentResult
    <$> Wire.call "wait_for_subagents" "agents" "Gg.Delegation.waitForSubagents" [ Wire.pick "ids" options ]

-- | Deliver a message to a running child agent's inbox, which it reads at its next turn.
-- |
-- | # Operation
-- |
-- | delegation.send_message
-- |
-- | # Arguments
-- |
-- | - `agentId` — The child to deliver to, as its handle named it.
-- | - `message` — What to put in its inbox.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown agent id, and `Conflict` when that child has already returned.
sendMessage :: String -> String -> Effect Unit
sendMessage agentId message =
  Wire.call_ "send_message" "agents" "Gg.Delegation.sendMessage" [ Wire.wire agentId, Wire.wire message ]

-- | Deliver a message to a running child agent's inbox, which it reads at its next turn.
-- |
-- | `Gg.Delegation.sendMessage` with the id already taken out of the handle, for the common case
-- | where the child was spawned by this program or by a recent one and its handle is still in hand.
-- |
-- | # Alias
-- |
-- | delegation.send_message
-- |
-- | # Arguments
-- |
-- | - `child` — The child to deliver to, as its handle named it.
-- | - `message` — What to put in its inbox.
-- |
-- | # Throws
-- |
-- | `Conflict` when that child has already returned.
send :: SubagentHandle -> String -> Effect Unit
send child message = sendMessage child.id message

-- | Move the process this session runs inside on to another of its states.
-- |
-- | The state is named the way an agent to spawn is named. It is bound only when a state machine is
-- | driving the session and the current state has somewhere to go. Like a compaction it is registered
-- | rather than performed: the call validates the target, returns, and the program runs on to its end
-- | — the transition happens after that, because replacing the agent and its window mid-program would
-- | pull every remaining call out from under it. The first declaration in a turn is the one that
-- | stands.
-- |
-- | # Operation
-- |
-- | delegation.transition_state
-- |
-- | # Arguments
-- |
-- | - `state` — The state to move on to, named the way an agent to spawn is named.
-- | - `options` — What to tell the next state's agent; `{}` tells it nothing.
-- | - `options.note` — The opening message the next state's agent sees.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for a state this session may not move to, and `Refused` for a second
-- | declaration in one turn.
transitionState
  :: forall given rest
   . Union given rest TransitionOptions
  => String
  -> Record given
  -> Effect Unit
transitionState state options =
  Wire.call_ "transition_state" "agents" "Gg.Delegation.transitionState"
    [ Wire.wire state, Wire.pick "note" options ]

-- | Continue this session as a different agent, from the next turn.
-- |
-- | The named agent takes over with its own model, tools and instructions, keeping every capability
-- | the two of them share — and the whole conversation above all, so it needs no catching up.
-- | Registered rather than performed, exactly as a state transition is and for the same reason: the
-- | window would otherwise be pulled out from under the program still composing into it. A session
-- | makes one succession per turn. It is bound only when this agent may make agent transitions and
-- | has agents it may become, and never while a state machine is driving the session.
-- |
-- | # Operation
-- |
-- | delegation.exec
-- |
-- | # Arguments
-- |
-- | - `agent` — The agent to become, from the ones this agent may become.
-- | - `options` — What to tell it; `{}` tells it nothing.
-- | - `options.prompt` — Its opening message. It already has the whole conversation, so this is the
-- |   instruction rather than a briefing.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an agent this agent may not become, and `Refused` for a second succession
-- | in one turn.
exec
  :: forall given rest
   . Union given rest ExecOptions
  => String
  -> Record given
  -> Effect Unit
exec agent options =
  Wire.call_ "exec" "agents" "Gg.Delegation.exec" [ Wire.wire agent, Wire.pick "prompt" options ]

-- | Run a copy of this agent, in parallel, on something it will not do itself.
-- |
-- | The copy has the same model, the same tools and a private copy of the whole conversation, so the
-- | prompt is the *difference* rather than a briefing — everything already worked out is there.
-- |
-- | The copy starts once this turn's results are recorded, because the conversation it inherits has
-- | to be a complete one. A wait can therefore collect it only on a later turn, never in the
-- | program that made it.
-- |
-- | # Operation
-- |
-- | delegation.fork
-- |
-- | # Arguments
-- |
-- | - `prompt` — What the copy is to do instead. It has the whole conversation already, so this is
-- |   the difference rather than a briefing.
-- |
-- | # Returns
-- |
-- | The copy's handle, carrying the id a later wait collects it by.
-- |
-- | # Throws
-- |
-- | `LimitExceeded` at the delegation depth cap.
fork :: String -> Effect SubagentHandle
fork prompt = Wire.call "fork" "agents" "Gg.Delegation.fork" [ Wire.wire prompt ]


-- | One child agent's result. A child that produced no return value at all has no ending.
subagentResult :: Wire.Wire -> SubagentResult
subagentResult value =
  { id: Wire.text "id" value
  , status: agentEnding =<< Wire.optional "status" value
  , summary: Wire.text "summary" value
  }

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
