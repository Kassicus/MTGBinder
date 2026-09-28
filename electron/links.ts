/** Whether a URL is one of Binder's own pages, which stay in the window. */
export function isAppUrl(url: string, appUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(appUrl).origin
  } catch {
    return false
  }
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
