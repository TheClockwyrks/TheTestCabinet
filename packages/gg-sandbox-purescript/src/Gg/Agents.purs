-- | The `agents` object: handing scoped work to child agents.
-- |
-- | `waitForSubagents` can dominate a turn's wall clock — it blocks while real agents run — and the
-- | run's budget keeps ticking while it does. A program should therefore spawn broadly and wait once,
-- | not spawn-and-wait in a loop.
-- |
-- | The brief is where this arm's types earn their keep: a child is briefed either with a
-- | self-contained `Prompt` or with a board `Issue`, and because that choice is a `data` type rather
-- | than two optional fields, "both" and "neither" are programs that do not compile.
module Gg.Agents
  ( agents
  , spawnSubagent
  , waitForSubagents
  , sendMessage
  , transitionState
  , exec
  , fork
  , WaitOptions
  , TransitionOptions
  , ExecOptions
  ) where

import Prelude

import Effect (Effect)
import Gg.Internal.Read (subagentResult)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (Brief(..), FunctionSummary, SubagentHandle, SubagentResult)
import Prim.Row (class Union)

-- | Which children to wait for. Optional; `{}` waits for every one still outstanding.
type WaitOptions = (ids :: Array String)

-- | What the next state's agent is told. Optional.
type TransitionOptions = (note :: String)

-- | What the agent you become is told. Optional.
type ExecOptions = (prompt :: String)

-- | delegate work to child agents
agents
  :: { spawnSubagent :: String -> Brief -> Effect SubagentHandle
     , waitForSubagents ::
         forall given rest
          . Union given rest WaitOptions
         => Record given
         -> Effect (Array SubagentResult)
     , sendMessage :: String -> String -> Effect Unit
     , transitionState ::
         forall given rest
          . Union given rest TransitionOptions
         => String
         -> Record given
         -> Effect Unit
     , exec ::
         forall given rest
          . Union given rest ExecOptions
         => String
         -> Record given
         -> Effect Unit
     , fork :: String -> Effect SubagentHandle
     , list :: Effect (Array FunctionSummary)
     }
agents =
  { spawnSubagent
  , waitForSubagents
  , sendMessage
  , transitionState
  , exec
  , fork
  , list: listOn "agents"
  }

-- | Delegate scoped work to a child agent and hand back its handle immediately — the child runs in
-- | parallel while your program continues.
-- |
-- | Name the `agent` to run it as (one of the agents you may spawn — the system prompt lists them; it
-- | selects the child's model, tools, and instructions) and brief it with either
-- | `Prompt "self-contained instructions"` or `Issue "AUTH-1"`. The child shares your workspace.
-- |
-- | # Arguments
-- |
-- | - `agent` — The agent profile to run the child as, from the ones you may spawn. It selects the
-- |   child's model, tools and instructions.
-- | - `brief` — What the child is to do: `Prompt` with self-contained instructions, or `Issue` with
-- |   the id of a board issue to brief it from.
-- |
-- | # Raises
-- |
-- | `LimitExceeded` at the delegation depth cap, and `InvalidArgument` if `agent` is not one you may
-- | spawn.
spawnSubagent :: String -> Brief -> Effect SubagentHandle
spawnSubagent agent brief =
  Wire.call "spawn_subagent" "agents" "spawnSubagent"
    [ case brief of
        Prompt prompt -> Wire.wire { agent, prompt }
        Issue issueId -> Wire.wire { agent, issueId }
    ]

-- | Block until the named children have finished — or, with `{}`, until every outstanding child has
-- | — and collect their results in dispatch order.
-- |
-- | The run's wall-clock budget keeps running while you wait, so wait once for many children rather
-- | than once per child.
-- |
-- | # Arguments
-- |
-- | - `options` — Which children to wait for; pass `{}` to wait for every one still outstanding.
-- | - `options.ids` — The children to wait for, as `agents.spawnSubagent` returned them.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
waitForSubagents
  :: forall given rest
   . Union given rest WaitOptions
  => Record given
  -> Effect (Array SubagentResult)
waitForSubagents options =
  map subagentResult
    <$> Wire.call "wait_for_subagents" "agents" "waitForSubagents" [ Wire.pick "ids" options ]

-- | Deliver a message to a running child agent's inbox; it reads the message at its next turn.
-- |
-- | # Arguments
-- |
-- | - `agentId` — The child to deliver to, as `agents.spawnSubagent` returned it.
-- | - `message` — What to put in its inbox. It reads it at its next turn.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown agent id, and `Conflict` when that child has already returned.
sendMessage :: String -> String -> Effect Unit
sendMessage agentId message =
  Wire.call_ "send_message" "agents" "sendMessage" [ Wire.wire agentId, Wire.wire message ]

-- | Move the process you are running inside on to another of its states, naming the state the way you
-- | name an agent to spawn.
-- |
-- | Bound only when a state machine is driving you and the state you are in has somewhere to go. Like
-- | `context.compact` it is registered rather than performed: the call validates the target, returns,
-- | and your program runs on to its end — the transition happens after that, because replacing your
-- | agent (and your window) mid-program would pull every remaining call out from under it. The FIRST
-- | declaration stands.
-- |
-- | # Arguments
-- |
-- | - `state` — The state to move on to, named the way you name an agent to spawn.
-- | - `options` — What to tell the next state's agent; pass `{}` to tell it nothing.
-- | - `options.note` — The opening message the next state's agent sees.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` for a state you may not move to, and `Refused` for a second declaration in one
-- | turn.
transitionState
  :: forall given rest
   . Union given rest TransitionOptions
  => String
  -> Record given
  -> Effect Unit
transitionState state options =
  Wire.call_ "transition_state" "agents" "transitionState"
    [ Wire.wire state, Wire.pick "note" options ]

-- | Continue this session as a different agent: the named agent takes over from your next turn with
-- | its own model, tools and instructions, keeping every capability the two of you both have — your
-- | whole conversation above all, so it needs no catching up.
-- |
-- | Registered rather than performed, exactly as `agents.transitionState` is and for the same reason:
-- | your window would otherwise be pulled out from under the program still composing into it. A
-- | session makes one succession per turn. Bound only when your agent may make agent transitions and
-- | has agents it may become, and never while a state machine is driving you.
-- |
-- | # Arguments
-- |
-- | - `agent` — The agent to become, from the ones you may become.
-- | - `options` — What to tell it; pass `{}` to tell it nothing.
-- | - `options.prompt` — Its opening message. It already has your whole conversation, so this is the
-- |   instruction rather than a briefing.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` for an agent you may not become, and `Refused` for a second succession in one
-- | turn.
exec
  :: forall given rest
   . Union given rest ExecOptions
  => String
  -> Record given
  -> Effect Unit
exec agent options =
  Wire.call_ "exec" "agents" "exec" [ Wire.wire agent, Wire.pick "prompt" options ]

-- | Run a copy of yourself, in parallel, on something you will not do yourself.
-- |
-- | The copy has your model, your tools and a private copy of your whole conversation, so `prompt` is
-- | the *difference* rather than a briefing — everything you have worked out is already there.
-- |
-- | Its handle comes back immediately, but the copy itself starts once this turn's tool results are
-- | recorded (the conversation it inherits has to be a complete one), so `agents.waitForSubagents` can
-- | only collect it on a later turn — do not wait on it in the program that made it.
-- |
-- | # Arguments
-- |
-- | - `prompt` — What the copy is to do instead of what you are doing. It has your whole conversation
-- |   already, so write the difference rather than a briefing.
-- |
-- | # Raises
-- |
-- | `LimitExceeded` at the delegation depth cap.
fork :: String -> Effect SubagentHandle
fork prompt = Wire.call "fork" "agents" "fork" [ Wire.wire prompt ]
