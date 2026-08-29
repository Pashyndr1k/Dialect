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
| Extraction | reference image to IR, behind a provider-agnostic gateway |
| Provider gateway | content-addressed cache, budget cap, spend reporting |
| Adapters | Anthropic (`claude-opus-5`, structured outputs); a mock for tests |
| CLI | `compile`, `extract`, `targets` |
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
packages/providers  vendor adapters — the only place an SDK is imported
apps/cli            a thin surface over the same compile() the window uses
apps/desktop        the Tauri window: React in src/, the host in src-tauri/
```

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

The Anthropic adapter is written but has never run against the live API — there
were no credentials on this machine to try it with. Everything up to the network
boundary is tested; the boundary itself is not.

The window still ships Tauri's placeholder icons, and the Rust host does nothing
yet beyond hosting — the filesystem, keychain, ffmpeg and updates it is meant to
own are all unwired. The cache lives in memory only, so it does not yet survive
a restart.

Named but not yet built, roughly in order: extraction wired into the window, a
persistent cache, the batch queue, and templates.
