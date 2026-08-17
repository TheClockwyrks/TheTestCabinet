-- | **The bridge** — the one module in this SDK that knows there is a JavaScript side at all.
-- |
-- | Nothing here is model-facing. A program never imports this module, no catalogue entry describes
-- | it, and no prompt names it; what a model reads is the typed, namespaced surface the `Gg.*`
-- | modules build on top of it. That split is the seam's rule about a hand-written SDK: the SDK
-- | bridges its own idiom onto the wire, and the model never sees the bridge.
-- |
-- | # What the far side of the bridge is
-- |
-- | Not the WIT membrane. `Gg/Internal/Wire.js` writes `import * as gg from "gg"`, which is the same
-- | line a TypeScript program writes and reaches the same SDK instance in the same guest. So every
-- | call lands in the same lowering — the same argument validation, the same `u64` conversions, the
-- | same `ToolError`. That is not a compromise: it is what makes two arms of a study produce byte
-- | identical arguments for the same capability, which is the property the whole comparison rests
-- | on.
-- |
-- | A capability this run withheld is refused by the **host**, as a `ToolError` carrying
-- | `unavailable`, exactly as it is for every other arm.
-- |
-- | # Why a dispatcher is fine *here*
-- |
-- | [`call`](#v:call) takes the namespace and the function's name as data, which is precisely the
-- | shape the seam forbids a model-facing surface from having. The rule is about what the model writes: a
-- | dispatcher a *model* calls moves the whole surface out of the type system and into a string it
-- | has to remember. Below the typed functions, where nobody reads the output and the strings are
-- | written once by hand beside the function that uses them, one bridge is one place for the
-- | crossing to be right.
module Gg.Internal.Wire
  ( Wire
  , call
  , call_
  , registerLib
  , lib
  , wire
  , taken
  , lower
  , pick
  , field
  , text
  , optional
  ) where

import Prelude

import Data.Maybe (Maybe)
import Data.Nullable (Nullable, toMaybe)
import Effect (Effect)
import Unsafe.Coerce (unsafeCoerce)

-- | A value on the JavaScript side of the bridge: an argument on its way out, or a result on its
-- | way in.
-- |
-- | Opaque on purpose. Every `Wire` is made by [`wire`](#v:wire) and read by a function that knows
-- | what shape it is, and the compiler cannot check the step in between — so keeping the type
-- | opaque keeps the number of places that step happens down to this module and the SDK modules
-- | that call it.
foreign import data Wire :: Type

-- | Call one function in one of the guest's namespaces.
-- |
-- | `tool` is the **gate** the failure is reported under when the run withheld the capability —
-- | the gg tool whose absence takes the function away, which is not always the function's own name:
-- | `Gg.Files.readTextFile` and `Gg.Views.openFile` are both spellings of a read, so both refuse
-- | under `read_file`. Where nothing a run can withhold has a tool name at all — an ending call,
-- | which a role decides, or a program-library call, which a capability buys — the call's own key
-- | stands in, since naming a tool that could not have been the reason would be worse than naming
-- | none. `namespace` is gg's own name for the family holding the function; and `written` is the
-- | fully-qualified name a PureScript program writes. The family's own name for the function is
-- | `written`'s last segment, which is the same word on both sides — so the one string carries the
-- | dispatch and the sentence a refusal is reported in, and a refusal names the call the model wrote
-- | rather than the one the bridge made.
foreign import callImpl :: String -> String -> String -> Array Wire -> Effect Wire

-- | Lower a record by converting the fields a converter is given for, and passing every other
-- | field through untouched.
-- |
-- | A PureScript record **is** a JavaScript object, so most of the time nothing has to happen at
-- | all. What does need converting is the handful of fields whose PureScript representation is not
-- | the wire's: a `Maybe` (which is a tagged object here and a `null` there) and an enumeration
-- | (which is a constructor here and a string there).
-- |
-- | Only the keys the record actually carries are walked, which is what makes an *absent* optional
-- | argument stay absent rather than becoming an explicit `null` — the difference, on a patch
-- | field, between leaving a value alone and clearing it.
foreign import lowerImpl :: Wire -> Wire -> Wire

-- | Read one property off a JavaScript value, without knowing anything about it.
foreign import fieldImpl :: String -> Wire -> Wire

-- | Take the code modules this turn was given, by the key each is bound at.
-- |
-- | Called by the entry module gg generates, before it calls the program's `main`.
foreign import registerLib :: Wire -> Effect Unit

-- | One export of one code module, or `null` when this session has no such module or that module
-- | has no such export.
foreign import libImpl :: forall a. String -> String -> Nullable a

-- | Send a PureScript value across as it stands.
wire :: forall a. a -> Wire
wire = unsafeCoerce

-- | Take a JavaScript value as the PureScript type the caller says it is.
taken :: forall a. Wire -> a
taken = unsafeCoerce

-- | Call a function that answers with something.
call :: forall a. String -> String -> String -> Array Wire -> Effect a
call tool namespace written args = taken <$> callImpl tool namespace written args

-- | Call a function whose answer is nothing worth having.
call_ :: String -> String -> String -> Array Wire -> Effect Unit
call_ tool namespace written args = void (callImpl tool namespace written args)

-- | One export of a code module, as the type the caller says it is.
lib :: forall a. String -> String -> Maybe a
lib key name = toMaybe (libImpl key name)

-- | A record of optional arguments, with the fields named in `converters` converted on the way out.
lower :: forall converters given. Record converters -> Record given -> Wire
lower converters given = lowerImpl (wire converters) (wire given)

-- | One field of an optional-argument record, as the positional argument the guest's own function
-- | takes — `undefined` when the record does not carry it, which is what "not given" is on that
-- | side.
pick :: forall given. String -> Record given -> Wire
pick name given = fieldImpl name (wire given)

-- | One field of a result, as the PureScript type the caller says it is.
field :: forall a. String -> Wire -> a
field name value = taken (fieldImpl name value)

-- | One field of a result that the wire may leave out.
optional :: forall a. String -> Wire -> Maybe a
optional name value = toMaybe (taken (fieldImpl name value) :: Nullable a)

-- | One field of a result that is text — the one type read often enough to be worth a name of its
-- | own, since every other read carries its type in the record it is building.
text :: String -> Wire -> String
text = field
