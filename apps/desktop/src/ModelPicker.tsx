/**
 * Which model to ask, chosen rather than compiled in.
 *
 * The list is fetched with the key, so it is whatever this account can actually
 * reach — including models that did not exist when this build was made. If the
 * fetch fails, or there is no key yet, the id can still be typed: refusing to
 * let someone name a model because a list request failed would be absurd.
 *
 * Changing it re-reads nothing. Answers already bought stay reachable because
 * the model is not part of a cache key — what is cached is what a picture
 * shows, which does not depend on who looked.
 */

import { useEffect, useState } from 'react';

import { currentModel, listModels, setModel, DEFAULT_MODEL, type ModelChoice } from './model.ts';

export function ModelPicker(): React.ReactElement {
  const [chosen, setChosen] = useState(currentModel);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [why, setWhy] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    void listModels()
      .then((found) => {
        setModels(found);
        setWhy(found.length === 0 ? 'No models came back. Add a key and reopen this.' : null);
      })
      .catch((err: Error) => setWhy(err.message));
  }, []);

  const choose = (id: string): void => {
    setChosen(id);
    setModel(id);
  };

  // A model the list does not have — typed by hand, or chosen before this build
  // knew about it. It stays selectable rather than silently reverting.
  const known = models.some((m) => m.id === chosen);
  const priced = models.find((m) => m.id === chosen)?.priced ?? false;

  return (
    <>
      <label className="sheet-l" htmlFor="model">
        Model
      </label>

      {models.length > 0 && !typing ? (
        <select
          id="model"
          className="sheet-i"
          value={known ? chosen : ''}
          onChange={(e) => (e.target.value ? choose(e.target.value) : setTyping(true))}
        >
          {!known ? <option value={chosen}>{chosen}</option> : null}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value="">Type an id…</option>
        </select>
      ) : (
        <input
          id="model"
          className="sheet-i"
          value={chosen}
          spellCheck={false}
          placeholder={DEFAULT_MODEL}
          onChange={(e) => choose(e.target.value.trim())}
        />
      )}

      <p className="sheet-p dim">
        {chosen !== DEFAULT_MODEL ? (
          <button type="button" className="ghost" onClick={() => choose(DEFAULT_MODEL)}>
            Back to {DEFAULT_MODEL}
          </button>
        ) : null}{' '}
        {known && !priced ? (
          <>This build has no rates for {chosen}, so what it costs will be over-estimated.</>
        ) : (
          <>Changing this re-reads nothing: what a reference says is already paid for.</>
        )}
      </p>

      {why ? <p className="sheet-p dim">{why}</p> : null}
    </>
  );
}
