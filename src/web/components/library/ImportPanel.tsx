import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ImportItem, ImportPreview, ImportResult, ImportRow } from '../../../shared/types.ts'
import { apiPost } from '../../lib/api.ts'
import { invalidateCollection } from '../../lib/collection.ts'
import { plural } from '../../lib/format.ts'
import { importItems } from '../../lib/import-items.ts'
import { useToast } from '../../lib/toast.tsx'

/** Rows listed per group; the rest are counted. */
const SHOWN_ROWS = 200

/** CSV import (spec §5.3): choose or paste a file, preview how its rows resolve, then add them to the library. */
export function ImportPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [includeAmbiguous, setIncludeAmbiguous] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const preview = useMutation({
    mutationFn: (csv: string) => apiPost<ImportPreview>('/api/collection/import/preview', { csv }),
    // Each file gets its own choice about guessed printings.
    onMutate: () => setIncludeAmbiguous(true),
  })
  const commit = useMutation({
    mutationFn: (items: ImportItem[]) => apiPost<ImportResult>('/api/collection/import', { items }),
    onSuccess: (result) => {
      invalidateCollection(queryClient)
      toast.success(`Added ${plural(result.copies, 'copy', 'copies')} to your library.`)
      onClose()
    },
    onError: (err) => toast.error(`Import failed; nothing was added. ${err.message}`),
  })

  async function chooseFile(file: File) {
    let content: string
    try {
      content = await file.text()
    } catch (err) {
      setFileName(null)
      preview.reset()
      setReadError(`Couldn't read ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    setReadError(null)
    setFileName(file.name)
    setText(content)
    preview.mutate(content)
  }

  function runPreview() {
    setReadError(null)
    preview.mutate(text)
  }

  const error = readError ?? preview.error?.message

  const result = preview.data
  const selection = result ? importItems(result, includeAmbiguous) : null
  const groups = result ? groupRows(result.rows) : null

  return (
    <section aria-labelledby="import-heading" className="space-y-4 rounded-xl border border-stone-800 bg-stone-900/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="import-heading" className="text-lg font-semibold text-stone-100">
            Import a CSV
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-stone-400">
            Adds the file's cards to your library; it doesn't replace what's already there. Works with exports from
            Moxfield, Deckbox, ManaBox, Archidekt, TCGplayer, and Dragon Shield, or any CSV with Count and Name columns
            (add Edition and Collector Number to pin the printing).
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded px-2 py-1 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-100">
          Close ✕
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <label className="cursor-pointer rounded-md border border-stone-700 px-3 py-2 text-sm text-stone-200 focus-within:ring-2 focus-within:ring-amber-500/40 hover:bg-stone-800 has-disabled:cursor-default has-disabled:opacity-50">
          {fileName ? `File: ${fileName}` : 'Choose a file…'}
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            // While the rows are being added, what's being added stays as it is.
            disabled={commit.isPending}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Cleared so choosing the same file again (say, after editing it) reads it afresh.
              e.target.value = ''
              if (file) void chooseFile(file)
            }}
          />
        </label>
        <textarea
          aria-label="Or paste CSV text"
          placeholder={'…or paste CSV text here, e.g.\nCount,Name,Edition,Collector Number,Foil\n4,Lightning Bolt,m10,146,'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setFileName(null)
            setReadError(null)
            preview.reset()
          }}
          rows={4}
          spellCheck={false}
          readOnly={commit.isPending}
          className="min-w-72 flex-1 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-xs text-stone-100 placeholder:text-stone-600"
        />
        <button
          onClick={runPreview}
          disabled={text.trim() === '' || preview.isPending || commit.isPending}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {preview.isPending ? 'Reading…' : 'Preview'}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      {result && groups && selection && (
        <div className="space-y-3">
          <p className="text-sm text-stone-300" aria-live="polite">
            {plural(result.rows.length, 'row')}: {result.counts.resolved.toLocaleString()} matched,{' '}
            {result.counts.ambiguous.toLocaleString()} with a guessed printing, {result.counts.unresolved.toLocaleString()} not found.
          </p>
          <RowGroup title="Not found (won't be added)" rows={groups.unresolved} open />
          <RowGroup title="Printing guessed" rows={groups.ambiguous} open={groups.unresolved.length === 0} />
          <RowGroup title="Matched" rows={groups.resolved} />
          {result.counts.ambiguous > 0 && (
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input type="checkbox" checked={includeAmbiguous} onChange={(e) => setIncludeAmbiguous(e.target.checked)} />
              Also add the {plural(result.counts.ambiguous, 'row')} with a guessed printing
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => commit.mutate(selection.items)}
              disabled={selection.items.length === 0 || commit.isPending}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {commit.isPending ? 'Adding…' : `Add ${plural(selection.copies, 'copy', 'copies')}`}
            </button>
            <button onClick={onClose} className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 hover:bg-stone-800">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function groupRows(rows: ImportRow[]): Record<ImportRow['status'], ImportRow[]> {
  const groups: Record<ImportRow['status'], ImportRow[]> = { resolved: [], ambiguous: [], unresolved: [] }
  for (const row of rows) groups[row.status].push(row)
  return groups
}

function RowGroup({ title, rows, open = false }: { title: string; rows: ImportRow[]; open?: boolean }) {
  if (rows.length === 0) return null
  return (
    <details open={open} className="rounded-lg border border-stone-800">
      <summary className="cursor-pointer px-3 py-2 text-sm text-stone-200">
        {title} ({rows.length.toLocaleString()})
      </summary>
      <div className="max-h-80 overflow-auto border-t border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-stone-900 text-stone-400">
            <tr>
              <th className="px-3 py-1.5 font-medium">Line</th>
              <th className="px-3 py-1.5 font-medium">In the file</th>
              <th className="px-3 py-1.5 font-medium">Adds</th>
              <th className="px-3 py-1.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/70 text-stone-300">
            {rows.slice(0, SHOWN_ROWS).map((row) => (
              <tr key={row.line}>
                <td className="px-3 py-1.5 text-stone-500 tabular-nums">{row.line}</td>
                <td className="px-3 py-1.5">
                  {row.input.name || '—'}
                  {(row.input.set || row.input.collectorNumber) && (
                    <span className="text-stone-500">
                      {' '}
                      {row.input.set} {row.input.collectorNumber && `#${row.input.collectorNumber}`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {row.card ? (
                    <>
                      {row.quantity}× {row.card.name}{' '}
                      <span className="text-stone-500 uppercase">
                        {row.card.setCode} #{row.card.collectorNumber}
                      </span>
                      {row.finish !== 'nonfoil' && <span className="ml-1 text-amber-300">{row.finish}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-1.5 text-stone-400">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > SHOWN_ROWS && (
          <p className="px-3 py-2 text-xs text-stone-500">…and {(rows.length - SHOWN_ROWS).toLocaleString()} more</p>
        )}
      </div>
    </details>
  )
}
