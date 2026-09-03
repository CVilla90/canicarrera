import { useState } from 'react';

import { isMusicGenre, MUSIC_GENRES, type MusicGenre } from '@shared/audio/score.ts';
import type { AudioSettings } from '../audio/director.ts';
import type { Translate } from '../i18n.ts';

/**
 * The sound control.
 *
 * Closed, it is one button — because for most people the only question is "on or
 * off", and a race that opens a mixer at you is a race nobody watches. Open, it
 * adds a genre selector and four mix sliders because those layers genuinely
 * want different levels depending on where the video is going: music down for
 * a classroom, crowd up for a highlight reel.
 *
 * The button is also the **gesture** that unlocks the `AudioContext`. Browsers
 * refuse to make noise before a user acts, so nothing is created until this is
 * pressed — which is why sound ships off rather than merely muted.
 */
export function AudioPanel({
  settings,
  onChange,
  t,
}: {
  settings: AudioSettings;
  onChange: (next: AudioSettings) => void;
  t: Translate;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  const set = (patch: Partial<AudioSettings>): void => onChange({ ...settings, ...patch });

  return (
    <div className="slab slab-quiet relative">
      <div className="flex items-stretch">
        <button
          type="button"
          className="u-label px-3 py-2.5 transition-colors hover:text-(--color-bone)"
          onClick={() => set({ enabled: !settings.enabled })}
          aria-pressed={settings.enabled}
          title={settings.enabled ? t('audio.off') : t('audio.on')}
        >
          <span aria-hidden="true" className="text-[13px]">
            {settings.enabled ? '♪' : '✕'}
          </span>
          <span className="ml-2">{t('audio.label')}</span>
        </button>
        <button
          type="button"
          className="u-label border-l border-(--color-rule) px-2.5 transition-colors hover:text-(--color-bone)"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={t('audio.mix')}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>

      {open && (
        <div className="border-t border-(--color-rule) px-3 py-3">
          <label className="mb-2.5 flex items-center gap-2">
            <span className="u-label w-[68px] shrink-0">{t('audio.genre')}</span>
            <select
              value={settings.genre}
              onChange={(event) => {
                if (isMusicGenre(event.target.value)) set({ genre: event.target.value });
              }}
              className="min-w-0 flex-1 border border-(--color-rule) bg-(--color-ink) px-2 py-1 text-(--color-bone)"
              style={{ fontSize: '16px' }}
            >
              {MUSIC_GENRES.map((genre) => (
                <option key={genre} value={genre}>
                  {genreLabel(genre, t)}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label={t('audio.master')}
            value={settings.master}
            onChange={(master) => set({ master })}
          />
          <Slider
            label={t('audio.music')}
            value={settings.music}
            onChange={(music) => set({ music })}
          />
          <Slider label={t('audio.sfx')} value={settings.sfx} onChange={(sfx) => set({ sfx })} />
          <Slider
            label={t('audio.crowd')}
            value={settings.crowd}
            onChange={(crowd) => set({ crowd })}
          />
          <p className="mt-2 text-[10.5px] leading-relaxed text-(--color-dim)">
            {t('audio.note')}
          </p>
        </div>
      )}
    </div>
  );
}

function genreLabel(genre: MusicGenre, t: Translate): string {
  switch (genre) {
    case 'dnb':
      return t('audio.genre.dnb');
    case 'kids':
      return t('audio.genre.kids');
    case 'rock':
      return t('audio.genre.rock');
  }
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <label className="mt-1.5 flex items-center gap-2 first:mt-0">
      <span className="u-label w-[68px] shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        // 16px is the iOS Safari zoom threshold for form controls, and a range
        // input under it makes the page zoom in and never zoom back out.
        className="h-4 flex-1 accent-(--leader)"
        style={{ fontSize: '16px' }}
      />
    </label>
  );
}
