/**
 * One node, on the canvas.
 *
 * Two things a node must say without being clicked: what it is set to, and what
 * happened to it last run. Everything else — the prompt it made, the findings
 * against it — goes to the inspector, because a node is two inches wide and a
 * prompt is several hundred words.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PORT_LABEL, type NodeSpec, type PortSpec } from '@dialect/core';

import { controlsFor, summaryOf, type Control, type World } from './controls.ts';

export type NodeState = 'idle' | 'running' | 'done' | 'cached' | 'failed';

export interface BodyData extends Record<string, unknown> {
  spec: NodeSpec;
  params: Record<string, unknown>;
  world: World;
  state: NodeState;
  /** What this node produced last run, in a few words. */
  note?: string;
  error?: string;
  /**
   * Set params. A patch rather than one key, because choosing a kept reading
   * sets what it is called, what kind it is, and its lines all at once.
   * The editor owns the document; this only reports.
   */
  onParams: (patch: Record<string, unknown>) => void;
  onPick: (key: string, what: 'file' | 'folder') => void;
}

/** Ports are laid out evenly down the side, so a wire always has somewhere to land. */
const at = (index: number, total: number): string => `${((index + 1) / (total + 1)) * 100}%`;

function Port({
  name,
  spec,
  side,
  index,
  total,
}: {
  name: string;
  spec: PortSpec;
  side: 'in' | 'out';
  index: number;
  total: number;
}): React.ReactElement {
  const label = spec.label ?? name;
  return (
    <>
      <Handle
        id={name}
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        style={{ top: at(index, total) }}
        // The port's type is its colour and its title, so a refused connection
        // is explainable before it is attempted.
        className={`port port-${spec.type}${spec.optional ? ' port-optional' : ''}`}
        title={`${label} — ${PORT_LABEL[spec.type]}${spec.optional ? ', optional' : ''}`}
      />
      <span className={`port-label port-label-${side}`} style={{ top: at(index, total) }}>
        {label}
      </span>
    </>
  );
}

function Widget({
  control,
  data,
}: {
  control: Control;
  data: BodyData;
}): React.ReactElement {
  const value = data.params[control.key];

  if (control.kind === 'text') {
    return (
      <label className="node-field">
        <span>{control.label}</span>
        <textarea
          rows={control.rows ?? 3}
          value={typeof value === 'string' ? value : ''}
          placeholder={control.placeholder}
          onChange={(e) => data.onParams({ [control.key]: e.target.value })}
          // Otherwise a drag inside the box pans the canvas instead of
          // selecting text.
          className="nodrag"
        />
      </label>
    );
  }

  if (control.kind === 'number') {
    return (
      <label className="node-field">
        <span>{control.label}</span>
        <input
          type="number"
          className="nodrag"
          min={control.min}
          max={control.max}
          value={typeof value === 'number' ? value : control.min}
          onChange={(e) => data.onParams({ [control.key]: Number(e.target.value) })}
        />
      </label>
    );
  }

  if (control.kind === 'select') {
    const options = control.options(data.world);
    const groups = [...new Set(options.map((o) => o.group).filter(Boolean))] as string[];
    return (
      <label className="node-field">
        <span>{control.label}</span>
        <select
          className="nodrag"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) =>
            data.onParams(
              control.apply
                ? control.apply(e.target.value, data.world)
                : { [control.key]: e.target.value },
            )
          }
        >
          <option value="">—</option>
          {groups.length > 0
            ? groups.map((g) => (
                <optgroup key={g} label={g}>
                  {options
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ))
            : options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
        </select>
      </label>
    );
  }

  return (
    <label className="node-field">
      <span>{control.label}</span>
      <button type="button" className="nodrag node-pick" onClick={() => data.onPick(control.key, control.kind)}>
        {typeof value === 'string' && value
          ? (value.split(/[\\/]/).pop() ?? value)
          : control.kind === 'file'
            ? 'Choose a file'
            : 'Choose a folder'}
      </button>
    </label>
  );
}

export function NodeBody({ data, selected }: NodeProps): React.ReactElement {
  const d = data as BodyData;
  const inputs = Object.entries(d.spec.inputs);
  const outputs = Object.entries(d.spec.outputs);
  const controls = controlsFor(d.spec.type);
  const summary = summaryOf(d.spec.type, d.params, d.world);

  return (
    <div
      className={`node node-${d.spec.group} node-${d.state}${selected ? ' node-selected' : ''}`}
    >
      {inputs.map(([name, spec], i) => (
        <Port key={name} name={name} spec={spec} side="in" index={i} total={inputs.length} />
      ))}

      <header className="node-head">
        <b>{d.spec.title}</b>
        {/* Amber only where money can go, so a glance at a graph shows the bill. */}
        {d.spec.spends ? <i className="node-spends" title="This node can spend" /> : null}
      </header>

      {summary ? <p className="node-summary">{summary}</p> : null}

      {controls.length > 0 ? (
        <div className="node-fields">
          {controls.map((c) => (
            <Widget key={c.key} control={c} data={d} />
          ))}
        </div>
      ) : null}

      {d.state === 'failed' && d.error ? <p className="node-error">{d.error}</p> : null}
      {d.state !== 'failed' && d.note ? <p className="node-note">{d.note}</p> : null}

      {outputs.map(([name, spec], i) => (
        <Port key={name} name={name} spec={spec} side="out" index={i} total={outputs.length} />
      ))}
    </div>
  );
}
