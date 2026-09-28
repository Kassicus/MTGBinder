import { useState, type ReactNode } from 'react'

const SYMBOL = /\{([^}]+)\}/g

/** Scryfall's SVG for a mana/tap symbol: {W/U} → WU.svg, {2/W} → 2W.svg, {T} → T.svg. */
export function symbolUrl(symbol: string): string {
  return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(symbol.replace(/\//g, '').toUpperCase())}.svg`
}

function ManaSymbol({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="font-mono text-xs">{`{${symbol}}`}</span>
  return (
    <img
      src={symbolUrl(symbol)}
      alt={`{${symbol}}`}
      title={`{${symbol}}`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="mx-px inline-block h-[1em] w-[1em] align-[-0.125em]"
    />
  )
}

/** Renders text with every `{…}` symbol replaced by its icon (falls back to the text if the icon fails). */
export function ManaText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(SYMBOL)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    // Keyed by position and symbol, so a failed-image fallback never carries over to a different symbol.
    parts.push(<ManaSymbol key={`${match.index}:${match[1]}`} symbol={match[1] ?? ''} />)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className={className}>{parts}</span>
}
