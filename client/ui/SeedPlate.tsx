import { useEffect, useRef, useState } from 'react';
import type { Translate } from '../i18n.ts';

/**
 * The seed, treated as a race number rather than a debug string.
 *
 * Every race is reachable by its seed, so this is the share mechanism and the
 * "give me that race again" mechanism at once. Typing anything works —
 * "cumpleaños de ana" is a valid seed — because rejecting input here would be
 * pure pedantry.
 */
export function SeedPlate({
  seed,
  onUseSeed,
  onCopyLink,
  copied,
  t,
  busy,
}: {
  seed: string;
  onUseSeed: (seed: string) => void;
  onCopyLink: () => void;
  copied: boolean;
  t: Translate;
  busy: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(seed);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(seed);
  }, [seed]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const cleaned = draft.trim();
    if (cleaned && cleaned.toUpperCase() !== seed.toUpperCase()) onUseSeed(cleaned);
  };

  return (
    <div className="slab slab-quiet flex items-center gap-3 px-3 py-2">
      <span className="u-label shrink-0">{t('hud.seed')}</span>
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <input
            ref={inputRef}
            className="input-seed w-[168px]"
            value={draft}
            maxLength={32}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(seed);
                setEditing(false);
              }
            }}
            aria-label={t('action.useSeed')}
          />
          <button type="submit" className="btn btn-ghost px-3 py-2 text-[11px]" disabled={busy}>
            {t('action.useSeed')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="u-mono text-[15px] tracking-[0.2em] transition-colors hover:text-(--leader)"
          onClick={() => setEditing(true)}
          title={t('action.useSeed')}
        >
          {seed}
        </button>
      )}
      <button
        type="button"
        className="u-label shrink-0 border-l border-(--color-rule) pl-3 transition-colors hover:text-(--color-bone)"
        onClick={onCopyLink}
      >
        {copied ? t('action.copied') : t('action.copyLink')}
      </button>
    </div>
  );
}
