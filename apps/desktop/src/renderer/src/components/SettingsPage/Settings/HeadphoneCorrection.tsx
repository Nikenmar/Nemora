import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import Button from '../../Button';
import Checkbox from '../../Checkbox';
import {
  autoEqIndex,
  autoEqProfile,
  correctionStore,
  previewCorrection,
  setCorrection,
  type CorrectionPreview,
  type Headphone
} from '../../../other/headphoneCorrection';

const W = 480;
const H = 120;
const RANGE_DB = 12;
const xOf = (f: number) => (Math.log10(f / 20) / 3) * W;
const yOf = (db: number) => H / 2 - (Math.max(-RANGE_DB, Math.min(RANGE_DB, db)) / RANGE_DB) * (H / 2);

/** The correction's curve, preamp included: what the profile does to the sound. */
const Curve = ({ curve }: { curve: [number, number][] }) => {
  const points = curve.map(([f, db]) => `${xOf(f).toFixed(1)},${yOf(db).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full max-w-xl" role="img" aria-hidden>
      {[100, 1000, 10000].map((f) => (
        <line key={f} x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} className="stroke-line" strokeWidth={1} />
      ))}
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-ink-dim" strokeWidth={1} strokeDasharray="3 4" />
      <polyline points={points} fill="none" className="stroke-echo" strokeWidth={2} strokeLinejoin="round" />
      {[
        [100, '100'],
        [1000, '1k'],
        [10000, '10k']
      ].map(([f, label]) => (
        <text key={label} x={xOf(Number(f)) + 4} y={H - 4} className="fill-ink-dim text-[10px]">
          {label}
        </text>
      ))}
      <text x={4} y={12} className="fill-ink-dim text-[10px]">
        +{RANGE_DB} dB
      </text>
      <text x={4} y={H - 4} className="fill-ink-dim text-[10px]">
        -{RANGE_DB} dB
      </text>
    </svg>
  );
};

/**
 * Settings > Equalizer > Headphone correction (PLAN/18 D5). Off by default. A profile comes from
 * the AutoEQ list (fetched from GitHub only when the user asks) or from an imported
 * `ParametricEQ.txt` / Equalizer APO file; it runs before the equalizer.
 */
const HeadphoneCorrection = () => {
  const { t } = useTranslation();
  const correction = useStore(correctionStore, (s) => s);
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [list, setList] = useState<Headphone[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!correction.text) {
      setPreview(null);
      return;
    }
    previewCorrection(correction.text)
      .then(setPreview)
      .catch((e) => setError(String(e)));
  }, [correction.text]);

  const matches = useMemo(() => {
    if (!list) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return list.filter((h) => words.every((w) => h.name.toLowerCase().includes(w))).slice(0, 8);
  }, [list, query]);

  const use = async (text: string, name: string, source: string) => {
    const checked = await previewCorrection(text);
    setPreview(checked);
    setCorrection({ isOn: true, name, source, text });
  };

  const loadList = (refresh: boolean) => {
    setBusy('list');
    setError('');
    autoEqIndex(refresh)
      .then(setList)
      .catch((e) => setError(t('correction.listFailed', { error: String(e) })))
      .finally(() => setBusy(''));
  };

  const pick = (headphone: Headphone) => {
    setBusy(headphone.path);
    setError('');
    autoEqProfile(headphone)
      .then((text) => use(text, headphone.name, headphone.rig ? `${headphone.source} (${headphone.rig})` : headphone.source))
      .then(() => setQuery(''))
      .catch((e) => setError(t('correction.profileFailed', { error: String(e) })))
      .finally(() => setBusy(''));
  };

  const importFile = async () => {
    setError('');
    const [{ open }, { readTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs')
    ]);
    const path = await open({
      title: t('correction.import'),
      multiple: false,
      filters: [{ name: 'ParametricEQ / Equalizer APO', extensions: ['txt'] }]
    });
    if (typeof path !== 'string') return;
    const text = await readTextFile(path);
    const name = path.split(/[\\/]/).pop()?.replace(/( ParametricEQ)?\.txt$/i, '') ?? '';
    await use(text, name, t('correction.imported')).catch((e) => setError(t('correction.unreadable', { error: String(e) })));
  };

  const skipped = preview?.profile.skipped.length ?? 0;

  return (
    <div className="headphone-correction mt-8 border-t border-line pt-6" id="headphoneCorrection">
      <div className="flex items-center justify-between gap-4">
        <Checkbox
          id="headphoneCorrectionToggle"
          isChecked={correction.isOn && !!correction.text}
          isDisabled={!correction.text}
          checkedStateUpdateFunction={(state) => setCorrection({ isOn: state })}
          labelContent={t('correction.title')}
        />
        <Button
          label={t('correction.import')}
          iconName="upload_file"
          clickHandler={() => {
            importFile().catch((e) => setError(String(e)));
          }}
        />
      </div>
      <p className="ml-8 mt-1 max-w-2xl text-small text-ink-dim">{t('correction.description')}</p>

      {correction.text && (
        <div className="ml-8 mt-4">
          <div className="text-small">
            <span className="font-medium">{correction.name}</span>
            <span className="text-ink-dim"> · {correction.source}</span>
            {preview && (
              <span className="text-ink-dim">
                {' '}
                · {t('correction.summary', { count: preview.profile.filters.length, preamp: preview.profile.preampDb.toFixed(1) })}
              </span>
            )}
          </div>
          {preview && <Curve curve={preview.curve} />}
          {skipped > 0 && <p className="text-small text-ink-dim">{t('correction.skipped', { count: skipped })}</p>}
        </div>
      )}

      <div className="ml-8 mt-4 max-w-xl">
        {list === null ? (
          <div className="flex items-center gap-3">
            <Button
              label={busy === 'list' ? t('correction.loading') : t('correction.loadList')}
              iconName="headphones"
              isDisabled={busy === 'list'}
              clickHandler={() => loadList(false)}
            />
            <span className="text-small text-ink-dim">{t('correction.listNote')}</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder={t('correction.searchPlaceholder', { count: list.length })}
                aria-label={t('correction.searchPlaceholder', { count: list.length })}
                className="w-full rounded-lg bg-surface-2 px-3 py-1.5 text-ink outline-none placeholder:text-ink-dim focus-visible:outline-2 focus-visible:outline-echo"
              />
              <Button
                label={t('correction.refresh')}
                iconName="refresh"
                isDisabled={busy === 'list'}
                clickHandler={() => loadList(true)}
              />
            </div>
            {matches.length > 0 && (
              <ul className="mt-2 overflow-hidden rounded-lg bg-surface-2">
                {matches.map((h) => (
                  <li key={h.path}>
                    <button
                      type="button"
                      disabled={busy !== ''}
                      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-small outline-none hover:bg-line/60 focus-visible:bg-line/60 disabled:opacity-60"
                      onClick={() => pick(h)}
                    >
                      <span className="truncate">{h.name}</span>
                      <span className="shrink-0 text-ink-dim">
                        {busy === h.path ? t('correction.loading') : h.rig ? `${h.source} · ${h.rig}` : h.source}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {error && <p className="mt-2 text-small text-danger">{error}</p>}
        <p className="mt-3 text-small text-ink-dim">{t('correction.credit')}</p>
      </div>
    </div>
  );
};

export default HeadphoneCorrection;
