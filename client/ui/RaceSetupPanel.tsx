import { useEffect, useState } from 'react';

import type { MusicGenre } from '@shared/audio/score.ts';
import type { ArchetypeName, PaletteName } from '@shared/spec.ts';
import type { Translate } from '../i18n.ts';

export interface RaceSetupSelection {
  palette?: PaletteName;
  archetype?: ArchetypeName;
  music: MusicChoice;
}

export type MusicChoice = MusicGenre | 'random';

/**
 * Manual race setup stays deliberately small: these are constraints the
 * curator already understands, not a second track editor hidden in a modal.
 * Disabled entries make the intended Grand Prix world and future soundtrack
 * directions visible without claiming that they affect a generated race yet.
 */
export function RaceSetupPanel({
  currentGenre,
  onStart,
  onClose,
  t,
}: {
  currentGenre: MusicGenre;
  onStart: (selection: RaceSetupSelection) => void;
  onClose: () => void;
  t: Translate;
}): React.ReactElement {
  const [palette, setPalette] = useState<PaletteName | ''>('');
  const [archetype, setArchetype] = useState<ArchetypeName | ''>('');
  const [music, setMusic] = useState<MusicChoice>(currentGenre);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <section
      className="slab scroll-thin max-h-[calc(100dvh-2rem)] w-[min(92vw,460px)] overflow-y-auto px-4 py-4 sm:px-5 sm:py-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="race-setup-title"
    >
      <h2 id="race-setup-title" className="u-narrow text-[22px] font-extrabold uppercase">
        {t('setup.title')}
      </h2>
      <p className="mt-1.5 text-[12px] leading-relaxed text-(--color-dim)">
        {t('setup.note')}
      </p>

      <div className="mt-5 space-y-4">
        <SetupSelect
          id="race-world"
          label={t('setup.world')}
          value={palette}
          onChange={(value) => setPalette(value as PaletteName | '')}
        >
          <option value="">{t('setup.random')}</option>
          <optgroup label={t('setup.world.surface')}>
            <option value="jungla">{t('setup.world.jungla')}</option>
            <option value="desierto">{t('setup.world.desierto')}</option>
            <option value="glaciar">{t('setup.world.glaciar')}</option>
          </optgroup>
          <optgroup label={t('setup.world.orbit')}>
            <option value="neon">{t('setup.world.neon')}</option>
            <option value="citrico">{t('setup.world.citrico')}</option>
            <option value="hielo">{t('setup.world.hielo')}</option>
            <option value="magma">{t('setup.world.magma')}</option>
            <option value="bruma">{t('setup.world.bruma')}</option>
            <option value="arcade">{t('setup.world.arcade')}</option>
          </optgroup>
        </SetupSelect>

        <SetupSelect
          id="race-track"
          label={t('setup.track')}
          value={archetype}
          onChange={(value) => setArchetype(value as ArchetypeName | '')}
        >
          <option value="">{t('setup.random')}</option>
          <option value="descenso">{t('setup.track.descenso')}</option>
          <option value="helice">{t('setup.track.helice')}</option>
          <option value="guantelete">{t('setup.track.guantelete')}</option>
          <option value="acantilado">{t('setup.track.acantilado')}</option>
          <option value="serpiente">{t('setup.track.serpiente')}</option>
        </SetupSelect>

        <SetupSelect
          id="race-music"
          label={t('setup.music')}
          value={music}
          onChange={(value) => setMusic(value as MusicChoice)}
        >
          <option value="random">{t('setup.random')}</option>
          <optgroup label={t('setup.available')}>
            <option value="dnb">{t('audio.genre.dnb')}</option>
            <option value="rock">{t('audio.genre.rock')}</option>
            <option value="kids">{t('audio.genre.kids')}</option>
          </optgroup>
        </SetupSelect>
      </div>

      <aside className="mt-5 border border-(--color-rule) bg-black/15 px-3 py-3">
        <h3 className="u-label text-(--color-flag)">{t('setup.comingSoon')}</h3>
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px] leading-relaxed">
          <span className="u-label pt-0.5">{t('setup.world')}</span>
          <span>{t('setup.world.grandPrix')}</span>
          <span className="u-label pt-0.5">{t('setup.music')}</span>
          <span className="text-(--color-dim)">
            {[
              t('setup.music.arcade'),
              t('setup.music.electronic'),
              t('setup.music.orchestral'),
              t('setup.music.latin'),
            ].join(' · ')}
          </span>
        </div>
      </aside>

      <div className="mt-6 flex gap-2">
        <button type="button" className="btn flex-1" onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={() =>
            onStart({
              palette: palette || undefined,
              archetype: archetype || undefined,
              music,
            })
          }
        >
          {t('setup.start')}
        </button>
      </div>
    </section>
  );
}

function SetupSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label htmlFor={id} className="block">
      <span className="u-label block">{label}</span>
      <select
        id={id}
        autoFocus={id === 'race-world'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-[3px] border border-(--color-rule) bg-(--color-ink) px-3 py-3 text-(--color-bone)"
        style={{ fontSize: '16px' }}
      >
        {children}
      </select>
    </label>
  );
}
