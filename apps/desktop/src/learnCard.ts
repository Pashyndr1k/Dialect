/**
 * Reading a model's prompting guide and proposing its card.
 *
 * Two steps that belong to different sides of the bridge. The host fetches the
 * page — a web view cannot reach another origin, and the page is reduced to
 * text there so a few hundred kilobytes of markup is never paid for at the
 * model's input rate. The reasoning is a normal gateway call, so it is cached,
 * counted against the same budget as everything else, and made by the host with
 * the key the web view cannot see.
 *
 * The model is pinned to Opus rather than taking the window's usual choice.
 * Reading a specification and turning it into a formula is the hardest thing
 * this app asks of a model, it happens once per model rather than once per
 * reference, and a card that is subtly wrong is wrong in every prompt it ever
 * produces. That is worth the better model and a few cents.
 */

import { invoke } from '@tauri-apps/api/core';
import { Gateway, learnCard, type CardLearnResult } from '@dialect/core';

import { HostProvider } from './provider.ts';
import { hostCache } from './store.ts';
import { BUDGET_USD, gateway } from './gateway.ts';
import { listModels } from './model.ts';

const hasHost = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface FetchedGuide {
  title: string;
  text: string;
  /** Where it actually came from, after redirects. */
  url: string;
}

export const fetchGuide = (url: string): Promise<FetchedGuide> =>
  invoke<FetchedGuide>('guide_fetch', { url });

/** What to use when the model list cannot be reached. */
const OPUS_FALLBACK = 'claude-opus-5';

/**
 * The newest Opus this key can reach.
 *
 * Asked for rather than written down, for the same reason the model picker
 * asks: a model id compiled into a binary is a model id that is wrong by the
 * next release. Sorted descending so `claude-opus-5-1` beats `claude-opus-5`,
 * and falling back to a name that is right today if the list cannot be had.
 */
export async function bestOpus(): Promise<string> {
  try {
    const found = await listModels();
    const opus = found
      .map((m) => m.id)
      .filter((id) => id.includes('opus'))
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    return opus[0] ?? OPUS_FALLBACK;
  } catch {
    return OPUS_FALLBACK;
  }
}

/**
 * A second gateway, on the same cache, the same cap and the same running total.
 *
 * The window's gateway holds the provider it was built with, and rebuilding it
 * to change model would throw the budget away with it — the hole that let a
 * session spend past its own ceiling once already. So this one is separate. It
 * is also every way that hole could reopen, so all three are deliberate:
 *
 * The cap is the same number, and the total already spent is carried in before
 * the call. A second gateway with no `budgetUsd` would be a five dollar cap
 * with a door beside it.
 *
 * The increment is the call's own cost, not the second gateway's running total.
 * They are the same number today, because this gateway makes one call and is
 * thrown away — but only today.
 *
 * And the total goes back to the real gateway, which stays the one place a
 * total lives and the one thing that writes it to disk.
 */
function opusGateway(model: string): Gateway {
  const spender = new Gateway(new HostProvider({ model, maxTokens: 16000, effort: 'high' }), {
    cache: hostCache,
    budgetUsd: BUDGET_USD,
    onSpend: (usage) => {
      gateway.restoreSpend(gateway.spentUsd + usage.costUsd);
      window.dispatchEvent(new CustomEvent('dialect:spend', { detail: gateway.spentUsd }));
    },
  });
  spender.restoreSpend(gateway.spentUsd);
  return spender;
}

export interface CardProposal extends CardLearnResult {
  /** The guide's own title, for showing what was actually read. */
  guideTitle: string;
  /** How much text the guide turned out to be. */
  guideChars: number;
  /** Which model wrote the card. */
  model: string;
}

/**
 * Fetch the guide at `url` and propose a card from it.
 *
 * Nothing is written. The caller shows the result and lets someone read it
 * before it becomes a file.
 */
export async function proposeCard(url: string): Promise<CardProposal> {
  if (!hasHost()) {
    throw new Error(
      'Reading a guide needs the desktop app: a browser cannot fetch another site, ' +
        'and the key never leaves the host by design.',
    );
  }

  const fetched = await fetchGuide(url);
  const model = await bestOpus();
  const learned = await learnCard(opusGateway(model), {
    url: fetched.url,
    guide: fetched.text,
  });

  return {
    ...learned,
    guideTitle: fetched.title,
    guideChars: fetched.text.length,
    model,
  };
}
