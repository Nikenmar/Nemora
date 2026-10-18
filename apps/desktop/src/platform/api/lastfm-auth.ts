/**
 * Last.fm browser-login callback lifecycle.
 *
 * `loginToLastFmInBrowser` opens the Last.fm auth page in the system browser.
 * After the user authorizes, Last.fm redirects the browser to
 * `nemora://auth?service=lastfm&token=...`. The OS hands that URI to the running
 * app (single-instance argv), which surfaces it to the webview as the
 * `nemora://second-instance` event. On a cold start the URI arrives before the
 * webview exists, so Rust queues it until it is drained.
 *
 * Lifecycle implemented here:
 *   1. `ensureLastFmAuthCallbackInstalled()` subscribes to the
 *      `nemora://second-instance` event and drains the Rust queue, so a callback
 *      that arrived during startup is not lost. Idempotent — repeated calls
 *      install one listener.
 *   2. Each argv batch is scanned for a `nemora://auth` URI and routed to
 *      {@link handleLastFmAuthUri}, which is also the handler the renderer
 *      bootstrap should wire as `SecondInstanceRoutes.openAuthUri` once it
 *      instantiates `SingleInstanceController`.
 *   3. The token is redeemed against Last.fm (`auth.getSession`, MD5-signed),
 *      the session key is encrypted with `core/secrets` and persisted, and the
 *      renderer is notified with `LASTFM_LOGIN_SUCCESS`.
 *
 * The token is single-use on Last.fm's side, so a URI is never processed
 * twice: already-handled URIs are remembered (bounded ring), which also makes
 * the direct event listener and the controller route safe to coexist.
 */

import { invoke } from '@tauri-apps/api/core';

import type { LastFMSessionGetResponse } from '../../types/last_fm_api';
import { getBuildEnvVariable } from '../core/net/buildEnv';
import hashText from '../core/net/hashText';
import { encrypt } from '../core/secrets/safeStorage';
import { getRuntime } from '../runtime';
import { emitLocal, subscribe } from './events';

const AUTH_URI_PREFIX = 'nemora://auth';
const AUTH_CALLBACK_EVENT = 'nemora://second-instance';
const RECENT_URI_MEMORY = 25;

const recentlyHandledUris: string[] = [];

const markUriHandled = (uri: string): void => {
  recentlyHandledUris.push(uri);
  if (recentlyHandledUris.length > RECENT_URI_MEMORY) recentlyHandledUris.shift();
};

const wasUriHandled = (uri: string): boolean => recentlyHandledUris.includes(uri);

const createLastFmAuthSignature = (token: string, apiKey: string): string => {
  const sharedSecret = getBuildEnvVariable('MAIN_VITE_LAST_FM_SHARED_SECRET');
  if (!sharedSecret) throw new Error('LastFM Shared Secret not found.');

  const sig = `api_key${apiKey}methodauth.getSessiontoken${token}${sharedSecret}`;
  const utf8EncodedSig = encodeURIComponent(sig);
  return hashText(utf8EncodedSig);
};

/**
 * Redeems a Last.fm auth token for a session, encrypts the session key with
 * the same scheme the Electron build used, persists it and notifies the
 * renderer. Never stores anything when the flow fails.
 */
const manageLastFmAuth = async (token: string): Promise<void> => {
  const apiKey = getBuildEnvVariable('MAIN_VITE_LAST_FM_API_KEY');
  if (!apiKey) throw new Error('LastFM api key not found.');

  const sig = createLastFmAuthSignature(token, apiKey);

  const url = new URL('http://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'auth.getSession');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('token', token);
  url.searchParams.set('api_sig', sig);

  const res = await fetch(url);
  const json: LastFMSessionGetResponse = await res.json();

  if ('session' in json) {
    const { key, name } = json.session;
    const encryptedKey = await encrypt(key);
    getRuntime().saveUserData('lastFmSessionData', { name, key: encryptedKey });
    emitLocal('app/sendMessageToRendererEvent', 'LASTFM_LOGIN_SUCCESS');
    return;
  }

  throw new Error('Session not found in LastFM response.');
};

/** Extracts the Last.fm token from a `nemora://auth` callback URI. */
const tokenFromAuthUri = (uri: string): string | undefined => {
  const query = uri.split('?').at(1);
  if (!query) return undefined;
  const params = new URLSearchParams(query);
  if (params.get('service') !== 'lastfm') return undefined;
  const token = params.get('token');
  return token ? decodeURIComponent(token) : undefined;
};

/**
 * Handles one `nemora://auth` callback URI: deduplicates, then redeems the token
 * and persists the encrypted session. Failures are logged, never silent.
 */
export const handleLastFmAuthUri = async (uri: string): Promise<void> => {
  const normalized = uri.toLocaleLowerCase('en-US');
  if (!normalized.startsWith(AUTH_URI_PREFIX)) return;
  if (wasUriHandled(normalized)) return;
  markUriHandled(normalized);

  const token = tokenFromAuthUri(uri);
  if (!token) {
    console.error(`Last.fm auth callback arrived without a token: ${uri}`);
    return;
  }

  try {
    await manageLastFmAuth(token);
  } catch (error) {
    // Mirrors the Electron behaviour: failures are logged and the renderer is
    // not told the login succeeded. Nothing was persisted.
    console.error('Failed to complete the Last.fm login.', error);
  }
};

let callbackInstalled = false;

/**
 * Test-only reset; production code never calls this. Restores the idempotent
 * installer to its uninstalled state between tests.
 */
export const resetLastFmAuthCallbackInstallationForTests = (): void => {
  callbackInstalled = false;
};

/**
 * Idempotently installs the `nemora://second-instance` listener and drains the
 * Rust-side queue so a callback that arrived before the webview was ready is
 * still processed.
 */
export const ensureLastFmAuthCallbackInstalled = (): void => {
  if (callbackInstalled) return;
  callbackInstalled = true;

  subscribe<string[], [string[]]>(
    AUTH_CALLBACK_EVENT,
    (_event, argv) => {
      for (const argument of argv) void handleLastFmAuthUri(argument);
    },
    (argv: string[]) => [argv]
  );

  void invoke<string[][]>('drain_pending_second_instance_args')
    .then((queued) => {
      for (const argv of queued) {
        for (const argument of argv) void handleLastFmAuthUri(argument);
      }
    })
    .catch((error: unknown) => console.error('Failed to drain pending auth callbacks.', error));
};
