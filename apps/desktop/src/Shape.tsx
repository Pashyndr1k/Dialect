import type { ModelProfile, Template } from '@dialect/core';

/**
 * What shapes the prompt: a model's own dialect, or a template of your own.
 *
 * Two lists rather than one, because they are two different decisions that
 * happen to occupy the same slot — and a single list mixing them made the one
 * you were not using scroll past every time. The switch says which is in force,
 * and only one can be: a template already decides the dialect it renders in.
 */

const MODALITIES = ['image', 'video', 'audio'] as const;
type Modality = (typeof MODALITIES)[number];

export type ShapeMode = 'prebuilt' | 'custom';

const byModality = <T,>(items: T[], of: (item: T) => string) =>
  MODALITIES.map((m) => [m, items.filter((i) => of(i) === m)] as const).filter(
    ([, group]) => group.length > 0,
  );

export function Shape({
  mode,
  target,
  templateId,
  profiles,
  templates,
  onMode,
  onModel,
  onTemplate,
  onEdit,
}: {
  mode: ShapeMode;
  target: string;
  templateId: string;
  profiles: ModelProfile[];
  templates: Template[];
  onMode: (next: ShapeMode) => void;
  onModel: (id: string) => void;
  onTemplate: (id: string) => void;
  onEdit: () => void;
}) {
  const chosen = templates.find((t) => t.id === templateId);
  const profile = profiles.find((p) => p.id === target);

  return (
    <div className="shape">
      {mode === 'prebuilt' ? (
        <select
          className="shape-s"
          value={target}
          title={profile?.routingNote?.trim().replace(/\s+/g, ' ') ?? ''}
          onChange={(e) => onModel(e.target.value)}
        >
          {/* One level of grouping: an optgroup inside an optgroup is not valid
              HTML, and a browser that flattens it loses the options with it. */}
          {byModality(profiles, (p) => p.family as Modality).map(([modality, group]) => (
            <optgroup key={modality} label={modality}>
              {group.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <select
          className="shape-s"
          value={templateId}
          title={chosen?.description?.trim().replace(/\s+/g, ' ') ?? ''}
          onChange={(e) => onTemplate(e.target.value)}
        >
          <option value="">None</option>
          {byModality(templates, (t) => t.modality as Modality).map(([modality, group]) => (
            <optgroup key={modality} label={modality}>
              {group.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      <div className="seg" role="group" aria-label="What shapes the prompt">
        {(['prebuilt', 'custom'] as const).map((m) => (
          <button
            key={m}
            className={`seg-b${mode === m ? ' on' : ''}`}
            aria-pressed={mode === m}
            onClick={() => onMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      <span className="shape-n">
        {chosen ? (profile?.label ?? 'no model') : (profile?.family ?? '')}
      </span>

      <button className="ghost" onClick={onEdit}>
        Templates
      </button>
    </div>
  );
}
