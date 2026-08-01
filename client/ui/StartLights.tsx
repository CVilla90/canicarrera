import { COUNTDOWN } from '@shared/sim.ts';
import type { Translate } from '../i18n.ts';

const LIGHTS = 5;

/**
 * Five lights on, then all out — the signal a racing audience already knows,
 * and a better opening beat than a "3 2 1" counter. The lights going dark IS
 * the start; nothing else needs to say so.
 */
export function StartLights({
  countdownLeft,
  racing,
  raceTime,
  t,
}: {
  countdownLeft: number;
  racing: boolean;
  raceTime: number;
  t: Translate;
}): React.ReactElement | null {
  const showGo = racing && raceTime < 1.1;
  if (countdownLeft <= 0 && !showGo) return null;

  const elapsed = COUNTDOWN - countdownLeft;
  const lit = Math.min(LIGHTS, Math.floor(elapsed / (COUNTDOWN / (LIGHTS + 1))));

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[22%] z-20 flex flex-col items-center gap-6">
      <div className="flex gap-3 sm:gap-4" role="status" aria-label={t('lights.go')}>
        {Array.from({ length: LIGHTS }, (_, i) => (
          <span
            key={i}
            className={`light w-9 sm:w-12 ${showGo ? 'light-go' : i < lit ? 'light-on' : ''}`}
          />
        ))}
      </div>
      {showGo && (
        <div
          className="u-wide animate-rise text-4xl font-extrabold italic sm:text-6xl"
          style={{ textShadow: '0 4px 30px rgba(0,0,0,0.7)' }}
        >
          {t('lights.go')}
        </div>
      )}
    </div>
  );
}
