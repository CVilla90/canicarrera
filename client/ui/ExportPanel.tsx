import { useState } from 'react';
import type { Capability } from '../export/capabilities.ts';
import { estimateSeconds } from '../export/capabilities.ts';
import { QUALITIES, qualityById, type Quality } from '../export/quality.ts';
import type { ExportProgress, ExportResult } from '../export/exportRace.ts';
import { PRESETS, presetById, type PresetId, type RenderPreset } from '../render/presets.ts';
import { BUDGETS, framesFor, requiresPostFX } from '../render/budget.ts';
import type { Lang, Translate } from '../i18n.ts';
import { formatBytes, formatDuration } from '../lib/format.ts';

export type ExportPhase = 'choose' | 'running' | 'done' | 'error';

/**
 * Choosing and watching an export.
 *
 * Three rules from PLAN §2.4, all visible here:
 *
 *   - **The measured default is the only thing on screen by default.** ~95% of
 *     people never open a settings menu, so the closed state has to be a good
 *     answer on its own, not a prompt to go configure something.
 *   - **Every option stays selectable, with an honest ETA.** Never greyed out.
 *     The downside of picking 4K/Ultra on a weak laptop is a slow export and a
 *     warm device, not a broken one — that is the user's call to make. The one
 *     exception is a preset the GPU genuinely cannot render, which would produce
 *     a black video rather than a slow one.
 *   - **The ETA next to a row is the ETA for picking that row**, computed
 *     against whatever the *other* axis is currently set to. A number that
 *     assumed some other combination would be a lie the moment it mattered.
 */
export function ExportPanel({
  phase,
  capability,
  videoDuration,
  qualityId,
  presetId,
  budgetId,
  auto,
  onSelectQuality,
  onSelectPreset,
  onSelectBudget,
  onResetAuto,
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
  qualityId: string;
  presetId: PresetId;
  budgetId: string;
  auto: boolean;
  onSelectQuality: (id: string) => void;
  onSelectPreset: (id: PresetId) => void;
  onSelectBudget: (id: string) => void;
  onResetAuto: () => void;
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
  const quality = qualityById(qualityId);
  const preset = presetById(presetId);

  /** Seconds for a hypothetical combination, using current selections for the rest. */
  const eta = (q: Quality, p: RenderPreset): number | null =>
    capability ? estimateSeconds(capability, q, p, framesFor(q, videoDuration)) : null;

  const selectedEta = eta(quality, preset);
  const presetAvailable = (p: RenderPreset): boolean =>
    (capability?.postFX ?? true) || !requiresPostFX(p);

  return (
    // Scrolls inside itself rather than growing past the viewport. With the
    // advanced section open this panel is ~740px tall, which is more than a
    // phone has — and the export button lives at the bottom of it. `dvh` rather
    // than `vh` so mobile browser chrome sliding in and out cannot clip it.
    <div className="slab animate-rise max-h-[calc(100dvh-2rem)] w-[min(92vw,430px)] overflow-y-auto overscroll-contain px-5 py-5">
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
          {/* The closed state: one row, the plan, the honest number. */}
          <div className="mt-3 rounded-[3px] border px-3 py-2.5" style={{ borderColor: 'var(--leader)' }}>
            <div className="flex items-baseline gap-2">
              <span className="u-mono text-[15px]">{quality.label}</span>
              <span className="u-mono text-[15px] text-(--color-dim)">·</span>
              <span className="u-mono text-[15px]">{preset.label[lang]}</span>
              <span className="u-mono flex-1 text-right text-[12px] text-(--color-dim)">
                {selectedEta !== null ? `(~${formatDuration(selectedEta, lang)})` : '—'}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-(--color-dim)">
              {auto ? t('export.auto') : t('export.manual')} · {preset.blurb[lang]}
            </p>
          </div>

          <button
            type="button"
            className="u-label mt-3 transition-colors hover:text-(--color-bone)"
            onClick={() => setShowAdvanced((value) => !value)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? '▾' : '▸'} {t('action.advanced')}
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4">
              {/* The budget is the primary control: "how long will you wait" is a
                  question a person can answer, unlike "1440p60 or 1080p60+Ultra". */}
              <section>
                <p className="u-label">{t('export.budget')}</p>
                <div className="mt-1.5 flex gap-1.5">
                  {BUDGETS.map((budget) => (
                    <button
                      key={budget.id}
                      type="button"
                      onClick={() => onSelectBudget(budget.id)}
                      className="u-mono flex-1 rounded-[3px] border px-2 py-1.5 text-[11.5px] transition-colors"
                      style={{
                        borderColor:
                          auto && budget.id === budgetId ? 'var(--leader)' : 'var(--color-rule)',
                        background:
                          auto && budget.id === budgetId
                            ? 'color-mix(in srgb, var(--leader) 8%, transparent)'
                            : 'transparent',
                      }}
                      aria-pressed={auto && budget.id === budgetId}
                    >
                      {budget.label[lang]}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <p className="u-label">{t('export.resolution')}</p>
                <div className="mt-1.5 space-y-1">
                  {QUALITIES.map((option) => (
                    <OptionRow
                      key={option.id}
                      title={option.label}
                      eta={eta(option, preset)}
                      selected={option.id === quality.id}
                      available={capability?.supported.includes(option.id) ?? false}
                      onSelect={() => onSelectQuality(option.id)}
                      lang={lang}
                    />
                  ))}
                </div>
              </section>

              <section>
                <p className="u-label">{t('export.visual')}</p>
                <div className="mt-1.5 space-y-1">
                  {PRESETS.map((option) => (
                    <OptionRow
                      key={option.id}
                      title={option.label[lang]}
                      detail={option.blurb[lang]}
                      eta={eta(quality, option)}
                      selected={option.id === preset.id}
                      available={presetAvailable(option)}
                      lockedNote={t('export.presetLocked')}
                      onSelect={() => onSelectPreset(option.id)}
                      lang={lang}
                    />
                  ))}
                </div>
              </section>

              {!auto && (
                <button
                  type="button"
                  className="u-label underline transition-colors hover:text-(--color-bone)"
                  onClick={onResetAuto}
                >
                  {t('export.backToAuto')}
                </button>
              )}
            </div>
          )}

          {/* Always visible, not tucked under the disclosure: when there is no
              measurement the ETAs above are missing, and the user deserves to
              know why rather than wondering where the numbers went. */}
          <p className="u-mono mt-3 text-[11px] leading-relaxed text-(--color-dim)">
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
            {t('action.export')} · {quality.label} {preset.label[lang]}
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

function OptionRow({
  title,
  detail,
  eta,
  selected,
  available,
  lockedNote,
  onSelect,
  lang,
}: {
  title: string;
  detail?: string;
  eta: number | null;
  selected: boolean;
  available: boolean;
  lockedNote?: string;
  onSelect: () => void;
  lang: Lang;
}): React.ReactElement {
  // "Slow" is relative to the machine we measured, not to a fixed threshold.
  const slow = eta !== null && eta > 90;
  return (
    <button
      type="button"
      onClick={available ? onSelect : undefined}
      disabled={!available}
      title={available ? undefined : lockedNote}
      className="flex w-full flex-col rounded-[3px] border px-3 py-1.5 text-left transition-colors disabled:opacity-40"
      style={{
        borderColor: selected ? 'var(--leader)' : 'var(--color-rule)',
        background: selected ? 'color-mix(in srgb, var(--leader) 8%, transparent)' : 'transparent',
      }}
      aria-pressed={selected}
    >
      <span className="flex w-full items-baseline gap-2">
        <span className="u-mono text-[13px]">{title}</span>
        <span className="u-mono flex-1 text-[11.5px] text-(--color-dim)">
          {eta !== null ? `(~${formatDuration(eta, lang)})` : available ? '—' : ''}
        </span>
        {slow && <span title="⚠">⚠</span>}
      </span>
      {detail && <span className="mt-0.5 text-[11px] leading-snug text-(--color-dim)">{detail}</span>}
    </button>
  );
}
