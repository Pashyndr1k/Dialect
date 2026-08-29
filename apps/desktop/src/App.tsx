import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleText,
  compile,
  extractFromImage,
  Gateway,
  getProfile,
  type Finding,
  type PromptIR,
  type Segment,
} from '@dialect/core';
import { createQueue, runQueue } from '@dialect/core';
import { Batch, type BatchItem } from './Batch.tsx';
import { Fields } from './Fields.tsx';
import { HostProvider } from './provider.ts';
import { ANTHROPIC_KEY, secretStatus } from './secrets.ts';
import { profiles, registry } from './registry.ts';
import { Settings } from './Settings.tsx';
import exampleIR from '../../../packages/core/tests/golden/cowboy-saloon.ir.json';

const LEVEL_ORDER: Record<Finding['level'], number> = { block: 0, warn: 1, autofix: 2 };

const READABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * One gateway for the window's lifetime, so its cache and its running total
 * survive between drops. Re-reading the same reference costs nothing.
 */
const gateway = new Gateway(new HostProvider(), {
  budgetUsd: 5,
  onSpend: (_usage, total) => window.dispatchEvent(new CustomEvent('dialect:spend', { detail: total })),
});

async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseIR(text: string): { ir: PromptIR } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return { error: 'The document is not an object.' };
    return { ir: parsed as PromptIR };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function App() {
  const [irText, setIrText] = useState(() => JSON.stringify(exampleIR, null, 2));
  const [target, setTarget] = useState('kling-3-omni');
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [spent, setSpent] = useState(0);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchOpen, setBatchOpen] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Files and their extracted IRs live outside React state: neither is
  // serialisable, and neither belongs in a render.
  const staged = useRef(new Map<string, File>());
  const results = useRef(new Map<string, PromptIR>());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    secretStatus(ANTHROPIC_KEY).then(
      (s) => setHasKey(s.stored),
      () => setHasKey(false),
    );
  }, [settingsOpen]);

  useEffect(() => {
    const onSpend = (e: Event): void => setSpent((e as CustomEvent<number>).detail);
    window.addEventListener('dialect:spend', onSpend);
    return () => window.removeEventListener('dialect:spend', onSpend);
  }, []);

  const readOne = async (file: File): Promise<PromptIR> => {
    const { ir: extracted } = await extractFromImage(
      gateway,
      { mediaType: file.type, base64: await toBase64(file) },
      { reference: file.name },
    );
    return extracted;
  };

  const showIR = (next: PromptIR): void => {
    setIrText(JSON.stringify(next, null, 2));
    setDisabled(new Set());
    setSelected(null);
  };

  /**
   * One reference is read straight away. Several are staged, because a dozen
   * is a spend worth seeing before it happens.
   */
  const takeFiles = async (files: File[]): Promise<void> => {
    setExtractError(null);

    const usable = files.filter((f) => READABLE.has(f.type));
    const rejected = files.length - usable.length;
    if (usable.length === 0) {
      setExtractError(
        `Nothing readable there. Drop PNG, JPEG, WebP or GIF${rejected > 0 ? ` — ${rejected} file(s) were something else` : ''}.`,
      );
      return;
    }
    if (rejected > 0) {
      setExtractError(`Skipped ${rejected} file(s) that were not images.`);
    }

    if (usable.length === 1) {
      const file = usable[0]!;
      setBatch([]);
      staged.current.clear();
      results.current.clear();

      setExtracting(file.name);
      try {
        showIR(await readOne(file));
      } catch (err) {
        setExtractError(err instanceof Error ? err.message : String(err));
      } finally {
        setExtracting(null);
      }
      return;
    }

    staged.current.clear();
    results.current.clear();
    setBatchOpen(null);

    for (const file of usable) staged.current.set(file.name, file);
    setBatch(usable.map((f) => ({ id: f.name, name: f.name, state: 'staged' as const })));
  };

  const runBatch = async (): Promise<void> => {
    setExtractError(null);
    setRunning(true);

    const controller = new AbortController();
    abort.current = controller;

    const state = createQueue(
      [...staged.current.keys()].map((name) => ({ id: name, ref: name })),
    );

    try {
      await runQueue(state, {
        concurrency: 3,
        signal: controller.signal,
        onChange: (s) => {
          setBatch(
            s.items.map((i) => ({
              id: i.id,
              name: i.id,
              state: i.state,
              ...(i.error ? { error: i.error } : {}),
            })),
          );
        },
        work: async (item) => {
          const file = staged.current.get(item.id);
          if (!file) throw new Error('that file is no longer here');
          results.current.set(item.id, await readOne(file));
          return item.id;
        },
      });

      if (state.stoppedBecause) setExtractError(state.stoppedBecause);

      // Open the first one that worked, so the run ends on something to look at.
      const first = state.items.find((i) => i.state === 'done');
      if (first) {
        const ir = results.current.get(first.id);
        if (ir) {
          showIR(ir);
          setBatchOpen(first.id);
        }
      }
    } finally {
      abort.current = null;
      setRunning(false);
    }
  };

  const openFromBatch = (id: string): void => {
    const ir = results.current.get(id);
    if (!ir) return;
    showIR(ir);
    setBatchOpen(id);
  };

  const clearBatch = (): void => {
    staged.current.clear();
    results.current.clear();
    setBatch([]);
    setBatchOpen(null);
  };

  const parsed = useMemo(() => parseIR(irText), [irText]);
  const profile = useMemo(() => getProfile(registry, target), [target]);

  const compiled = useMemo(() => {
    if ('error' in parsed) return null;
    try {
      return compile(parsed.ir, profile);
    } catch (err) {
      return { failure: (err as Error).message } as const;
    }
  }, [parsed, profile]);

  const isOn = (s: Segment): boolean => !disabled.has(s.label);

  const toggle = (label: string): void => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
    setCopied(false);
  };

  const render = compiled && !('failure' in compiled) ? compiled.render : null;
  const selectedSegment = render?.segments.find((s) => s.label === selected) ?? null;
  const promptText = render ? assembleText(render, isOn) : '';

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const findings = render && compiled && !('failure' in compiled)
    ? [...compiled.findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    : [];

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">Dialect</span>
        <label className="field">
          <span className="field-k">Target</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setDisabled(new Set());
              setSelected(null);
              setCopied(false);
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.family}
              </option>
            ))}
          </select>
        </label>
        {profile.routingNote ? <p className="note">{profile.routingNote}</p> : null}
        <button className="ghost bar-end" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </header>

      {settingsOpen ? <Settings onClose={() => setSettingsOpen(false)} /> : null}

      <main className="panes">
        <section
          className={`pane${dragging ? ' dropping' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void takeFiles([...e.dataTransfer.files]);
          }}
        >
          <div className="pane-h">
            <h2>Source</h2>
            <button className="ghost" onClick={() => setIrText(JSON.stringify(exampleIR, null, 2))}>
              Reset to example
            </button>
          </div>

          <div className={`drop${dragging ? ' over' : ''}`}>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                void takeFiles([...(e.target.files ?? [])]);
                // Cleared so choosing the same file twice fires again.
                e.target.value = '';
              }}
            />
            <input
              ref={folderInput}
              type="file"
              hidden
              // Not in the TS DOM types, but every Chromium webview has it.
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                void takeFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />

            {extracting ? (
              <p className="drop-busy">Reading {extracting}…</p>
            ) : (
              <>
                <p className="drop-t">Drop references here — one, or a folder of them</p>
                <div className="drop-b">
                  <button className="solid" onClick={() => fileInput.current?.click()}>
                    Upload reference
                  </button>
                  <button className="ghost" onClick={() => folderInput.current?.click()}>
                    Upload folder
                  </button>
                </div>
                <p className="drop-n">
                  PNG, JPEG, WebP or GIF
                  {hasKey === false ? (
                    <>
                      {' · needs a key in '}
                      <button className="link" onClick={() => setSettingsOpen(true)}>
                        Settings
                      </button>
                    </>
                  ) : null}
                </p>
              </>
            )}

            {spent > 0 ? <p className="drop-n">${spent.toFixed(4)} spent this session</p> : null}
          </div>

          {extractError ? <p className="err">{extractError}</p> : null}

          {batch.length > 0 ? (
            <Batch
              items={batch}
              selected={batchOpen}
              running={running}
              spent={spent}
              onRun={() => void runBatch()}
              onStop={() => abort.current?.abort()}
              onSelect={openFromBatch}
              onClear={clearBatch}
            />
          ) : null}
          <textarea
            className="ir"
            spellCheck={false}
            value={irText}
            onChange={(e) => setIrText(e.target.value)}
          />
          {'error' in parsed ? <p className="err">This is not valid JSON: {parsed.error}</p> : null}
        </section>

        <section className="pane">
          <div className="pane-h">
            <h2>Prompt</h2>
            <button className="ghost" onClick={() => void copy()} disabled={!promptText}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {compiled && 'failure' in compiled ? (
            <p className="err">{compiled.failure}</p>
          ) : render ? (
            <>
              <div className="chips">
                {render.segments.map((s) => (
                  <span
                    key={s.label}
                    className={`chip${isOn(s) ? '' : ' off'}${s.source === 'rule' ? ' ruled' : ''}${
                      selected === s.label ? ' sel' : ''
                    }`}
                  >
                    <button
                      className="chip-t"
                      title="Open the fields behind this block"
                      onClick={() => setSelected(selected === s.label ? null : s.label)}
                    >
                      {s.label}
                    </button>
                    <button
                      className="chip-x"
                      title={isOn(s) ? 'Leave this block out' : 'Put this block back'}
                      aria-label={isOn(s) ? `Leave ${s.label} out` : `Put ${s.label} back`}
                      onClick={() => toggle(s.label)}
                    >
                      {isOn(s) ? '\u00d7' : '+'}
                    </button>
                  </span>
                ))}
              </div>

              {selectedSegment && !('error' in parsed) ? (
                <Fields
                  ir={parsed.ir}
                  segment={selectedSegment}
                  onChange={(next) => setIrText(JSON.stringify(next, null, 2))}
                />
              ) : null}

              <pre className="out">{promptText}</pre>

              {render.negative ? (
                <div className="block">
                  <h3>Negative</h3>
                  <pre className="out sub">{render.negative}</pre>
                </div>
              ) : null}

              {Object.keys(render.params).length > 0 ? (
                <div className="block">
                  <h3>Settings</h3>
                  <dl className="params">
                    {Object.entries(render.params).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              <div className="block">
                <h3>
                  Rules
                  {findings.length > 0 ? <span className="count">{findings.length}</span> : null}
                </h3>
                {findings.length === 0 ? (
                  <p className="quiet">Nothing to flag.</p>
                ) : (
                  <ul className="findings">
                    {findings.map((f, i) => (
                      <li key={`${f.ruleId}-${i}`} className={f.level}>
                        <span className="lvl">{f.level}</span>
                        <div>
                          <p className="msg">{f.message}</p>
                          {f.fix ? <p className="fix">{f.fix}</p> : null}
                          <p className="rid">{f.ruleId}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
