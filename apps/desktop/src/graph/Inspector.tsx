/**
 * What a node cannot show you.
 *
 * A canvas is good at structure and bad at prose, and this app's output is
 * prose: a rendered prompt is several hundred words and its first line tells
 * you nothing, because every prompt of a kind opens the same way. So the node
 * carries state — ran, cached, what it cost — and the text lives here, aimed at
 * whatever is selected.
 */

import { useState } from 'react';

import { Actions } from './Actions.tsx';
import { FieldEditor } from './FieldEditor.tsx';
import {
  PORT_LABEL,
  type Finding,
  type GraphNode,
  type NodeOutputs,
  type NodeSpec,
  type Signal,
} from '@dialect/core';

export interface InspectorProps {
  node?: GraphNode | undefined;
  spec?: NodeSpec | undefined;
  outputs?: NodeOutputs | undefined;
  run?: { state: string; usd?: number; error?: string } | undefined;
  /** Record an override on the selected node. Only an Edit fields node uses it. */
  onSet?: (path: string, value: unknown) => void;
}

const LEVEL_ORDER: Record<Finding['level'], number> = { block: 0, warn: 1, autofix: 2 };

/** One value, at whatever length it deserves. */
function Item({ value, index }: { value: Signal[number]; index: number }): React.ReactElement {
  if (value.type === 'prompt') {
    const { render, findings, profile, blocked } = value.prompt;
    const sorted = [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    return (
      <article className="ins-item">
        <h4>
          {profile.label}
          {blocked ? <span className="ins-blocked">blocked</span> : null}
        </h4>
        <pre className="ins-text">{render.text}</pre>
        {render.negative ? (
          <>
            <h5>Negative</h5>
            <pre className="ins-text ins-negative">{render.negative}</pre>
          </>
        ) : null}
        {sorted.length > 0 ? (
          <ul className="ins-findings">
            {sorted.map((f) => (
              <li key={`${f.ruleId}-${f.message}`} className={`finding-${f.level}`}>
                <b>{f.level}</b> {f.message}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    );
  }

  if (value.type === 'ir') {
    return (
      <article className="ins-item">
        <h4>{value.ir.title || `Document ${index + 1}`}</h4>
        <pre className="ins-text">{JSON.stringify(value.ir, null, 2)}</pre>
      </article>
    );
  }

  if (value.type === 'lines') {
    return (
      <article className="ins-item">
        <h4>
          {value.lines.id}
          <span className="ins-role">{value.lines.role}</span>
        </h4>
        <ul className="ins-lines">
          {value.lines.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </article>
    );
  }

  if (value.type === 'words') {
    return (
      <article className="ins-item">
        <p className="ins-words">{value.text}</p>
      </article>
    );
  }

  if (value.type === 'source') {
    return (
      <article className="ins-item">
        <h4>{value.source.name}</h4>
        <p className="ins-path">{value.source.path}</p>
      </article>
    );
  }

  return (
    <article className="ins-item">
      <h4>{value.template.name}</h4>
      {value.template.description ? <p>{value.template.description}</p> : null}
      <ul className="ins-lines">
        {(value.template.variables ?? []).map((v) => (
          <li key={v.name}>
            <b>{v.label ?? v.name}</b> — {v.hint ?? ''}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function Inspector({ node, spec, outputs, run, onSet }: InspectorProps): React.ReactElement {
  const ports = Object.entries(outputs ?? {});
  const [open, setOpen] = useState<string | null>(null);
  const port = ports.find(([name]) => name === open) ?? ports[0];

  if (!node || !spec) {
    return (
      <aside className="inspector">
        <p className="ins-empty">Pick a node to see what it made.</p>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <header className="ins-head">
        <b>{spec.title}</b>
        <span className="ins-id">{node.id}</span>
        {run?.usd ? <span className="ins-usd">${run.usd.toFixed(4)}</span> : null}
      </header>

      {run?.error ? <p className="ins-error">{run.error}</p> : null}

      {ports.length > 1 ? (
        <nav className="ins-ports">
          {ports.map(([name]) => (
            <button
              key={name}
              type="button"
              className={name === port?.[0] ? 'on' : ''}
              onClick={() => setOpen(name)}
            >
              {spec.outputs[name]?.label ?? name}
              <span>{PORT_LABEL[spec.outputs[name]?.type ?? 'ir']}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {!port ? (
        <p className="ins-empty">
          {run?.state === 'idle' || !run ? 'Not run yet.' : 'This node produced nothing.'}
        </p>
      ) : (
        <div className="ins-body">
          <Actions values={port[1]} />
          {/* An Edit fields node is the one place the inspector is for writing
              rather than reading, so it shows the document it produced as
              something to change. */}
          {spec.type === 'fields' && onSet && port[1][0]?.type === 'ir' ? (
            <FieldEditor
              ir={port[1][0].ir}
              set={(node.params?.set ?? {}) as Record<string, unknown>}
              onSet={onSet}
            />
          ) : null}
          {/* A wire carrying twenty things is twenty results, numbered, because
              which one is the fourth matters when you are comparing them. */}
          {port[1].length > 1 ? (
            <p className="ins-count">{port[1].length} results</p>
          ) : null}
          {port[1].map((v, i) => (
            <Item key={`${port[0]}-${i}`} value={v} index={i} />
          ))}
        </div>
      )}
    </aside>
  );
}
