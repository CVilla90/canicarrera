import type { SceneSnapshot } from '../scene/RaceScene.ts';
import type { Translate } from '../i18n.ts';
import { formatFinish } from '../lib/format.ts';

/**
 * The timing tower.
 *
 * Condensed type because the column is narrow — that is what condensed faces
 * are for, and it is why real broadcast timing graphics all look like this. The
 * bar under each row is position along the track, not a decoration.
 */
export function TimingTower({
  snapshot,
  t,
}: {
  snapshot: SceneSnapshot;
  t: Translate;
}): React.ReactElement {
  return (
    <ol
      className="slab slab-quiet w-[184px] overflow-hidden py-1 sm:w-[212px]"
      aria-label={t('results.title')}
    >
      {snapshot.standings.map((row, index) => (
        <li
          key={row.id}
          className="tower-row"
          style={{
            borderLeftColor: row.color,
            background:
              index === 0 ? `color-mix(in srgb, ${row.color} 10%, transparent)` : undefined,
          }}
        >
          <span className="u-mono text-[11px] text-(--color-dim)">{index + 1}</span>
          <span className="u-narrow truncate text-[15px] font-semibold tracking-wide uppercase">
            {row.name}
          </span>
          <span
            className="u-mono text-[11px]"
            style={{ color: row.finished ? 'var(--color-flag)' : undefined }}
          >
            {row.finished ? formatFinish(row.finishTime) : `${Math.round(row.progress * 100)}%`}
          </span>
          <span
            className="tower-bar"
            style={{ width: `${Math.max(row.progress * 100, 1.5)}%`, background: row.color }}
          />
        </li>
      ))}
    </ol>
  );
}
