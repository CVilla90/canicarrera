/** Race clock: seconds under a minute, m:ss.d above. Always tabular width. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  if (safe < 60) return safe.toFixed(1);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** Finish times want two decimals — hundredths decide races. */
export function formatFinish(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(2)}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** Human duration for ETAs. Rounded honestly — never optimistically. */
export function formatDuration(seconds: number, lang: 'es' | 'en' = 'es'): string {
  const safe = Math.max(0, Math.ceil(seconds));
  if (safe < 60) return `${safe} s`;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  if (rest === 0) return `${minutes} min`;
  return lang === 'es' ? `${minutes} min ${rest} s` : `${minutes}m ${rest}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
