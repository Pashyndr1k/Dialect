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
