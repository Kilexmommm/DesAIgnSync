/**
 * Element picker injected into the inspected page (DS-012).
 *
 * IMPORTANT: this function is serialized by `chrome.scripting.executeScript({ func })`, so it must
 * be completely self-contained — it cannot reference module-scope helpers or imports.
 *
 * Read-only guarantee: it only appends its own overlay and hint bubble, never touches the app's
 * elements, and removes everything it added before resolving.
 */

export interface PickerPayload {
  selector: string;
  tagName: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  url: string;
  role?: string;
  accessibleName?: string;
  textHint?: string;
}

export interface PickerOptions {
  timeoutMs?: number;
}

export function pickElementInPage(options: PickerOptions = {}): Promise<PickerPayload | null> {
  const OVERLAY_ID = 'desaignsync-picker-overlay';
  const HINT_ID = 'desaignsync-picker-hint';
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 60_000;

  return new Promise<PickerPayload | null>((resolve) => {
    const doc = document;
    const previous = doc.getElementById(OVERLAY_ID);
    if (previous) previous.remove();
    const previousHint = doc.getElementById(HINT_ID);
    if (previousHint) previousHint.remove();

    const overlay = doc.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'border:2px solid #2563eb',
      'background:rgba(37,99,235,0.12)',
      'border-radius:2px',
      'transition:all 40ms linear'
    ].join(';');

    const hint = doc.createElement('div');
    hint.id = HINT_ID;
    hint.setAttribute('aria-hidden', 'true');
    hint.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'font:12px/1.4 system-ui,-apple-system,sans-serif',
      'background:#111827',
      'color:#ffffff',
      'padding:2px 6px',
      'border-radius:4px',
      'white-space:nowrap'
    ].join(';');

    doc.documentElement.appendChild(overlay);
    doc.documentElement.appendChild(hint);

    let current: Element | null = null;
    let settled = false;

    const describe = (element: Element): string => {
      const label = element.getAttribute('aria-label');
      const text = (element.textContent ?? '').trim();
      const name = label && label.trim() !== '' ? label.trim() : text;
      const role = element.getAttribute('role');
      const parts = [element.tagName.toLowerCase()];
      if (role) parts.push(`[role=${role}]`);
      if (name) parts.push(`"${name.slice(0, 60)}"`);
      return parts.join(' ');
    };

    const selectorFor = (element: Element): string => {
      if (element.id) return `#${element.id}`;
      const parts: string[] = [];
      let node: Element | null = element;
      let depth = 0;
      while (node && node !== doc.body && depth < 6) {
        const tag = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(
            (child) => child.tagName === node?.tagName
          );
          parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
        } else {
          parts.unshift(tag);
        }
        node = parent;
        depth += 1;
      }
      return parts.length > 0 ? parts.join(' > ') : element.tagName.toLowerCase();
    };

    const highlight = (element: Element | null): void => {
      if (!element) return;
      current = element;
      const rect = element.getBoundingClientRect();
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      hint.textContent = describe(element);
      const hintTop = rect.top > 24 ? rect.top - 22 : rect.bottom + 4;
      hint.style.top = `${Math.max(0, hintTop)}px`;
      hint.style.left = `${Math.max(0, rect.left)}px`;
    };

    const cleanup = (): void => {
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
      overlay.remove();
      hint.remove();
    };

    const settle = (payload: PickerPayload | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };

    const onMove = (event: MouseEvent): void => {
      const element = doc.elementFromPoint(event.clientX, event.clientY);
      if (element && element !== overlay && element !== hint) highlight(element);
    };

    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const element = current ?? doc.elementFromPoint(event.clientX, event.clientY);
      if (!element) {
        settle(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      const ariaLabel = element.getAttribute('aria-label');
      const text = (element.textContent ?? '').trim();
      const payload: PickerPayload = {
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        url: doc.location.href
      };
      const role = element.getAttribute('role');
      if (role) payload.role = role;
      if (ariaLabel && ariaLabel.trim() !== '') payload.accessibleName = ariaLabel.trim();
      else if (text !== '') payload.accessibleName = text.slice(0, 200);
      if (text !== '') payload.textHint = text.slice(0, 200);
      settle(payload);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(null);
      }
    };

    const timer = window.setTimeout(() => settle(null), timeoutMs);

    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
    hint.textContent = 'DesAIgnSync: click an element (Esc to cancel)';
  });
}
