import { useEffect, useMemo, useState } from 'react';
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

  const readReference = async (file: File): Promise<void> => {
    setExtractError(null);

    if (!READABLE.has(file.type)) {
      setExtractError(`${file.name} is a ${file.type || 'file of unknown type'}. Drop a PNG, JPEG, WebP or GIF.`);
      return;
    }

    setExtracting(file.name);
    try {
      const { ir: extracted, cached } = await extractFromImage(
        gateway,
        { mediaType: file.type, base64: await toBase64(file) },
        { reference: file.name },
      );
      setIrText(JSON.stringify(extracted, null, 2));
      setDisabled(new Set());
      if (cached) setExtractError(null);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(null);
    }
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
            const file = e.dataTransfer.files[0];
            if (file) void readReference(file);
          }}
        >
          <div className="pane-h">
            <h2>Source</h2>
            <button className="ghost" onClick={() => setIrText(JSON.stringify(exampleIR, null, 2))}>
              Reset to example
            </button>
          </div>

          <div className="drop">
            {extracting ? (
              <span className="busy">Reading {extracting}…</span>
            ) : hasKey === false ? (
              <span>
                Drop a reference image to read it into IR — once a key is saved in{' '}
                <button className="link" onClick={() => setSettingsOpen(true)}>
                  Settings
                </button>
                .
              </span>
            ) : (
              <span>Drop a reference image here to read it into IR.</span>
            )}
            {spent > 0 ? <span className="spend">${spent.toFixed(4)} this session</span> : null}
          </div>

          {extractError ? <p className="err">{extractError}</p> : null}
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
