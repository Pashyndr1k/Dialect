import type { ModelProfile, Template } from '@dialect/core';

/**
 * What shapes the prompt.
 *
 * A model card and a learned template are the same kind of choice: both decide
 * the form the finished prompt takes, and having them in two places invited
 * picking a template for one model and a dialect for another. So there is one
 * list, and choosing from either half clears the other.
 *
 * A template carries the model it was learned from, because it came from a
 * prompt that worked on that model — so picking the template picks the dialect
 * with it, and there is nothing left to choose.
 */

const MODALITIES = ['image', 'video', 'audio'] as const;
type Modality = (typeof MODALITIES)[number];

export const MODEL_VALUE = (id: string): string => `model:${id}`;
export const TEMPLATE_VALUE = (id: string): string => `tpl:${id}`;

export function Shape({
  target,
  templateId,
  profiles,
  templates,
  onModel,
  onTemplate,
  onEdit,
}: {
  target: string;
  templateId: string;
  profiles: ModelProfile[];
  templates: Template[];
  onModel: (id: string) => void;
  onTemplate: (id: string) => void;
  onEdit: () => void;
}) {
  const chosen = templates.find((t) => t.id === templateId);
  const profile = profiles.find((p) => p.id === target);

  const byModality = <T,>(items: T[], of: (item: T) => string) =>
    MODALITIES.map((m) => [m, items.filter((i) => of(i) === m)] as const).filter(
      ([, group]) => group.length > 0,
    );

  return (
    <div className="shape">
      <select
        className="shape-s"
        value={templateId ? TEMPLATE_VALUE(templateId) : MODEL_VALUE(target)}
        title={
          chosen?.description?.trim().replace(/\s+/g, ' ') ??
          profile?.routingNote?.trim().replace(/\s+/g, ' ') ??
          ''
        }
        onChange={(e) => {
          const [kind, id] = [e.target.value.slice(0, 3), e.target.value.slice(e.target.value.indexOf(':') + 1)];
          if (kind === 'tpl') onTemplate(id);
          else onModel(id);
        }}
      >
        {/* One level of grouping: an optgroup inside an optgroup is not valid
            HTML, and a browser that flattens it loses the options with it. */}
        {byModality(profiles, (p) => p.family as Modality).map(([modality, group]) => (
          <optgroup key={`m-${modality}`} label={`Models · ${modality}`}>
            {group.map((p) => (
              <option key={p.id} value={MODEL_VALUE(p.id)}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}

        {byModality(templates, (t) => t.modality as Modality).map(([modality, group]) => (
          <optgroup key={`t-${modality}`} label={`Templates · ${modality}`}>
            {group.map((t) => (
              <option key={t.id} value={TEMPLATE_VALUE(t.id)}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <span className="shape-n">
        {chosen
          ? `${chosen.modality} · ${profile?.label ?? 'no model'}`
          : (profile?.family ?? '')}
      </span>

      <button className="ghost" onClick={onEdit}>
        Templates
      </button>
    </div>
  );
}
