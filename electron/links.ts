/** Whether a URL is one of Binder's own pages, which stay in the window. */
export function isAppUrl(url: string, appUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(appUrl).origin
  } catch {
    return false
  }
}

/**
 * Whether a page may use a permission: only Binder's own pages, for the Scan page's camera and the Copy buttons. A
 * `media` request that asks for the microphone (its `mediaTypes`) is refused: no page needs it.
 */
export function permissionAllowed(
  permission: string,
  url: string | undefined,
  appUrl: string | null,
  mediaTypes: readonly string[] = [],
): boolean {
  if (appUrl === null || url === undefined || !isAppUrl(url, appUrl)) return false
  if (permission === 'media') return !mediaTypes.includes('audio')
  return permission === 'clipboard-sanitized-write'
}

/** The URL to open in the browser: a web link (Scryfall, a store, a link in Claude's answer), and nothing else. */
export function externalUrl(url: string): string | null {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : null
  } catch {
    return null
  }
}
