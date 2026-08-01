import type { SceneSnapshot } from '../scene/RaceScene.ts';
import type { Translate } from '../i18n.ts';
import { formatClock } from '../lib/format.ts';

/**
 * Wordmark, clock, and the section the leader is currently in.
 *
 * The section label is the one piece of the generator's grammar that surfaces
 * during the race — "Espiral", "Horquilla" — so the track reads as designed
 * rather than as noise.
 */
export function Wordmark({
  snapshot,
  archetype,
  t,
  lang,
  onToggleLang,
}: {
  snapshot: SceneSnapshot | null;
  archetype: string | null;
  t: Translate;
  lang: string;
  onToggleLang: () => void;
}): React.ReactElement {
  const clock = formatClock(Math.max(0, snapshot?.raceTime ?? 0));
  return (
    <div className="slab flex items-stretch">
      <div className="px-4 py-3">
        <h1 className="u-wide text-[19px] leading-none font-extrabold italic tracking-[0.14em]">
          CANICA<span style={{ color: 'var(--leader)' }}>RRERA</span>
        </h1>
        <p className="u-label mt-1.5">
          {archetype ?? t('app.tagline')}
          {snapshot?.section ? ` · ${snapshot.section}` : ''}
        </p>
        <div className="u-mono mt-2 text-[17px] leading-none text-(--color-flag)">
          {clock}
          {/* Only seconds get a unit. "1:03.0 s" is not a thing. */}
          {!clock.includes(':') && <span className="ml-1 text-[11px] text-(--color-dim)">s</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleLang}
        className="u-label border-l border-(--color-rule) px-3 transition-colors hover:text-(--color-bone)"
        aria-label={lang === 'es' ? 'Switch to English' : 'Cambiar a español'}
      >
        {t('app.langToggle')}
      </button>
    </div>
  );
}
