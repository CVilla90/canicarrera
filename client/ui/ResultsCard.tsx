import type { RaceMetrics } from '@shared/spec.ts';
import type { StandingRow } from '../scene/RaceScene.ts';
import type { Translate } from '../i18n.ts';
import { formatFinish } from '../lib/format.ts';

/**
 * The post-race card.
 *
 * Podium first, because that is what happened. Export is the primary action —
 * this is the moment someone decides the race was worth keeping, and it is also
 * the strongest signal we have that they liked it (PLAN §2b).
 */
export function ResultsCard({
  standings,
  metrics,
  t,
  onExport,
  onNewRace,
  onReplay,
  autoNext,
  autoNextRemaining,
  onToggleAutoNext,
  busy,
}: {
  standings: StandingRow[];
  metrics: RaceMetrics;
  t: Translate;
  onExport: () => void;
  onNewRace: () => void;
  onReplay: () => void;
  autoNext: boolean;
  autoNextRemaining: number | null;
  onToggleAutoNext: () => void;
  busy: boolean;
}): React.ReactElement {
  const podium = standings.slice(0, 3);
  const rest = standings.slice(3);

  return (
    <div className="scroll-thin slab animate-rise max-h-[calc(100dvh-2rem)] w-[min(92vw,430px)] overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
      <h2 className="u-label">{t('results.title')}</h2>

      <ol className="mt-3 space-y-2">
        {podium.map((row, index) => (
          <li key={row.id} className="flex items-baseline gap-3">
            <span
              className="u-mono w-5 text-[13px]"
              style={{ color: index === 0 ? 'var(--color-flag)' : 'var(--color-dim)' }}
            >
              {index + 1}
            </span>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: row.color, boxShadow: `0 0 10px ${row.color}` }}
            />
            <span
              className={`u-narrow flex-1 uppercase ${index === 0 ? 'text-[26px] font-extrabold' : 'text-[19px] font-semibold'}`}
              style={index === 0 ? { color: row.color } : undefined}
            >
              {row.name}
            </span>
            <span className="u-mono text-[13px] text-(--color-dim)">
              {row.finished ? formatFinish(row.finishTime) : t('results.dnf')}
            </span>
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <ol className="scroll-thin mt-3 max-h-[152px] space-y-1 overflow-y-auto border-t border-(--color-rule) pt-3">
          {rest.map((row, index) => (
            <li key={row.id} className="flex items-baseline gap-3">
              <span className="u-mono w-5 text-[11px] text-(--color-dim)">{index + 4}</span>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
              <span className="u-narrow flex-1 text-[14px] uppercase">{row.name}</span>
              <span className="u-mono text-[11px] text-(--color-dim)">
                {row.finished ? formatFinish(row.finishTime) : t('results.dnf')}
              </span>
            </li>
          ))}
        </ol>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-(--color-rule) pt-3">
        <Stat label={t('results.duration')} value={`${metrics.duration.toFixed(1)} s`} />
        <Stat label={t('results.margin')} value={`${metrics.finishMargin.toFixed(2)} s`} />
        <Stat label={t('results.changes')} value={String(metrics.leadChanges)} />
      </dl>

      <button
        type="button"
        className="mt-4 flex w-full items-center justify-between border-y border-(--color-rule) py-2.5 text-left"
        onClick={onToggleAutoNext}
        aria-pressed={autoNext}
      >
        <span className="u-label">{t('action.autoNext')}</span>
        <span
          className="u-mono text-right text-[12px]"
          style={{ color: autoNext ? 'var(--leader)' : undefined }}
        >
          {autoNextRemaining !== null
            ? t('action.autoNextIn', { seconds: autoNextRemaining })
            : autoNext
              ? t('action.autoNextOn')
              : t('action.autoNextOff')}
        </span>
      </button>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary flex-1" onClick={onExport} disabled={busy}>
          {t('action.export')}
        </button>
        <button type="button" className="btn" onClick={onReplay} disabled={busy}>
          {t('action.replay')}
        </button>
        <button type="button" className="btn" onClick={onNewRace} disabled={busy}>
          {t('action.newShort')}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <dt className="u-label">{label}</dt>
      <dd className="u-mono mt-0.5 text-[15px]">{value}</dd>
    </div>
  );
}
