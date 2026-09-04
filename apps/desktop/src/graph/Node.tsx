/**
 * One node, on the canvas.
 *
 * Laid out in three bands, top to bottom: what it is, what it connects to, and
 * what it is set to. Nothing overlaps anything, which was not true before —
 * port labels were pinned to the node's edges and sat straight on top of the
 * fields, so a Compile node showed its model dropdown with the word "ir"
 * printed across it.
 *
 * Sockets now get their own rows: an input on the left of a row, an output on
 * the right of the same row, and the label beside each. The rows are as tall as
 * text needs, so a node with six sockets is taller rather than more crowded.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PORT_LABEL, type PortSpec } from '@dialect/core';

import { controlsFor, summaryOf, type Control, type World } from './controls.ts';
import { useBoard, type NodeFace } from './NodeData.tsx';
import { NODES } from './host.ts';
import { DeckCard, Dictated } from './Widgets.tsx';
import { FileList, ReadingList } from './RefList.tsx';

/**
 * What a widget needs. Assembled here from the board rather than carried on the
 * node, so the node object stays still and keeps its measurement.
 */
interface Face extends NodeFace {
  world: World;
  onParams: (patch: Record<string, unknown>) => void;
  onPick: (key: string, what: 'file' | 'folder') => void;
}

/**
 * One row of sockets: at most one in, at most one out.
 *
 * Pairing them by position rather than listing inputs then outputs keeps a
 * node short — most have one of each — and puts the wire where the eye already
 * expects it, level with its own name.
 */
function PortRow({
  input,
  output,
}: {
  input?: [string, PortSpec] | undefined;
  output?: [string, PortSpec] | undefined;
}): React.ReactElement {
  const title = ([name, spec]: [string, PortSpec]): string =>
    `${spec.label ?? name} — ${PORT_LABEL[spec.type]}${spec.optional ? ', optional' : ''}`;

  return (
    <div className="prow">
      {input ? (
        <>
          <Handle
            id={input[0]}
            type="target"
            position={Position.Left}
            className={`port port-${input[1].type}${input[1].optional ? ' port-optional' : ''}`}
            title={title(input)}
          />
          <span className="prow-in">{input[1].label ?? input[0]}</span>
        </>
      ) : (
        <span />
      )}

      {output ? (
        <>
          <span className="prow-out">{output[1].label ?? output[0]}</span>
          <Handle
            id={output[0]}
            type="source"
            position={Position.Right}
            className={`port port-${output[1].type}${output[1].optional ? ' port-optional' : ''}`}
            title={title(output)}
          />
        </>
      ) : (
        <span />
      )}
    </div>
  );
}

function Widget({ control, data }: { control: Control; data: Face }): React.ReactElement {
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

  if (control.kind === 'mic') return <Dictated control={control} data={data} />;
  if (control.kind === 'deck') return <DeckCard control={control} data={data} />;
  if (control.kind === 'files') return <FileList control={control} data={data} />;
  if (control.kind === 'readings') return <ReadingList control={control} data={data} />;

  return (
    <label className="node-field">
      <span>{control.label}</span>
      <button
        type="button"
        className="nodrag node-pick"
        onClick={() => data.onPick(control.key, control.kind)}
      >
        {typeof value === 'string' && value
          ? (value.split(/[\\/]/).pop() ?? value)
          : control.kind === 'file'
            ? 'Choose a file'
            : 'Choose a folder'}
      </button>
    </label>
  );
}

export function NodeBody({ id, data, selected }: NodeProps): React.ReactElement {
  const board = useBoard();
  // The type is carried on the node itself because it never changes, and
  // because the ports have to be rendered on the very first paint: React Flow
  // keeps a node hidden until it has found its handles, and a node that was
  // ever drawn without them stays hidden for good.
  const spec = NODES.get((data as { type?: string }).type ?? '');
  const face = board.faces.get(id);

  if (!spec) return <div className="node node-idle" />;

  const d: Face = {
    spec,
    params: face?.params ?? {},
    state: face?.state ?? 'idle',
    ...(face?.note ? { note: face.note } : {}),
    ...(face?.error ? { error: face.error } : {}),
    world: board.world,
    onParams: (patch) => board.setParams(id, patch),
    onPick: (key, what) => board.pick(id, key, what),
  };

  const inputs = Object.entries(d.spec.inputs);
  const outputs = Object.entries(d.spec.outputs);
  const rows = Math.max(inputs.length, outputs.length);
  const controls = controlsFor(d.spec.type);
  const summary = summaryOf(d.spec.type, d.params, d.world);

  return (
    <div className={`node node-${d.spec.group} node-${d.state}${selected ? ' node-selected' : ''}`}>
      <header className="node-head">
        <b>{d.spec.title}</b>
        {/* Amber only where money can go, so a glance at a graph shows the bill. */}
        {d.spec.spends ? <i className="node-spends" title="This node can spend" /> : null}
      </header>

      {rows > 0 ? (
        <div className="node-ports">
          {Array.from({ length: rows }, (_, i) => (
            <PortRow
              key={i}
              {...(inputs[i] ? { input: inputs[i] } : {})}
              {...(outputs[i] ? { output: outputs[i] } : {})}
            />
          ))}
        </div>
      ) : null}

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
    </div>
  );
}
