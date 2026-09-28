import type { ReactNode } from 'react'
import type { CardSummary } from '../../../shared/types.ts'
import { apiGet, ApiRequestError } from '../../lib/api.ts'
import { useCardDrawer } from '../../lib/card-drawer.tsx'
import { parseMarkdown, type Block, type Inline } from '../../lib/markdown.ts'
import { useToast } from '../../lib/toast.tsx'
import { ManaText } from '../ManaText.tsx'

/** A [[card]] name Claude wrote: opens that card's drawer. */
function CardLink({ name }: { name: string }) {
  const drawer = useCardDrawer()
  const toast = useToast()
  async function open() {
    try {
      const card = await apiGet<CardSummary>(`/api/cards/named?name=${encodeURIComponent(name)}`)
      drawer.open(card.cardId)
    } catch (err) {
      toast.error(err instanceof ApiRequestError && err.status === 404 ? `No card is named ${name}` : `Couldn't open ${name}`)
    }
  }
  return (
    <button onClick={() => void open()} className="font-medium text-amber-300 decoration-amber-300/40 hover:underline">
      {name}
    </button>
  )
}

function inlines(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return <ManaText key={i} text={node.text} />
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-stone-50">
            {inlines(node.children)}
          </strong>
        )
      case 'em':
        return <em key={i}>{inlines(node.children)}</em>
      case 'code':
        return (
          <code key={i} className="rounded bg-stone-800 px-1 py-0.5 font-mono text-[0.85em] text-stone-100">
            {node.text}
          </code>
        )
      case 'card':
        return <CardLink key={i} name={node.name} />
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noreferrer" className="text-amber-300 underline decoration-amber-300/40">
            {inlines(node.children)}
          </a>
        )
    }
  })
}

const HEADING_CLASS = ['text-lg', 'text-base', 'text-sm']

function block(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case 'paragraph':
      return (
        <p key={i} className="whitespace-pre-line">
          {inlines(b.content)}
        </p>
      )
    case 'heading':
      return (
        <p key={i} role="heading" aria-level={Math.min(b.level + 2, 6)} className={`font-semibold text-stone-50 ${HEADING_CLASS[Math.min(b.level, 3) - 1]}`}>
          {inlines(b.content)}
        </p>
      )
    case 'list': {
      const items = b.items.map((item, j) => <li key={j}>{inlines(item)}</li>)
      return b.ordered ? (
        <ol key={i} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={i} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      )
    }
    case 'code':
      return (
        <pre key={i} className="overflow-x-auto rounded-md bg-stone-900 p-3 font-mono text-xs text-stone-200">
          {b.text}
        </pre>
      )
    case 'table':
      return (
        <div key={i} className="overflow-x-auto">
          <table className="text-left text-sm">
            <thead className="border-b border-stone-700 text-stone-400">
              <tr>
                {b.head.map((cell, j) => (
                  <th key={j} className="px-2 py-1 font-medium">
                    {inlines(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800">
              {b.rows.map((row, j) => (
                <tr key={j}>
                  {row.map((cell, k) => (
                    <td key={k} className="px-2 py-1 align-top">
                      {inlines(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr key={i} className="border-stone-800" />
  }
}

/** Claude's Markdown, with [[card]] links that open the card, and mana symbols as icons. */
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-3 leading-relaxed wrap-break-word">{parseMarkdown(text).map(block)}</div>
}
