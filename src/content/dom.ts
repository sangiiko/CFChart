/** Keep the viewed profile separate from a verified signed-in viewer. */
export function profileHandle(pathname: string): string | null {
  const match = pathname.match(/^\/profile\/([a-zA-Z0-9_.-]+)\/?$/i);
  return match?.[1] ?? null;
}
export function viewerHandle(document: Document): string | null {
  const header = document.querySelector('#header .lang-chooser');
  if (!header) return null;
  const links = Array.from(header.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const hasLogout = links.some(link => { try { return new URL(link.href, document.baseURI).pathname === '/logout'; } catch { return false; } });
  if (!hasLogout) return null;
  for (const link of links) {
    try {
      const url = new URL(link.href, document.baseURI);
      if (url.origin !== new URL(document.baseURI).origin) continue;
      const handle = profileHandle(url.pathname);
      if (handle) return handle;
    } catch { /* A malformed host link is not an account identity. */ }
  }
  return null;
}
export function headerAnchor(document: Document): Element | null {
  return document.querySelector('#header .lang-chooser') || document.querySelector('#header');
}
/** Only native rating graph markers qualify; generic .roundbox elements do not. */
export function ratingGraph(document: Document): HTMLElement | null {
  const holder = document.querySelector<HTMLElement>('#userRatingGraphHolder, .userRatingGraphHolder');
  if (holder) return holder;
  const placeholder = document.getElementById('placeholder') || document.querySelector<HTMLElement>('#pageContent #placeholder, #placeholder');
  if (!placeholder) return null;
  const wrapper = placeholder.closest<HTMLElement>('.roundbox');
  if (wrapper && wrapper.id !== 'pageContent' && !wrapper.querySelector('.userbox, #userActivityGraph')) return wrapper;
  const parent = placeholder.parentElement;
  return parent && parent.id !== 'pageContent' && !parent.querySelector('.userbox, #userActivityGraph') ? parent : placeholder;
}
export function profileAnchor(document: Document): HTMLElement | null {
  return document.querySelector<HTMLElement>('#pageContent .userbox') || document.querySelector<HTMLElement>('#pageContent');
}

export function preserveNativeGraph(element: HTMLElement) {
  const display = element.style.getPropertyValue('display');
  const priority = element.style.getPropertyPriority('display');
  let concealed = false;
  return {
    element,
    setVisible(visible: boolean) {
      if (visible) {
        if (concealed) {
          if (display) element.style.setProperty('display', display, priority);
          else element.style.removeProperty('display');
          concealed = false;
          element.dispatchEvent(new Event('resize'));
          element.ownerDocument.defaultView?.dispatchEvent(new Event('resize'));
        }
      } else { element.style.setProperty('display', 'none', 'important'); concealed = true; }
    },
    restore() {
      if (concealed) {
        if (display) element.style.setProperty('display', display, priority);
        else element.style.removeProperty('display');
        concealed = false;
      }
    },
  };
}

export function parseProblemPath(pathname: string): { contestId: number; index: string } | null {
  const match = pathname.match(/(?:problemset\/problem|contest|gym)\/(\d+)\/problem\/([a-zA-Z0-9]+)/i)
    || pathname.match(/\/problemset\/problem\/(\d+)\/([a-zA-Z0-9]+)/i);
  if (!match) return null;
  return { contestId: Number(match[1]), index: match[2].toUpperCase() };
}

export function problemHeaderAnchor(document: Document): HTMLElement | null {
  return document.querySelector<HTMLElement>('.problem-statement .header .title')
    || document.querySelector<HTMLElement>('.problem-statement .header');
}

export function hasAcceptedVerdictInPage(document: Document): boolean {
  const content = document.querySelector('#pageContent');
  if (content) {
    if (content.querySelector('.verdict-accepted')) return true;
    const verdictElements = content.querySelectorAll('span.verdict-accepted, td.status-verdict-cell, td.status-cell');
    for (const el of verdictElements) {
      if (el.textContent?.includes('Accepted')) return true;
    }
  }
  return false;
}
