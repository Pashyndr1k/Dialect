# Dialect

Compiles an idea or a reference into a prompt written in one generative model's
own dialect.

Not a wrapper around a chat model. The design is a **compiler**: everything is
parsed into a model-independent **Prompt IR**, and each target model has a
renderer that turns that IR into its own syntax. Extraction is expensive and
happens once; composition is deterministic and happens as often as you like.

Three consequences follow, and they are the reason for the architecture:

- **Retargeting is free.** One parse of a reference produces prompts for any
  number of models without calling a model again.
- **Batches are predictable.** 500 files means 500 extraction calls and *zero*
  composition calls.
- **Edits happen by meaning.** You change the lighting or the shot size, not a
  string you hope the model reads the way you meant.

## Version

Two numbers, `major.minor`, shown beside the name in the window. The workspace
root's `package.json` holds it; Cargo and Tauri get the same number with a `.0`
on the end, and a test keeps the three from drifting apart.

The minor number moves when a stage of the plan lands. It reaches 1.0 when the
plan's phases are done — the current number is not modesty, it is the count.

## Status

Phase 0–1 spine, running and tested. No GUI yet.

| Piece | State |
| --- | --- |
| Prompt IR schema | image / video / audio, one versioned shape |
| Model registry | YAML cards: 5 video, 2 image, 3 audio |
| Renderers | `field-list` (formula-driven), `shot-description`, `natural` |
| Generate mode | all four targets |
| Edit mode | `natural` targets — names the delta, pins the rest |
| Engine rules | 11 implemented, each with its own file, source and tests |
| Templates | partial IR with variables, snippets and inheritance |
| Batch | resumable queue, persistent cache, budget across restarts |
| Survives a restart | answers already paid for, and what was on screen |
| Job routing | `bestFor` matching, exposed via `dialect targets --job` |
| Extraction | image, and video via frames, behind a provider-agnostic gateway |
| Provider gateway | content-addressed cache, budget cap, spend reporting |
| Adapters | Anthropic (`claude-opus-5`, structured outputs); a mock for tests |
| Key storage | OS credential store via the Rust host, with a settings panel |
| CLI | `compile`, `extract`, `batch`, `apply`, `targets`, `templates` |
| Desktop shell | Tauri 2 window, compiling live with a chip editor |

## Try it

On Windows, double-click **Dialect.bat**. The first run compiles the app, which
takes a few minutes; every run after that starts instantly from the built exe.
`Dialect.bat rebuild` forces a rebuild after code changes.

**Dialect (dev).bat** runs it against the Vite dev server instead, so interface
edits appear without a restart.

From a terminal, on any platform:

```bash
npm install && npm run tauri dev --prefix apps/desktop
```

Or the same compiler from a terminal:

```bash
node apps/cli/src/main.ts targets
node apps/cli/src/main.ts compile packages/core/tests/golden/cowboy-saloon.ir.json --target kling-3-omni
```

Turn a reference image into a prompt. This is the one path that costs money, so
it takes a budget cap and reports what it spent:

```bash
node apps/cli/src/main.ts extract ref.jpg --target nano-banana-2 --budget 0.50 --ir-out ref.ir.json
```

Same IR, a different dialect, no re-extraction:

```bash
node apps/cli/src/main.ts compile packages/core/tests/golden/cowboy-saloon.ir.json --target seedance-2.5 --prompt-only
```

## Tests

```bash
npm test --workspaces
```

The load-bearing one is the golden test. `cowboy-saloon.ir.json` compiles to
`cowboy-saloon.kling.txt` byte for byte — a prompt written by hand, before any
of this existed. If that ever stops holding, batch runs are no longer
reproducible and every saved template has silently drifted.

## Layout

```
packages/core       the compiler — no filesystem, no network, no vendor SDK
  src/ir            the Prompt IR: the contract every other part speaks
  src/registry      model profiles as data, plus the loader and the job router
  src/renderers     one renderer per dialect *form*, not per model
  src/rules         engine rules, one file each, with source and date
  src/providers     the provider boundary: interface, gateway, cache, budget
  src/extract       reference to IR, using whichever provider it is handed
packages/providers  the Anthropic SDK adapter, used by the CLI
apps/cli            a thin surface over the same compile() the window uses
apps/desktop        the Tauri window: React in src/, the host in src-tauri/
  src/provider.ts   the same Provider contract, satisfied by the Rust host
  src-tauri/        secrets.rs owns the credential store, anthropic.rs proxies
                    the one call that needs it
```

## Sequences

Four shots of one man in one room fail for a reason that has nothing to do with
any single prompt: shot three quietly describes a different man. So the world —
who, where, what it looks like — is stated once, and a shot holds only what
makes it different. Kept once it cannot drift; kept four times it will.

Expansion copies the world verbatim into each shot and hands the result to the
ordinary compiler. There is no second code path, which is the only way the
prompt for shot three can be trusted to be as good as a prompt written alone.

A shot that continues from the previous frame is compiled differently, and less:
the picture fixes the room and the light better than a sentence can, so
restating them can only disagree with it, and a disagreement at the seam is
exactly where the join becomes visible. Identity stays — the model has to track
a person through motion, not merely render them once. A field someone changed on
purpose stays too: a light going out is the one thing the frame cannot show,
because it is what happens next.

The joins get their own checks, none of which block: a character described two
ways, a shot that changes place without cutting there, two shots at the same
size from the same angle, a camera that never stops doing the same thing. They
read what the prompts actually say rather than what the shots store, so a move
inherited from the world is counted like one that was typed.

## The bundle

What you want and what you brought are sources in one bundle, and the prompt is
what they add up to.

Their jobs are not fixed. Someone can describe a character and attach a
photograph for its light; someone else can attach a photograph of a character
and type the light. The same two things, opposite ways round — so the job
belongs to each source rather than to its kind, and each attachment carries one:
subject, style, detail, setting, framing, or auto.

A style source contributes how a thing looks and nothing about what is in it. A
style reference of a snowy street puts no snow in the picture; it lends the
grade, the light and the grain of that photograph. Getting that wrong is the
most common way a reference ruins a prompt, so the composer is told it in those
words.

It happens in two passes, and that is the point.

Reading a reference is expensive and answers a question that never changes:
what is in this picture. Putting that reading together with what was typed is
cheap, needs no pictures at all, and answers a question that changes every time
a word does. So a reference is read once and the reading is kept — rewriting the
sentence beside a photograph costs a text call rather than another look at the
photograph, and the button's price falls after the first press to say so.

The second pass is also the only place a job can be given. A single call shown a
picture and a sentence can be told to weigh them; it cannot be told that this
picture is here for its light and nothing else.

Nothing is averaged. Two sources disagreeing inside one job are not split down
the middle — that makes a third thing which is neither. The one whose job owns
the field wins, and where two share a job the earlier leads.

One reference, nothing typed, no template: the reading already is the answer,
and composing would only pay to restate it.

## Keeping a source

The plan called for two things — entity cards, so a character survives from one
prompt to the next, and a style DNA, so a look does. The bundle made them the
same object: a cast member and a look are both a named source with a job, and
the only difference is which job.

What makes that worth building rather than merely tidy is the two-pass split. A
reading is bought once and is text afterwards, so a character read out of one
photograph can appear in fifty prompts without the photograph being looked at
again. Keeping the lines keeps the whole of what was paid for, and attaching a
kept source costs nothing — the button's price says so.

They are files, like the templates, because a description is exactly the kind of
thing someone wants to open and fix a word in.

## Twenty at once

Variation is composition, not extraction — it carries no pictures — so twenty
versions of a character cost about what one reading of a photograph does. And a
variant is a difference rather than a document: everything off the axis is
already decided, so the answer is a handful of fields, not two hundred words
again.

The third reason is not about cost. Twenty separate calls produce twenty similar
answers, because nothing tells any of them what the others said. One call
producing twenty is the only version of this that actually varies, and the
instruction spends most of its words on that: spread them, do not build a
gradient, a slightly darker version of the last is not a version.

An axis names what may move — who it is, how it looks, how it feels, the
framing, the moment — and everything else is held. The document says what it
currently is on that axis, so nothing offers it back.

A deck can push a run sideways: one card drawn from it becomes a constraint all
the variants must satisfy, structurally rather than as a detail at the edge. The
decks are data like everything else, and the four that ship carry a hundred and
fifteen cards between them.

## What shapes it

A model card and a template of your own are the same kind of choice — both
decide the form the finished prompt takes — so they share one slot under the
input, and taking one puts the other down. Two lists rather than one, switched
between: mixing them made the half you were not using scroll past every time.
Each is grouped by what it makes.

A learned template records the model it came from, because it came from a prompt
that worked on that model. Picking the template picks the dialect with it, and
there is nothing left to choose. Where a template names none, whatever is
already selected stays if it makes the right kind of thing, and otherwise it
lands on the model that kind would have opened on.

## Writing from an idea

The opposite job to reading a reference, and it needs the opposite instruction.
Reading says: describe what is there, and where the picture does not tell you,
say so. Writing says: decide. Someone who types "a cowboy in a saloon" is asking
for the two hundred words they did not want to write, and a description hedged
with "perhaps a coat, or a jacket" is not a description — something downstream
picks one anyway, and worse.

What does not change is the discipline. Everything invented still has to be
something a camera could record, a shot still gets one action, optics are still
a visible effect rather than a lens number. The rules engine holds the result to
the same standard as a document read off a photograph.

With a template chosen the job narrows and improves: instead of inventing a
whole document, the model answers that template's questions, and the template
decides the rest. The hints in the template are already written as instructions
— "One action. A second one belongs in the next shot." — so they are handed
over as the schema's field descriptions. The model never sees the template's IR:
a template is a decision about the look, and letting a model rewrite it would
defeat the point of choosing one.

## Reading a clip

A vision model cannot watch anything, so a clip becomes a handful of stills
taken in order across its length. What no single frame shows — that the camera
is pushing in, that a hand is rising — is inferred from how the frames differ,
which is why they go in one question as an ordered set rather than as separate
pictures.

The host does that work: a web view cannot run a program, and a clip is far too
large to hand across as base64 just to have it handed back. So a clip is chosen
rather than dropped, and only its path travels.

Duration and aspect ratio come from the container rather than the model —
asking it to guess something already measured only invites a wrong answer that
then has to be corrected.

ffmpeg is found on PATH rather than bundled. Shipping a copy is a release
concern; the button says what it needs and stays disabled without it.

## Reading a track

A model cannot listen, and unlike a clip there is no frame to show it. So the
job splits by what each side is good at.

What can be measured is measured and handed over as fact: length, loudness,
tempo, key. Tempo comes from the onset envelope — loudness over time,
differenced so only rises count — autocorrelated between 60 and 200 BPM, with
the peak interpolated because a whole frame is worth several BPM up there. Key
comes from twelve pitch classes summed across five octaves, read with Goertzel
rather than a full spectrum since those sixty frequencies are the only ones that
matter, then correlated against the Krumhansl–Schmuckler profiles.

Both carry how sure they are, and that is the point of measuring at all.
Ambient with no pulse still produces a number; stated as fact it would mislead,
so below a threshold nothing is said. A prompt claiming 140 BPM about a 90 BPM
track is worse than one that never mentions tempo.

What is left is judgement — genre, instruments, mood, where the sections change
— and that goes to the model with a picture of the sound: a spectrogram and a
waveform. Those genuinely show density, brightness, dynamics and structure. They
do not show what a saxophone is, and the prompt says so, with somewhere for the
model to record what it could not tell. Everything named will be generated, so a
short honest list beats a long invented one.

Lyrics are not transcribed. That needs a speech model, and nothing here has one.

## Cards that arrive after the build

Model cards are dated. The formula a model wants this month is not the one it
wanted last, and the card is the only thing between that change and a wrong
prompt — so the set has to be replaceable without a new binary.

Which makes it a supply chain, and the design says so out loud. A card decides
what every prompt says: its field list *is* the formula, its defaults are what
goes in unasked. Anyone who can drop a file in that folder can rewrite what this
app produces without touching a line of its code.

So a set installs only if it carries an Ed25519 signature from a key trusted
beforehand, and every file in it hashes to what the signed manifest says. The
signature covers the manifest bytes exactly as fetched, never a
re-serialisation: a manifest that round-trips differently would verify something
nobody signed. Verification happens in the host rather than the window, for the
plain reason that the window is the thing being replaced.

Nothing is ever half-installed. A set is fetched whole, verified whole, staged,
and only then swapped in — a broken update leaves the working one exactly where
it was, which is the only reason any of this is worth doing. An older version
does not replace a newer one unless someone insists, which is how you get off a
set that turned out wrong.

`dialect keygen` makes a publisher key and prints the half to trust; `dialect
sign` writes the manifest and its signature beside the cards. A folder is as
good as a URL — that is how a set reaches a machine that is not online, and how
one is tried before it is published.

The two halves are written in different languages, so a fixture signed by the
command line is checked against the host's verifier in the test suite. A
disagreement about what Ed25519 over those bytes means would otherwise turn up
on someone's machine when an update refuses to install.

## Cards you write yourself

Three layers: what the build shipped, what a signed set brought, what you wrote.
Later wins by id, so a hand-written card overrides either — which is what the
cards being data was always for.

Loading stopped being all-or-nothing at the same time. A set of eleven cards
where one is malformed gives ten cards and a complaint, and the card underneath
the broken one still stands. A card naming a renderer this build has never heard
of is refused at load rather than at render — finding that out when someone
presses the button, having already paid to read a reference, is finding out too
late.

## The key

Extraction needs an Anthropic key. It is typed into the app's own settings panel
and handed straight to the operating system's credential store — Windows
Credential Manager, the macOS Keychain, the Secret Service on Linux. Nothing is
written to a config file, and nothing lands in shell history.

**The key never enters the web view.** The host reads it from the credential
store and makes the model call itself; the window sends a request and gets an
answer back. There is no command to fetch the value — `secret_get` is host-side
Rust, deliberately not exposed — so this is a property of the build rather than
a promise about how the UI behaves.

That is also why the window and the CLI use different providers behind the same
`Provider` interface: the window hands the request to Rust, the CLI uses the
Anthropic SDK with `ANTHROPIC_API_KEY`. Same schema, same prompt, same gateway,
same cache and budget — only the holder of the credential differs.

Running the Vite dev server in a plain browser, there is no host and so no
credential store. The panel says so and falls back to localStorage in the clear
rather than pretending otherwise. The command line still reads
`ANTHROPIC_API_KEY`, which is the normal thing for a CLI to do.

## A folder at a time

```bash
node apps/cli/src/main.ts batch ./refs --target nano-banana-2 --out ./prompts --budget 5
```

A prompt and an IR per reference, plus the run's state and cache inside the
output folder. Point at the same folder again and it resumes: what was already
read costs nothing, and the budget counts what earlier runs spent rather than
starting over.

Three things make a run of a thousand survivable, and all three are in core
rather than in whichever surface is driving it:

- **It resumes.** State is plain data written after every change, so a crash
  loses at most one reference. An item left mid-flight is queued again.
- **It retries only what might improve.** A rate limit is worth another attempt;
  a file that is not an image is not.
- **Running out of budget stops the run**, rather than burning through the
  remainder failing one at a time. The items that never ran stay queued.

## What survives closing the window

Two things, for two different reasons, and both kept by the host because a web
view cannot keep either for itself.

**The cache** holds answers that were paid for, keyed by the hash of the image
and the question. Read a reference once and reading it again is free — after a
restart as much as before one.

A cache entry is a hash and a blob, though: no name, no picture, nothing anyone
could pick out of a list. So beside it sits **the library** — what each entry
was called, when it was read, and a thumbnail small enough to keep. References
read on earlier days appear under the session's own list, and choosing one
brings its prompt back without paying again. Without that index the cache only
paid off by accident, when you happened to drop the same file twice.

**The session** holds what was on screen: which references were read and what
came back. The files themselves cannot be kept — a dropped file is gone once
the page reloads — so this is a record rather than a resumable job. Drop the
same folder again and the cache makes it free.

Everything is written aside and renamed, so a crash leaves the old copy or none,
never half of one. Cache keys are checked against the shape the gateway
produces, which is also the shape a path traversal would have to arrive in.

## Spending money

Extraction is the only step that costs anything, so it is the only step behind
a gateway. Everything about it is arranged so a batch of a thousand files
cannot surprise you:

- **The cache is content-addressed.** The key covers the image bytes, the
  question, the schema version and the model. Re-run the same folder and
  nothing is spent; change the prompt and everything is re-read, deliberately.
- **The budget cap is checked before the call**, never after — a run stops at
  the ceiling rather than discovering it.
- **A cached answer is re-validated** against the current schema before it is
  trusted, so an answer written by an older build cannot slip through.
- **Core imports no vendor SDK.** It describes what it needs; an adapter
  satisfies it. That is what lets every test run against a mock — no key, no
  bill, and no dependence on what a model felt like saying that day.

## The window

Two panes, and which side a thing belongs on is not a matter of taste.

**Left is what you gave it**: the references, a preview of the one being worked
on, how each is getting on, what reading them costs, and what the cache already
holds.

**Right is what it made**: the document extracted from a reference, the prompt
that compiles from it, the blocks that prompt is made of, the fields behind
them, and what the rules had to say.

The IR sits on the right for the same reason the prompt does — it is a result,
not something anyone typed. Putting it on the left had split one thing across
both panes, with its raw form on one side and the fields that edit it on the
other.

Pick any reference to see it, read or not. Its prompt appears if there is one,
and the header stays quiet if there is not, rather than labelling the example
with someone else's file name.

Between the panes sit the chips: one per segment of the prompt.

Each chip does two things. Its label opens the IR fields that segment was built
from — a segment records the paths it came from, so the editor can offer those
fields rather than asking anyone to edit a finished prompt as text. The × beside
it leaves the block out, rebuilt through the dialect's own joining rules rather
than the editor's guess at them.

Editing a field rewrites the IR, so every target recompiles, not just the one on
screen. Where a field came from a reference, the panel says which one.

The reference list is always on screen and keeps everything the session has
seen. Anything dropped joins it at the top: one reference is read straight away,
several are staged and wait for a decision, because a dozen is a spend worth
seeing before it happens. Dropping the same file twice says so rather than
reading it again.

Pick any row to see that reference and, if it has been read, its prompt. Reset
empties the session and puts the example document back.

A finished batch is worked with three ways: open any row into the editor, copy
one row's prompt from the row itself, or save the lot to a folder you pick. The
IR is written beside each prompt, so an edit can be picked up later without
paying to read the reference again.

What the session has cost, and what the cache is holding, sit on one line under
the drop zone — next to each other, because they are the same subject. Forgetting
the cache is the only thing that makes a reference cost money twice, so it says
so.

Findings appear underneath, sorted with anything blocking first, each naming
the rule that raised it and what to do about it.

Switching the target recompiles from the same IR without touching a model. It
is the clearest demonstration of why the compiler is shaped this way.

## Templates

A template is a partially filled IR with holes in it, not a prompt. That is what
lets one template serve every target: it produces an IR, and the dialects take
it from there.

```bash
node apps/cli/src/main.ts templates
node apps/cli/src/main.ts apply dialogue-shot --target kling-3-omni --set subject=... --set line=...
```

The same filled template compiles to Kling's nine labelled fields and to
Seedance's prose, and the spoken line survives both — it lands in a sentence for
Seedance and stays in the IR for Kling, whose formula has no slot for it.

Layers merge in one order: the inheritance chain from the furthest ancestor
down, then snippets, then the template's own fields, then whatever document was
already in hand. Each layer can override the one before, so the person editing
always wins over the template that produced it.

Arrays replace rather than blend — three look words means those three, not those
three plus whatever was inherited. Appending is opt-in and visible: a key
ending in `+` adds to the list below it, which is how `standard-negatives` can
extend an avoid list a template already started.

Snippets carry the handbook's reusable blocks: the film-look line, the standard
negatives, the skin-realism block, clean audio.

## Dialects are cards, not code

A `field-list` dialect is described entirely by its profile. Kling's nine-field
formula is nine entries in a YAML file, each naming the IR paths that feed it
and how the parts are joined:

```yaml
  - name: Camera
    from: [shot.framing, shot.angle, "@cameraMove", "@lens"]

  - name: Atmosphere
    from: [mood.atmosphere, mood.emotion, mood.energy]
    fallback: neutral
```

Reorder the fields, change what feeds one, add a field the renderer has never
heard of — the output follows, and no code is touched. The tests in
`formula.test.ts` are exactly that: edit the card, compile, check.

Deliberately a list of paths and a separator rather than a template language.
The moment it grows conditionals and loops it stops being editable by anyone
who is not a programmer, which was the point of moving it out of code. The one
concession is a short, fixed vocabulary of computed phrases written with a
leading `@`, for lines that are word order rather than a field — "slow push-in"
is two IR values and an order that only makes sense together.

## Engine rules

Rules encode model behaviour that is *countable*: no more than three look
words, one action per clip, at most three tracked characters. That is what
makes them enforceable in code rather than hopefully-remembered in a system
prompt.

Each rule is a file carrying its own source and date, because these are
empirical findings about specific model versions and they age. A stale rule
gets switched off, not refactored around.

Heuristic rules read prose, so each one is tested twice: that it fires, and
that it stays quiet on writing it must not touch. A rule that cries wolf is
worse than a missing one — it teaches people to ignore the panel.

| Level | Meaning |
| --- | --- |
| `autofix` | corrected silently, with a trace left in the source map |
| `warn` | compiles, but flagged with an offer to fix |
| `block` | no prompt ships, because the result would be broken |

## Next

The host path has run against the live API: a stored key, a real reference, and
a scene back that matched the schema. The CLI path — the Anthropic SDK with an
environment variable — still has not, though it shares everything above the
transport.

`live_extraction` in `src-tauri/src/anthropic.rs` is the test that proved it. It
is `#[ignore]`d, because it is the only test that costs money:

```bash
cargo test --lib -- --ignored --nocapture live_extraction
```

Its fixtures are not in the repository — the schema is generated from the Zod
one, and the reference is whatever image you point it at — so it says what it
needs rather than failing on a path.

The window still ships Tauri's placeholder icons, and the Rust host does nothing
yet beyond hosting — the filesystem, keychain, ffmpeg and updates it is meant to
own are all unwired. The cache lives in memory only, so it does not yet survive
a restart.

Named but not yet built, roughly in order: extraction wired into the window, a
persistent cache, the batch queue, and templates.
