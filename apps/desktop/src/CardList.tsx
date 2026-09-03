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
 * A card is added by giving the model's own prompting guide, which is the
 * document that actually describes it. Writing one by hand is still there, one
 * button along, for the times when there is no guide or it is wrong.
 *
 * Three layers, and the layer decides what you can do:
 *   built in — in the binary, read only. Copy it to edit it.
 *   installed — replaced whole by the next install, so an edit would be lost.
 *   yours — a file in your own folder. Edit it, or delete it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { profileToYaml, type CardSource, type LoadedRegistry } from '@dialect/core';

import { proposeCard, type CardProposal } from './learnCard.ts';

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
/** The file name a copy of `source` takes. */
const copyName = (source: string): string => `${source.replace(/\.(ya?ml)$/, '')}-mine.yaml`;

function headOf(text: string): { id: string; label: string } {
  const line = (key: string): string =>
    text.match(new RegExp(`^${key}:\\s*['"]?([^'"\\n]+)`, 'm'))?.[1]?.trim() ?? '';
  return { id: line('id'), label: line('label') };
}

/**
 * The blank card.
 *
 * It said `family: field-list`, `syntax: prose`, `renderer: prose` and gave its
 * fields a `key`/`label`/`from` shape the loader has never accepted — three
 * invalid values and a wrong field shape, in the one file that exists to show
 * someone what a card looks like. Corrected, and cut back to what is actually
 * required, with the optional half named rather than demonstrated wrongly.
 */
const NEW_CARD = `id: my-model
label: My model
vendor: someone
family: image        # image, video, audio or pipeline
syntax: natural      # natural, field-list, shot-description, comma-phrases, tag-list, graph
renderer: natural    # this build has: natural, field-list, shot-description
header: My model prompt

routingNote: One sentence on when to reach for this rather than another model.

supports:
  negativePrompt: false
  emitsGearNumbers: false

# A field-list model also needs a \`fields:\` list — each entry a name and the
# IR paths that feed it. Reading a guide writes that for you.
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
  const [guideUrl, setGuideUrl] = useState('');
  /** The address of a newer guide, on the screen showing one card. */
  const [freshUrl, setFreshUrl] = useState('');
  const [reading, setReading] = useState(false);
  /** What the guide reader made of it, shown beside the card it proposed. */
  const [report, setReport] = useState<CardProposal | null>(null);

  const reload = useCallback(async (): Promise<void> => {
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
    void reload();
  }, [reload]);

  /** Which card each id is actually being served by, after the layers settle. */
  const winner = registry.origin;

  const shown = useMemo(
    () => cards.find((c) => `${c.origin}/${c.source}` === open),
    [cards, open],
  );

  const start = (card: Card | null, copy = false): void => {
    setError(null);
    setNote(null);
    setReport(null);
    if (!card) {
      setOpen('new');
      setDraft(NEW_CARD);
      setName('my-model.yaml');
      return;
    }
    setFreshUrl('');
    setOpen(copy ? 'new' : `${card.origin}/${card.source}`);
    setDraft(card.text);
    setName(copy ? copyName(card.source) : card.source);
  };

  const act = async (what: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const said = await what();
      await reload();
      onChanged();
      setNote(said);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Read the guide at the pasted address and open what came back for editing.
   *
   * Straight into the editor, unsaved, because that is what it is: a proposal.
   * The report beside it says which model wrote it, how sure it was, and what
   * it had to leave out — all of which is worth reading before this becomes the
   * formula behind every prompt for that model.
   */
  const readGuide = async (): Promise<void> => {
    setReading(true);
    setError(null);
    setNote(null);
    setReport(null);
    try {
      const proposal = await proposeCard(guideUrl.trim());
      setReport(proposal);
      setDraft(profileToYaml(proposal.profile));
      setName(`${proposal.profile.id}.yaml`);
      setOpen('new');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  /**
   * Read a newer guide and rewrite the card open on screen.
   *
   * The same call as writing a new one, with one difference that matters: the
   * id of the card being replaced is kept. A newer guide often writes the name
   * differently, and a card whose id has quietly changed saves cleanly, reads
   * correctly, and is referenced by nothing — leaving every graph pointing at a
   * model that no longer exists.
   *
   * A built-in or installed card cannot be written to, so updating one produces
   * a copy of your own. It loads last, so it wins, which is what makes this an
   * update rather than a second model.
   */
  const updateFromGuide = async (): Promise<void> => {
    const keepId = shown?.id || headOf(draft).id;
    setReading(true);
    setError(null);
    setNote(null);
    setReport(null);
    try {
      const proposal = await proposeCard(
        freshUrl.trim(),
        keepId ? { keepId } : {},
      );
      setReport(proposal);
      setDraft(profileToYaml(proposal.profile));
      if (shown && shown.origin !== 'yours') {
        setName(copyName(shown.source));
        setOpen('new');
      }
      setFreshUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
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
              : 'This card came from an installed set, and the next install replaces the whole set. Take a copy so your change survives it.'}
          </p>
        ) : null}

        {/*
          A card is a description of something that changes underneath it. The
          guide is republished, the model gains a field, a limit doubles — and
          the card goes on producing prompts written for last year's model,
          quietly, because nothing about a stale card looks stale.
        */}
        <div className="sheet-row card-update">
          <input
            className="sheet-i"
            spellCheck={false}
            placeholder="https://… a newer prompting guide for this model"
            value={freshUrl}
            disabled={reading}
            onChange={(e) => setFreshUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && freshUrl.trim() && !reading) void updateFromGuide();
            }}
          />
          <button
            className="ghost"
            disabled={reading || freshUrl.trim().length === 0}
            onClick={() => void updateFromGuide()}
          >
            {reading ? 'Reading…' : 'Update from this guide'}
          </button>
        </div>
        <p className="sheet-p dim card-update-note">
          Keeps the id, so the graphs pointing at this model go on pointing at it.
          {shown && shown.origin !== 'yours'
            ? ' This one cannot be written to, so the update becomes a card of your own — which loads last and wins.'
            : ''}
        </p>

        {/*
          What the guide reader had to say about its own answer, above the card
          rather than below it. A card is a formula that will be behind every
          prompt for this model, and "the model was unsure about the duration
          limit" is worth knowing before you save it, not after.
        */}
        {report ? (
          <div className={`read-report conf-${report.confidence}`}>
            <p className="read-head">
              <b>Read from the guide</b>
              <span>
                {report.model} · {report.confidence} confidence ·{' '}
                {report.cached
                  ? 'already read, nothing spent'
                  : `$${report.usage.costUsd.toFixed(4)}`}
              </span>
            </p>
            <p className="read-src">
              {report.guideTitle || 'Untitled page'} · {Math.round(report.guideChars / 1000)}k
              characters read
            </p>

            {report.notes.length > 0 ? (
              <ul>
                {report.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}

            {/* Not a warning: these are things the guide asked for that this
                build has no way to render, taken out so the card works. */}
            {report.dropped.length > 0 ? (
              <>
                <p className="read-head">
                  <b>Left out, because this build has no such thing</b>
                </p>
                <ul className="read-dropped">
                  {report.dropped.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
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

      <h3>Add a model</h3>
      {/*
        The link, not the form. Writing a card by hand means knowing the card
        format, six syntaxes, three renderers, the whole IR path vocabulary and
        which engine rules exist. The vendor's prompting guide already says all
        of it — in prose, which is what the model is for.
      */}
      <p className="sheet-p">
        Paste the link to the model’s official prompting guide. Dialect reads it with Opus and
        writes the card — name, family, the field order, the limits, what it will not do — and
        shows it to you before anything is saved.
      </p>

      <div className="sheet-row">
        <input
          className="sheet-i"
          spellCheck={false}
          placeholder="https://… the model’s prompting guide"
          value={guideUrl}
          disabled={reading}
          onChange={(e) => setGuideUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && guideUrl.trim() && !reading) void readGuide();
          }}
        />
        <button
          className="solid"
          disabled={reading || guideUrl.trim().length === 0}
          onClick={() => void readGuide()}
        >
          {reading ? 'Reading…' : 'Read the guide'}
        </button>
      </div>

      {/* Said before it is pressed, not after. */}
      <p className="sheet-p dim">
        One call to Opus, usually a few cents, counted against the same budget as everything else.
        {' '}A guide already read costs nothing the second time.
      </p>

      <div className="sheet-row">
        <button className="ghost" onClick={() => start(null)}>
          Write one by hand
        </button>
        <button
          className="ghost"
          onClick={() => void act(async () => {
            await openCardsFolder();
            return null;
          })}
        >
          Show my cards folder
        </button>
      </div>

      {/* The list had nowhere to put a failure, so its buttons reported
          nothing at all — which is how "open the folder" managed to look
          broken twice over. */}
      {error ? <p className="sheet-err">{error}</p> : null}
      {note && !error ? <p className="state on">{note}</p> : null}

      <p className="sheet-p dim">
        Cards load in three layers — what the app shipped with, what an installed set brought, then
        yours. Later wins by id, so a card of your own overrides either without touching them.
      </p>
    </>
  );
}
