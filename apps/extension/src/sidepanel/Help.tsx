/**
 * Inline help marker (DS-028): a small "?" that shows its explanation on hover/focus.
 * Native `title` keeps it dependency-free and accessible; the text lives next to the section it explains.
 */
export function Help({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="ds-help" title={text} aria-label={text} role="note">
      ?
    </span>
  );
}
