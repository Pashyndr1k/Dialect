import { useState } from 'react';
import {
  CAST_SIZES,
  KIND_LABEL,
  TEMPLATE_KINDS,
  templateToYaml,
  type CastSize,
  type Template,
  type TemplateKind,
} from '@dialect/core';

/**
 * Making a template out of a prompt that already works.
 *
 * The whole idea is that the person has the hard part already: a prompt they
 * trust. What they do not have is forty-nine more of it. So this asks for the
 * one they trust, works out which parts describe *that* subject and which parts
 * describe how the thing is made, and keeps the second half word for word.
 *
 * It shows the result immediately as its own example, filled in with the values
 * the example used. That is the only honest way to check the split: if the
 * preview does not read like what they pasted, the template is wrong, and they
 * can see it before they build fifty prompts on top of it.
 */

const CAST_LABEL: Record<CastSize, string> = {
  0: 'No people',
  1: 'One character',
  2: 'Two characters',
};

export function Templates({
  custom,
  learning,
  learned,
  preview,
  error,
  onLearn,
  onKeep,
  onDiscard,
  onDelete,
  onOpenFolder,
  onClose,
}: {
  custom: Template[];
  learning: boolean;
  /** What came back, waiting to be kept or thrown away. */
  learned: Template | null;
  /** The learned template rendered through its own example values. */
  preview: string | null;
  error: string | null;
  onLearn: (example: string, kind: TemplateKind, cast: CastSize, name: string) => void;
  onKeep: () => void;
  onDiscard: () => void;
  onDelete: (id: string) => void;
  onOpenFolder: () => void;
  onClose: () => void;
}) {
  const [example, setExample] = useState('');
  const [kind, setKind] = useState<TemplateKind>('text2img');
  const [cast, setCast] = useState<CastSize>(1);
  const [name, setName] = useState('');

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-box wide" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h2>Templates</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {learned ? (
          <>
            <p className="sheet-p">
              This is <strong>{learned.name}</strong>, built from your prompt. What varies is{' '}
              {learned.variables?.map((v) => (v.label ?? v.name).toLowerCase()).join(', ') ||
                'nothing yet'}{' '}
              —
              everything else is kept word for word.
            </p>

            <ul className="tpl-vars">
              {learned.variables?.map((v) => (
                <li key={v.name}>
                  <span className="tpl-v">{v.label ?? v.name}</span>
                  <span className="mono tpl-n">{`{{${v.name}}}`}</span>
                  {v.hint ? <span className="tpl-h">{v.hint}</span> : null}
                </li>
              ))}
            </ul>

            {preview ? (
              <>
                <h3>Your example, back through the template</h3>
                <p className="quiet tpl-p">
                  Filled in with the values your prompt already used. If this does not read like
                  what you pasted, the split is wrong — say so and try again.
                </p>
                <pre className="out">{preview}</pre>
              </>
            ) : null}

            <details className="tpl-raw">
              <summary>The file</summary>
              <pre className="out sub">{templateToYaml(learned)}</pre>
            </details>

            {error ? <p className="sheet-err">{error}</p> : null}

            <div className="sheet-row">
              <button className="solid" onClick={onKeep}>
                Keep it
              </button>
              <button className="ghost" onClick={onDiscard}>
                Throw it away
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sheet-p">
              Paste a prompt that already works. It gets taken apart, not improved: the parts
              describing this particular subject become boxes you fill with a few words, and the
              parts describing how the thing is made stay exactly as you wrote them.
            </p>

            <textarea
              className="tpl-ex"
              rows={9}
              spellCheck={false}
              placeholder="The prompt you already use and trust…"
              value={example}
              onChange={(e) => setExample(e.target.value)}
            />

            <div className="tpl-row">
              <label className="field">
                <span className="field-k">Makes</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
                  {TEMPLATE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-k">Cast</span>
                <select
                  value={cast}
                  onChange={(e) => setCast(Number(e.target.value) as CastSize)}
                >
                  {CAST_SIZES.map((c) => (
                    <option key={c} value={c}>
                      {CAST_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field grow">
                <span className="field-k">Called</span>
                <input
                  className="sheet-i"
                  placeholder="left blank, it names itself"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>

            {error ? <p className="sheet-err">{error}</p> : null}

            <div className="sheet-row">
              <button
                className="solid"
                disabled={example.trim().length === 0 || learning}
                onClick={() => onLearn(example, kind, cast, name)}
              >
                {learning ? 'Reading it…' : 'Make a template · about $0.04'}
              </button>
            </div>

            <h3>Yours</h3>
            {custom.length === 0 ? (
              <p className="quiet">
                None yet. The built-in ones stay whatever you make; these are added beside them.
              </p>
            ) : (
              <ul className="tpl-list">
                {custom.map((t) => (
                  <li key={t.id}>
                    <div>
                      <span className="tpl-v">{t.name}</span>
                      <span className="tpl-h">
                        {t.description ?? ''} · {t.variables?.length ?? 0} boxes · {t.modality}
                      </span>
                    </div>
                    <button
                      className="row-s-x"
                      title={`Delete ${t.name}`}
                      aria-label={`Delete ${t.name}`}
                      onClick={() => onDelete(t.id)}
                    >
                      {'×'}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="sheet-p dim">
              They are files, so a word can be fixed in any editor.{' '}
              <button className="link" onClick={onOpenFolder}>
                Open the folder
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
