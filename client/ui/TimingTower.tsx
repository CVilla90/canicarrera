import { useState } from 'react';

import type { SceneSnapshot } from '../scene/RaceScene.ts';
import type { Translate } from '../i18n.ts';
import { formatFinish } from '../lib/format.ts';

/**
 * The timing tower.
 *
 * Condensed type because the column is narrow — that is what condensed faces
 * are for, and it is why real broadcast timing graphics all look like this. The
 * bar under each row is position along the track, not a decoration.
 *
 * ## Collapsed on a phone, and why that is the default
 *
 * Eight rows is about 240 px tall. On a laptop that is a strip down one side of
 * a wide frame; on a phone held upright it is a third of the screen, permanently
 * covering the race it is reporting on. Worse, the interesting part of a marble
 * race is the *front* — a viewer glancing at their phone wants to know who is
 * winning, not where the eighth-placed marble is.
 *
 * So the default follows the viewport: full list where there is room, leader
 * only where there is not, and one tap either way. The toggle is always present,
 * because "collapsed by default" and "collapsible" are different promises and
 * someone on a phone who *does* want all eight is entitled to them.
 */
export function TimingTower({
  snapshot,
  t,
}: {
  snapshot: SceneSnapshot;
  t: Translate;
}): React.ReactElement {
  // Read once, from the viewport, at mount. Deliberately not a live media query:
  // rotating a phone mid-race should not throw away a choice the user made, and
  // on iOS the URL bar sliding away fires resize constantly.
  const [open, setOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 640,
  );

  const rows = open ? snapshot.standings : snapshot.standings.slice(0, 1);
  const hidden = snapshot.standings.length - rows.length;

  return (
    // Narrower while collapsed. At 390 px the wordmark and this panel are the
    // only two things on the top row, and 150 px left them overlapping by about
    // twenty pixels — measured in a 390 px iframe, which is the only way to see
    // mobile layout in this project's automation browser.
    <div
      className={`slab slab-quiet overflow-hidden sm:w-[196px] ${open ? 'w-[142px]' : 'w-[108px]'}`}
    >
      <ol
        className="scroll-thin max-h-[min(46vh,260px)] overflow-y-auto py-1"
        aria-label={t('results.title')}
      >
        {rows.map((row, index) => (
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
            {/* During the race the position bar carries progress without
                covering the view with eight constantly-changing percentages.
                Once a marble finishes, its time is useful race information and
                earns the third column. */}
            {row.finished && (
              <span className="u-mono text-[10px] text-(--color-flag)">
                {formatFinish(row.finishTime)}
              </span>
            )}
            <span
              className="tower-bar"
              style={{ width: `${Math.max(row.progress * 100, 1.5)}%`, background: row.color }}
            />
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="u-label flex w-full items-center justify-center gap-1.5 border-t border-(--color-rule) py-1.5 transition-colors hover:text-(--color-bone)"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {/* The count is the point of the collapsed state: it says there is more
            without spending the space to show it. */}
        <span>{open ? '▴' : `▾ +${hidden}`}</span>
      </button>
    </div>
  );
}
