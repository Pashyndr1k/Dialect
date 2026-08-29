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
| Engine rules | 5 implemented, 6 named and pending |
| Job routing | `bestFor` matching, exposed via `dialect targets --job` |
| CLI | `compile`, `targets` |
| Desktop shell | waiting on the Rust + MSVC toolchain |

## Try it

```bash
npm install
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
apps/cli          a thin surface over the same compile() the desktop app will use
```

## Engine rules

Rules encode model behaviour that is *countable*: no more than three look
words, one action per clip, at most three tracked characters. That is what
makes them enforceable in code rather than hopefully-remembered in a system
prompt.

Each rule is a file carrying its own source and date, because these are
empirical findings about specific model versions and they age. A stale rule
gets switched off, not refactored around.

| Level | Meaning |
| --- | --- |
| `autofix` | corrected silently, with a trace left in the source map |
| `warn` | compiles, but flagged with an offer to fix |
| `block` | no prompt ships, because the result would be broken |

## Next

The desktop shell is Tauri, pending the Rust toolchain and MSVC C++ build tools
being installed. Nothing above depends on that: the compiler is portable
TypeScript, and the same `compile()` will sit behind the window.

Named but not yet built, roughly in order: the remaining engine rules
(`quote-in-image-text`, `emotions-are-physical`, `skin-realism-block`,
`clip-duration-limit`, `only-visible-and-audible`, `exit-frame-means-gone`),
reference extraction, the batch queue, and the chip editor.
