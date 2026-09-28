import type { ImportItem, ImportPreview } from '../../shared/types.ts'

/** What an import will add: resolved rows, plus ambiguous ones (a guessed printing) when included. */
export function importItems(preview: ImportPreview, includeAmbiguous: boolean): { items: ImportItem[]; copies: number } {
  const items: ImportItem[] = []
  let copies = 0
  for (const row of preview.rows) {
    if (!row.card || row.status === 'unresolved' || (row.status === 'ambiguous' && !includeAmbiguous)) continue
    items.push({ cardId: row.card.id, finish: row.finish, quantity: row.quantity })
    copies += row.quantity
  }
  return { items, copies }
}
