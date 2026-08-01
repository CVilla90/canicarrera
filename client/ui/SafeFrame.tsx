/**
 * The title-safe area a broadcast camera frames to.
 *
 * It is the page's only structural decoration, and it earns its place twice:
 * it makes the canvas read as a shot rather than a background, and it is
 * exactly the region the exported video covers.
 */
export function SafeFrame(): React.ReactElement {
  return (
    <div className="safe-frame" aria-hidden="true">
      <span className="safe-tick border-l border-t" style={{ top: 0, left: 0 }} />
      <span className="safe-tick border-r border-t" style={{ top: 0, right: 0 }} />
      <span className="safe-tick border-l border-b" style={{ bottom: 0, left: 0 }} />
      <span className="safe-tick border-r border-b" style={{ bottom: 0, right: 0 }} />
    </div>
  );
}
