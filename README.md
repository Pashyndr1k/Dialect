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

## Status

Phase 0–1 spine, running and tested. No GUI yet.

| Piece | State |
| --- | --- |
| Prompt IR schema | image / video / audio, one versioned shape |
| Model registry | YAML cards: 2 video, 2 image |
| Renderers | `field-list`, `shot-description`, `natural` |
| Generate mode | all four targets |
| Edit mode | `natural` targets — names the delta, pins the rest |
| Engine rules | 11 implemented, each with its own file, source and tests |
| Job routing | `bestFor` matching, exposed via `dialect targets --job` |
| CLI | `compile`, `targets` |
| Desktop shell | Tauri 2 window, compiling live with a chip editor |

## Try it

The window:

```bash
npm install && npm run tauri dev --prefix apps/desktop
```

Or the same compiler from a terminal:

```bash
node apps/cli/src/main.ts targets
node apps/cli/src/main.ts compile packages/core/tests/golden/cowboy-saloon.ir.json --target kling-3-omni
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
packages/core     the compiler — no filesystem, no network, no platform APIs
  src/ir          the Prompt IR: the contract every other part speaks
  src/registry    model profiles as data, plus the loader and the job router
  src/renderers   one renderer per dialect *form*, not per model
  src/rules       engine rules, one file each, with source and date
apps/cli          a thin surface over the same compile() the window uses
apps/desktop      the Tauri window: React in src/, the host in src-tauri/
```

## The window

Two panes. The left holds the IR as JSON; the right holds the prompt it
compiles to, live. Between them sit the chips: one per segment of the prompt,
each switchable off, each rebuilt through the dialect's own joining rules
rather than the editor's guess at them.

Findings appear underneath, sorted with anything blocking first, each naming
the rule that raised it and what to do about it.

Switching the target recompiles from the same IR without touching a model. It
is the clearest demonstration of why the compiler is shaped this way.

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

The window still ships Tauri's placeholder icons, and the Rust host does
nothing yet beyond hosting — the filesystem, keychain, ffmpeg and updates it is
meant to own are all unwired.

Named but not yet built, roughly in order: reference extraction (the first
thing that needs an API key), the provider gateway with its cache and budget
cap, the batch queue, and templates.
