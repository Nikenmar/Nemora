import { useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ipc, type SpotifyPreview } from '@platform/ipc';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Button from '../Button';
import Checkbox from '../Checkbox';
import Img from '../Img';

import PlaylistDefaultCover from '../../assets/images/webp/playlist_cover_default.webp';

type Track = SpotifyPreview['tracks'][number];

const credit = (title: string | null | undefined, artists: string[]) =>
  [title, artists.join(', ')].filter(Boolean).join(' — ');

/** One Spotify track and, when found, the library's song beside it. */
const Row = ({ track, children }: { track: Track; children?: React.ReactNode }) => (
  <li className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
    {children}
    <div className="min-w-0 flex-1">
      <div className="truncate text-body text-ink">{track.title}</div>
      <div className="truncate text-small text-ink-dim">{track.artists.join(', ')}</div>
    </div>
    {track.songId && (
      <div className="min-w-0 flex-1 text-right">
        <div className="truncate text-small text-ink-dim">
          <span className="ms-icon mr-1 align-[-3px] text-[16px]">arrow_forward</span>
          {credit(track.libraryTitle, track.libraryArtists)}
        </div>
      </div>
    )}
  </li>
);

/**
 * A public Spotify playlist brought in by its link: its tracks found in the library, the doubtful
 * ones shown for a check, the missing ones listed to copy, then a playlist of what was found.
 */
const SpotifyImportPrompt = () => {
  const { changePromptMenuData, addNewNotifications, changeCurrentActivePage } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<SpotifyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  /** Doubtful matches the user turned down, by position. */
  const [declined, setDeclined] = useState<Set<number>>(new Set());
  const [showFound, setShowFound] = useState(false);

  const groups = useMemo(() => {
    const tracks = preview?.tracks ?? [];
    const at = tracks.map((track, index) => ({ track, index }));
    return {
      exact: at.filter(({ track }) => track.confidence === 'exact'),
      likely: at.filter(({ track }) => track.confidence === 'likely'),
      missing: at.filter(({ track }) => !track.songId)
    };
  }, [preview]);

  const chosen = useMemo(() => {
    const ids: string[] = [];
    preview?.tracks.forEach((track, index) => {
      if (!track.songId || declined.has(index) || ids.includes(track.songId)) return;
      ids.push(track.songId);
    });
    return ids;
  }, [preview, declined]);

  const lookUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const found = await ipc('spotify_playlist_preview', { link: link.trim() });
      setPreview(found);
      setName(found.name);
      setDeclined(new Set());
    } catch (reason) {
      setPreview(null);
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!preview || chosen.length === 0) return;
    // A cover that does not come leaves the playlist with its usual one.
    const artwork = preview.coverUrl
      ? await ipc('spotify_cover', { id: preview.id, url: preview.coverUrl }).catch(() => undefined)
      : undefined;
    const result = await window.api.playlistsData.addNewPlaylist(name.trim(), chosen, artwork);
    if (!result?.success || !result.playlist) {
      setError(result?.message ?? t('spotifyImport.createFailed'));
      return;
    }
    changePromptMenuData(false);
    addNewNotifications([
      {
        id: 'spotifyImported',
        duration: 5000,
        content: t('spotifyImport.created', { name: name.trim(), count: chosen.length })
      }
    ]);
    changeCurrentActivePage('PlaylistInfo', { playlistId: result.playlist.playlistId });
  };

  const copyMissing = () => {
    const text = groups.missing.map(({ track }) => credit(track.title, track.artists)).join('\n');
    navigator.clipboard
      .writeText(text)
      .then(() =>
        addNewNotifications([
          { id: 'spotifyMissingCopied', duration: 3000, content: t('spotifyImport.copied') }
        ])
      )
      .catch((reason: unknown) => console.warn('[spotify import] not copied', reason));
  };

  return (
    <div className="spotify-import flex w-full flex-col gap-5">
      <div>
        <h2 className="text-title font-semibold text-ink">{t('spotifyImport.title')}</h2>
        <p className="mt-1 text-small text-ink-dim">{t('spotifyImport.description')}</p>
      </div>
      <div className="flex gap-2">
        <input
          type="url"
          name="spotifyLink"
          className="min-w-0 flex-1 rounded-full border-[transparent] !bg-surface-2 px-5 py-2.5 text-body text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          placeholder="https://open.spotify.com/playlist/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && link.trim() && !loading) lookUp().catch(() => undefined);
          }}
          autoFocus
        />
        <Button
          label={t('spotifyImport.find')}
          iconName="search"
          variant="primary"
          className="!mr-0"
          isDisabled={!link.trim() || loading}
          clickHandler={(_, setIsDisabled, setIsPending) => {
            setIsDisabled(true);
            setIsPending(true);
            lookUp()
              .finally(() => {
                setIsDisabled(false);
                setIsPending(false);
              })
              .catch(() => undefined);
          }}
        />
      </div>
      {error && <p className="text-small text-danger">{error}</p>}

      {preview && (
        <>
          <div className="flex items-center gap-4">
            <Img
              src={preview.coverUrl ?? PlaylistDefaultCover}
              fallbackSrc={PlaylistDefaultCover}
              alt=""
              className="h-20 w-20 shrink-0 rounded-cover-sm object-cover shadow-[0_4px_14px_rgb(0_0_0/0.35)]"
            />
            <div className="min-w-0 flex-1">
              <input
                type="text"
                name="playlistName"
                aria-label={t('renamePlaylistPrompt.playlistName')}
                className="w-full rounded-lg border-[transparent] bg-transparent px-1 text-title font-semibold text-ink outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              {preview.owner && <div className="px-1 text-small text-ink-dim">{preview.owner}</div>}
              <div className="mt-1 flex flex-wrap gap-x-4 px-1 text-small text-ink-dim">
                <span>{t('spotifyImport.foundCount', { count: groups.exact.length })}</span>
                {groups.likely.length > 0 && (
                  <span>{t('spotifyImport.likelyCount', { count: groups.likely.length })}</span>
                )}
                <span>{t('spotifyImport.missingCount', { count: groups.missing.length })}</span>
              </div>
            </div>
          </div>
          {preview.mayBeCut && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-small text-ink-dim">
              <span className="ms-icon mr-1.5 align-[-4px] text-[18px] text-warning">info</span>
              {t('spotifyImport.mayBeCut')}
            </p>
          )}

          <div className="flex max-h-[45vh] flex-col gap-4 overflow-y-auto pr-1">
            {groups.likely.length > 0 && (
              <section>
                <h3 className="mb-1 text-body font-medium text-ink">{t('spotifyImport.likelyTitle')}</h3>
                <p className="mb-1 text-small text-ink-dim">{t('spotifyImport.likelyHint')}</p>
                <ul>
                  {groups.likely.map(({ track, index }) => (
                    <Row key={index} track={track}>
                      <Checkbox
                        id={`spotify-likely-${index}`}
                        isChecked={!declined.has(index)}
                        checkedStateUpdateFunction={(state) =>
                          setDeclined((now) => {
                            const next = new Set(now);
                            if (state) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                      />
                    </Row>
                  ))}
                </ul>
              </section>
            )}
            {groups.missing.length > 0 && (
              <section>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-body font-medium text-ink">{t('spotifyImport.missingTitle')}</h3>
                  <Button
                    label={t('spotifyImport.copyMissing')}
                    iconName="content_copy"
                    size="sm"
                    className="!mr-0"
                    clickHandler={copyMissing}
                  />
                </div>
                <ul>
                  {groups.missing.map(({ track, index }) => (
                    <Row key={index} track={track} />
                  ))}
                </ul>
              </section>
            )}
            {groups.exact.length > 0 && (
              <section>
                <button
                  type="button"
                  className="flex items-center gap-1 text-body font-medium text-ink outline-none focus-visible:underline"
                  onClick={() => setShowFound((now) => !now)}
                  aria-expanded={showFound}
                >
                  <span className="ms-icon text-[20px]">{showFound ? 'expand_less' : 'expand_more'}</span>
                  {t('spotifyImport.foundTitle', { count: groups.exact.length })}
                </button>
                {showFound && (
                  <ul className="mt-1">
                    {groups.exact.map(({ track, index }) => (
                      <Row key={index} track={track} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              label={t('spotifyImport.create', { count: chosen.length })}
              iconName="playlist_add"
              variant="primary"
              className="!mr-0"
              isDisabled={chosen.length === 0 || !name.trim()}
              clickHandler={(_, setIsDisabled, setIsPending) => {
                setIsDisabled(true);
                setIsPending(true);
                create()
                  .finally(() => {
                    setIsDisabled(false);
                    setIsPending(false);
                  })
                  .catch((reason: unknown) => setError(String(reason)));
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default SpotifyImportPrompt;
