/**
 * The cards themselves: what is installed, what each one says, and editing
 * the ones that are yours.
 *
 * A card is the formula for one model — which fields it wants, in which order,
 * how they are joined. It is the difference between a prompt that works and one
 * that reads fine and produces nothing. Until now the panel called "Model
 * cards" could install a set and count them and never show you one, which is
 * like a font manager that will not display a letter.
 *
 * Three layers, and the layer decides what you can do:
 *   built in — in the binary, read only. Copy it to edit it.
 *   installed — checked against a signature, so editing would break the check.
 *   yours — a file in your own folder. Edit it, or delete it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardSource, LoadedRegistry } from '@dialect/core';

import {
  BUILTIN_CARDS,
  channelCards,
  deleteMyCard,
  myCards,
  openCardsFolder,
  saveMyCard,
} from './channel.ts';

type Origin = 'built in' | 'channel' | 'yours';

interface Card {
  source: string;
  text: string;
  origin: Origin;
  /** The id the card declares, if it declares one legibly. */
  id: string;
  label: string;
}

const LAYER: Record<Origin, string> = {
  'built in': 'built in',
  channel: 'installed',
  yours: 'yours',
};

/**
 * The id and label, read off the YAML without parsing it.
 *
 * A card that will not parse still has to appear in this list — it is exactly
 * the card someone needs to open and fix — so the list cannot depend on the
 * loader having accepted it.
 */
function headOf(text: string): { id: string; label: string } {
  const line = (key: string): string =>
    text.match(new RegExp(`^${key}:\\s*['"]?([^'"\\n]+)`, 'm'))?.[1]?.trim() ?? '';
  return { id: line('id'), label: line('label') };
}

const NEW_CARD = `id: my-model
label: My model
family: field-list
syntax: prose
renderer: prose
fields:
  - key: subject
    label: Subject
    from: subject
  - key: style
    label: Style
    from: style
`;

export function CardList({
  registry,
  onChanged,
}: {
  registry: LoadedRegistry;
  onChanged: () => void;
}): React.ReactElement {
  const [cards, setCards] = useState<Card[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(async (): Promise<void> => {
    const [installed, mine] = await Promise.all([channelCards(), myCards()]);
    const of = (list: CardSource[], origin: Origin): Card[] =>
      list.map((c) => ({ ...c, origin, ...headOf(c.text) }));
    setCards([
      ...of(mine, 'yours'),
      ...of(installed, 'channel'),
      ...of(BUILTIN_CARDS, 'built in'),
    ]);
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  /** Which card each id is actually being served by, after the layers settle. */
  const winner = registry.origin;

  const shown = useMemo(
    () => cards.find((c) => `${c.origin}/${c.source}` === open),
    [cards, open],
  );

  const start = (card: Card | null, copy = false): void => {
    setError(null);
    setNote(null);
    if (!card) {
      setOpen('new');
      setDraft(NEW_CARD);
      setName('my-model.yaml');
      return;
    }
    setOpen(copy ? 'new' : `${card.origin}/${card.source}`);
    setDraft(card.text);
    setName(copy ? card.source.replace(/\.(ya?ml)$/, '') + '-mine.yaml' : card.source);
  };

  const act = async (what: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const said = await what();
      await read();
      onChanged();
      setNote(said);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (open !== null) {
    const editable = open === 'new' || shown?.origin === 'yours';
    return (
      <>
        <div className="sheet-row card-head">
          <button className="ghost" onClick={() => setOpen(null)}>
            ← All cards
          </button>
          <input
            className="sheet-i card-name"
            spellCheck={false}
            value={name}
            disabled={!editable}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="state">{editable ? 'yours' : LAYER[shown?.origin ?? 'built in']}</span>
        </div>

        {!editable ? (
          <p className="sheet-p dim">
            {shown?.origin === 'built in'
              ? 'This card came with the app. Take a copy to change it — the copy loads last and wins.'
              : 'This card came from a signed set, and editing it would break the signature. Take a copy to change it.'}
          </p>
        ) : null}

        <textarea
          className="card-text"
          spellCheck={false}
          value={draft}
          readOnly={!editable}
          onChange={(e) => setDraft(e.target.value)}
        />

        {error ? <p className="sheet-err">{error}</p> : null}
        {note && !error ? <p className="state on">{note}</p> : null}

        <div className="sheet-row">
          {editable ? (
            <button
              className="solid"
              disabled={busy || name.trim().length === 0}
              onClick={() =>
                void act(async () => {
                  const at = await saveMyCard(name.trim(), draft);
                  setOpen(`yours/${name.trim()}`);
                  return `Saved to ${at}`;
                })
              }
            >
              Save
            </button>
          ) : (
            <button className="solid" onClick={() => start(shown ?? null, true)}>
              Take a copy
            </button>
          )}
          {shown?.origin === 'yours' ? (
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await deleteMyCard(shown.source);
                  setOpen(null);
                  return null;
                })
              }
            >
              Delete
            </button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <ul className="card-rows">
        {cards.map((c) => {
          const key = `${c.origin}/${c.source}`;
          // A card whose id is served by a later layer is still installed and
          // still worth seeing — but it is not what runs, and saying so is the
          // only way the layering is ever visible.
          const beaten = c.id !== '' && winner.get(c.id) !== undefined && winner.get(c.id) !== c.origin;
          return (
            <li key={key}>
              <button className="card-row" onClick={() => start(c)}>
                <b>{c.label || c.source}</b>
                <span className="card-id">{c.id || c.source}</span>
                <span className={`card-tag tag-${c.origin.replace(' ', '-')}`}>
                  {LAYER[c.origin]}
                </span>
                {beaten ? <span className="card-tag tag-beaten">overridden</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sheet-row">
        <button className="solid" onClick={() => start(null)}>
          Write a card
        </button>
        <button className="ghost" onClick={() => void openCardsFolder()}>
          Open my cards folder
        </button>
      </div>

      <p className="sheet-p dim">
        Cards load in three layers — what the app shipped with, what a signed set installed, then
        yours. Later wins by id, so a card of your own overrides either without touching them.
      </p>
    </>
  );
}
