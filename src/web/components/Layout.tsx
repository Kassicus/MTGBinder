import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useCardDrawer } from '../lib/card-drawer.tsx'
import { createGoTo, shortcutAllowed } from '../lib/shortcuts.ts'
import { useBulkRefresh } from '../lib/use-bulk-status.ts'
import { CardDrawer } from './CardDrawer.tsx'
import { QuickFind } from './QuickFind.tsx'
import { OpenShortcutsContext, ShortcutsDialog } from './ShortcutsDialog.tsx'

/** Top-level navigation. Later milestones append entries here. */
export const NAV: Array<{ to: string; label: string; end: boolean }> = [
  { to: '/', label: 'Look up', end: true },
  { to: '/search', label: 'Search', end: false },
  { to: '/library', label: 'Library', end: false },
  { to: '/sets', label: 'Sets', end: false },
  { to: '/scan', label: 'Scan', end: false },
  { to: '/decks', label: 'Decks', end: false },
  { to: '/brainstorm', label: 'Brainstorm', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export function Layout() {
  useBulkRefresh() // keeps lookups and searches fresh after a card-data refresh, whichever page is open
  const [helpOpen, setHelpOpen] = useState(false)
  const navigate = useNavigate()
  /** Opens the shortcuts list: the header's ? button, and pages through OpenShortcutsContext. */
  const openShortcuts = useCallback(() => setHelpOpen(true), [])
  // While the card drawer or the shortcuts are open, the page behind can't be focused or clicked, so Tab stays there.
  const drawerOpen = useCardDrawer().cardId !== null
  const covered = drawerOpen || helpOpen

  // `?` lists the shortcuts; `g` then a letter goes to a page. The card finder's `/` and the Scan page's keys are
  // their own.
  useEffect(() => {
    const goTo = createGoTo()
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutAllowed(e, document.querySelector('[aria-modal="true"]') !== null)) return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      const path = goTo.press(e.key, performance.now())
      if (path !== null) {
        e.preventDefault()
        void navigate(path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <OpenShortcutsContext value={openShortcuts}>
      <div className="min-h-dvh bg-stone-950 text-stone-200">
        <header inert={covered} className="sticky top-0 z-20 border-b border-stone-800/80 bg-stone-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2.5">
            <NavLink to="/" className="font-serif text-xl font-semibold tracking-wide text-amber-400">
              Binder
            </NavLink>
            <nav className="flex gap-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-stone-800 text-stone-50' : 'text-stone-400 hover:text-stone-100'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto w-full max-w-sm">
              <QuickFind />
            </div>
            <button
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              onClick={openShortcuts}
              className="size-8 shrink-0 rounded-full border border-stone-700 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            >
              ?
            </button>
          </div>
        </header>
        <main inert={covered} className="mx-auto max-w-7xl px-4 py-8">
          <Outlet />
        </main>
        <CardDrawer />
        {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
      </div>
    </OpenShortcutsContext>
  )
}
