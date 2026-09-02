import { useEffect, useState } from 'react';
import type { LoadedRegistry } from '@dialect/core';

import { CardList } from './CardList.tsx';

import {
  channelStatus,
  checkChannel,
  distrustKey,
  installChannel,
  openCardsFolder,
  revertChannel,
  trustKey,
  type ChannelStatus,
  type Checked,
} from './channel.ts';

/**
 * Where the model cards came from, and how to replace them.
 *
 * Cards are dated. The formula a model wants this month is not the one it
 * wanted last, and the card is the only thing between that change and a wrong
 * prompt — so the set has to be replaceable without a new binary.
 *
 * Which makes it a supply chain, and the second tab is where that is admitted:
 * a set installs only if it is signed by a key trusted beforehand. Without a
 * trusted key nothing installs at all, and the panel says so rather than
 * offering a button that would.
 *
 * The cards themselves come first, because that is what someone opening a
 * panel called "Model cards" came to see. Where the set came from is a question
 * you have once; what a card says is a question you have every time one is
 * wrong.
 */
export function Cards({
  registry,
  onChanged,
  onClose,
}: {
  registry: LoadedRegistry;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'cards' | 'source'>('cards');
  const rejected = registry.rejected;
  const cardCount = registry.registry.profiles.size;
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [source, setSource] = useState('');
  const [found, setFound] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = (): void => {
    void channelStatus().then(setStatus);
  };
  useEffect(refresh, []);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const trusted = Boolean(status?.trusted_key);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-box wide" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h2>Model cards</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="tabs">
          <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
            The cards
          </button>
          <button className={tab === 'source' ? 'on' : ''} onClick={() => setTab('source')}>
            Where they come from
          </button>
        </div>

        {tab === 'cards' ? <CardList registry={registry} onChanged={onChanged} /> : null}

        <div hidden={tab !== 'source'}>
        <p className="sheet-p">
          {cardCount} cards in use.{' '}
          {status?.version
            ? `Set ${status.channel} v${status.version}, published ${status.published}.`
            : 'The set this build shipped with.'}
        </p>

        {rejected.length > 0 ? (
          <ul className="findings">
            {rejected.map((r) => (
              <li key={`${r.origin}-${r.source}`} className="warn">
                <span className="lvl">skipped</span>
                <div>
                  <p className="msg">
                    {r.source} <em className="src">{r.origin}</em>
                  </p>
                  <p className="fix">{r.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <h3>Trusted publisher</h3>
        <p className="sheet-p">
          A card decides what every prompt says, so a set installs only if it is signed by a key
          you trusted first. Ed25519, 64 hex characters.
        </p>

        <div className="sheet-row">
          <input
            className="sheet-i"
            spellCheck={false}
            placeholder={status?.trusted_key ?? 'no key trusted'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          <button
            className="solid"
            disabled={busy || keyDraft.trim().length === 0}
            onClick={() =>
              void run(async () => {
                await trustKey(keyDraft);
                setKeyDraft('');
                setNote('Key trusted.');
              })
            }
          >
            Trust
          </button>
          {trusted ? (
            <button
              className="ghost"
              disabled={busy}
              onClick={() => void run(async () => { await distrustKey(); setNote(null); })}
            >
              Forget
            </button>
          ) : null}
          <span className={`state${trusted ? ' on' : ''}`}>
            {trusted ? `${status?.trusted_key?.slice(0, 16)}…` : 'nothing can be installed'}
          </span>
        </div>

        <h3>Install a set</h3>
        <p className="sheet-p">
          A URL, or a folder holding <span className="mono">manifest.json</span>,{' '}
          <span className="mono">manifest.sig</span> and the cards. Every file is checked against
          the signed manifest before anything is replaced.
        </p>

        <div className="sheet-row">
          <input
            className="sheet-i"
            spellCheck={false}
            placeholder="https://… or a folder"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setFound(null);
            }}
          />
          <button
            className="ghost"
            disabled={busy || !trusted || source.trim().length === 0}
            onClick={() => void run(async () => setFound(await checkChannel(source.trim())))}
          >
            Check
          </button>
          <button
            className="solid"
            disabled={busy || !trusted || source.trim().length === 0}
            onClick={() =>
              void run(async () => {
                await installChannel(source.trim(), false);
                setFound(null);
                setNote('Installed.');
                onChanged();
              })
            }
          >
            Install
          </button>
        </div>

        {found ? (
          <p className="sheet-p dim">
            {found.channel} v{found.version}, {found.cards} cards, published {found.published}
            {found.stale ? ' — not newer than what is installed.' : '.'}
          </p>
        ) : null}

        {error ? <p className="sheet-err">{error}</p> : null}
        {note && !error ? <p className="state on">{note}</p> : null}

        <div className="sheet-row">
          {status?.version ? (
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await revertChannel();
                  setNote('Back to the cards this build shipped with.');
                  onChanged();
                })
              }
            >
              Back to built-in
            </button>
          ) : null}
          <button className="ghost" onClick={() => void openCardsFolder()}>
            Open my cards folder
          </button>
        </div>

        <p className="sheet-p dim">
          Cards in that folder are yours and are not signed — they load last, so one of them
          overrides anything above it. A card naming a renderer this build does not have is
          skipped rather than crashing the window.
        </p>
        </div>
      </div>
    </div>
  );
}
