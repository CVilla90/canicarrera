import { useState } from 'react';
import type { Capability } from '../export/capabilities.ts';
import { estimateSeconds } from '../export/capabilities.ts';
import { QUALITIES, qualityById, type Quality } from '../export/quality.ts';
import type { ExportProgress, ExportResult } from '../export/exportRace.ts';
import type { Lang, Translate } from '../i18n.ts';
import { formatBytes, formatDuration } from '../lib/format.ts';

export type ExportPhase = 'choose' | 'running' | 'done' | 'error';

/**
 * Choosing and watching an export.
 *
 * Two rules from PLAN §2.4, both visible here:
 *   - the measured default is the visible choice, everything else is behind a
 *     disclosure, because ~95% of people never open a settings menu;
 *   - options above the measured tier stay SELECTABLE with an honest ETA and a
 *     warning, never disabled. The downside is a slow export and a warm phone,
 *     not a broken one, so it is their call — we just refuse to make it for
 *     them by default.
 */
export function ExportPanel({
  phase,
  capability,
  videoDuration,
  selectedId,
  onSelect,
  progress,
  result,
  error,
  onStart,
  onCancel,
  onClose,
  onRemeasure,
  onDownloadAgain,
  t,
  lang,
}: {
  phase: ExportPhase;
  capability: Capability | null;
  videoDuration: number;
  selectedId: string;
  onSelect: (id: string) => void;
  progress: ExportProgress | null;
  result: ExportResult | null;
  error: string | null;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
  onRemeasure: () => void;
  onDownloadAgain: () => void;
  t: Translate;
  lang: Lang;
}): React.ReactElement {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selected = qualityById(selectedId);
  const recommendedId = capability?.recommended ?? '1080p30';

  const framesFor = (quality: Quality): number => Math.round(videoDuration * quality.fps);
  const etaFor = (quality: Quality): number | null =>
    capability ? estimateSeconds(capability, quality, framesFor(quality)) : null;

  return (
    <div className="slab animate-rise w-[min(92vw,430px)] px-5 py-5">
      <div className="flex items-baseline justify-between">
        <h2 className="u-label">{t('export.title')}</h2>
        {phase !== 'running' && (
          <button
            type="button"
            className="u-label transition-colors hover:text-(--color-bone)"
            onClick={onClose}
          >
            {t('action.close')}
          </button>
        )}
      </div>

      {phase === 'choose' && (
        <>
          <div className="mt-3 space-y-1.5">
            {(showAdvanced ? QUALITIES : QUALITIES.filter((q) => q.id === recommendedId)).map(
              (quality) => (
                <QualityRow
                  key={quality.id}
                  quality={quality}
                  selected={quality.id === selected.id}
                  recommended={quality.id === recommendedId}
                  supported={capability?.supported.includes(quality.id) ?? false}
                  eta={etaFor(quality)}
                  onSelect={() => onSelect(quality.id)}
                  t={t}
                  lang={lang}
                />
              ),
            )}
          </div>

          <button
            type="button"
            className="u-label mt-3 transition-colors hover:text-(--color-bone)"
            onClick={() => setShowAdvanced((value) => !value)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? '▾' : '▸'} {t('action.advanced')}
          </button>

          {/* Always visible, not tucked under the disclosure: when there is no
              measurement the ETAs above are missing, and the user deserves to
              know why rather than wondering where the numbers went. */}
          <p className="u-mono mt-2 text-[11px] leading-relaxed text-(--color-dim)">
            {capability?.benchmark
              ? t('export.measured', { fps: capability.benchmark.pipelineFps.toFixed(1) })
              : t('export.notMeasured')}
            {' · '}
            <button type="button" className="underline hover:text-(--color-bone)" onClick={onRemeasure}>
              {t('action.remeasure')}
            </button>
          </p>

          {capability?.note && (
            <p className="mt-3 text-[12px] leading-relaxed text-(--color-dim)">{capability.note}</p>
          )}

          <button
            type="button"
            className="btn btn-primary mt-4 w-full"
            onClick={onStart}
            disabled={!capability?.webCodecs}
          >
            {t('action.export')} · {selected.label}
          </button>
          <p className="u-label mt-2 text-center">{t('export.keepVisible')}</p>
        </>
      )}

      {phase === 'running' && progress && (
        <div className="mt-4">
          <div className="u-mono flex items-baseline justify-between text-[12px]">
            <span>
              {progress.phase === 'preparing'
                ? t('export.preparing')
                : progress.phase === 'finishing'
                  ? t('export.finishing')
                  : t('export.frames', { frame: progress.frame, total: progress.totalFrames })}
            </span>
            <span className="text-(--color-dim)">
              {progress.secondsLeft !== null && progress.phase === 'rendering'
                ? t('export.eta', { seconds: formatDuration(progress.secondsLeft, lang) })
                : ''}
            </span>
          </div>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full transition-[width] duration-150"
              style={{
                width: `${(progress.frame / Math.max(progress.totalFrames, 1)) * 100}%`,
                background: 'var(--leader)',
              }}
            />
          </div>

          <p className="u-mono mt-2 text-[11px] text-(--color-dim)">
            {t('export.rate', { fps: progress.fps.toFixed(1) })}
            {progress.queuePressure > 0.6 ? ' · buffer lleno, esperando al codificador' : ''}
          </p>
          <p className="u-label mt-3">{t('export.keepVisible')}</p>

          <button type="button" className="btn mt-4 w-full" onClick={onCancel}>
            {t('action.cancel')}
          </button>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="mt-4">
          <p className="u-narrow text-[22px] font-bold uppercase" style={{ color: 'var(--leader)' }}>
            {t('export.done')}
          </p>
          <p className="u-mono mt-1 text-[12px] text-(--color-dim)">
            {t('export.doneDetail', {
              frames: result.frames,
              seconds: formatDuration(result.elapsedMs / 1000, lang),
              size: formatBytes(result.blob.size),
            })}
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn flex-1" onClick={onDownloadAgain}>
              {t('action.export')}
            </button>
            <button type="button" className="btn btn-primary flex-1" onClick={onClose}>
              {t('action.close')}
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="mt-4">
          <p className="u-narrow text-[18px] font-bold uppercase">{t('error.title')}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-(--color-dim)">{error}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn btn-primary flex-1" onClick={onStart}>
              {t('error.retry')}
            </button>
            <button type="button" className="btn flex-1" onClick={onClose}>
              {t('action.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QualityRow({
  quality,
  selected,
  recommended,
  supported,
  eta,
  onSelect,
  t,
  lang,
}: {
  quality: Quality;
  selected: boolean;
  recommended: boolean;
  supported: boolean;
  eta: number | null;
  onSelect: () => void;
  t: Translate;
  lang: Lang;
}): React.ReactElement {
  // "Slow" is relative to the machine we measured, not to a fixed threshold.
  const slow = eta !== null && eta > 90;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-baseline gap-3 rounded-[3px] border px-3 py-2 text-left transition-colors"
      style={{
        borderColor: selected ? 'var(--leader)' : 'var(--color-rule)',
        background: selected ? 'color-mix(in srgb, var(--leader) 8%, transparent)' : 'transparent',
      }}
      aria-pressed={selected}
    >
      <span className="u-mono text-[14px]">{quality.label}</span>
      <span className="u-mono flex-1 text-[12px] text-(--color-dim)">
        {eta !== null ? `~${formatDuration(eta, lang)}` : supported ? '—' : ''}
      </span>
      {recommended && <span className="u-label">{t('export.recommended')}</span>}
      {slow && <span title={t('export.warmDevice')}>⚠</span>}
    </button>
  );
}
