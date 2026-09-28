export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "1 row", "2,345 rows"; pass the plural when it isn't singular + "s" ("copy", "copies"). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`
}

/**
 * A file size: "460 MB", "8.4 MB", "512 KB" (1 MB = 1,000,000 bytes, as Finder counts). Rounded before the unit is
 * chosen, so 999,600 bytes is "1.0 MB" (not "1000 KB") and 9,960,000 is "10 MB" (not "10.0 MB").
 */
export function formatBytes(bytes: number): string {
  const kb = Math.round(bytes / 1000)
  if (kb < 1000) return `${Math.max(bytes === 0 ? 0 : 1, kb)} KB`
  const mbToTenths = Math.round(bytes / 100_000) / 10
  if (mbToTenths < 10) return `${mbToTenths.toFixed(1)} MB`
  return `${Math.round(bytes / 1_000_000).toLocaleString('en-US')} MB`
}
