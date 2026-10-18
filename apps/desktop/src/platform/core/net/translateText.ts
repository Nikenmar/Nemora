/**
 * Google Translate call, replacing `@vitalets/google-translate-api`.
 *
 * That package is Node-only in ways that are invisible until it runs: it
 * decompresses responses itself and reaches for `global`, so inside a webview
 * every translation failed with "invalid gzip data" while the request itself
 * had succeeded. It is a thin wrapper over one endpoint, so calling that
 * endpoint directly removes the dependency instead of shimming around it.
 *
 * `dj=1` asks for the decomposed JSON form, which is exactly the `RawResponse`
 * shape the lyrics code already expects: `{ src, sentences: [{ trans }] }`.
 *
 * The request is POSTed rather than sent as a query string because a full set
 * of lyrics comfortably exceeds a safe URL length.
 */

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

export interface TranslatedSentence {
  trans: string;
  orig?: string;
}

export interface RawTranslateResponse {
  /** Detected source language. */
  src: string;
  sentences: TranslatedSentence[];
}

export class TranslationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TranslationError';
  }
}

export async function translateText(
  text: string,
  targetLanguage: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ raw: RawTranslateResponse }> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('dt', 't');
  url.searchParams.set('dj', '1');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', targetLanguage || 'auto');

  const response = await fetchImpl(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ q: text }).toString()
  });

  if (!response.ok) {
    throw new TranslationError(
      `Google Translate responded ${response.status} ${response.statusText}`
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new TranslationError('Google Translate returned a body that is not JSON', { cause });
  }

  const raw = payload as Partial<RawTranslateResponse>;
  if (!Array.isArray(raw.sentences)) {
    throw new TranslationError('Google Translate returned no sentences');
  }

  return {
    raw: {
      src: typeof raw.src === 'string' ? raw.src : 'auto',
      // A trailing entry carrying only source-language metadata has no `trans`.
      sentences: raw.sentences.filter(
        (sentence): sentence is TranslatedSentence => typeof sentence?.trans === 'string'
      )
    }
  };
}
