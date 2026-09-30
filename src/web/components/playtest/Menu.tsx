import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; hint?: string } | 'separator'

export interface MenuState {
  x: number
  y: number
  title: string
  items: MenuItem[]
}

/**
 * A right-click menu at the pointer, kept inside the window. A click or right-click outside it, Escape, or choosing an
 * item closes it. Arrow keys move between its items.
 */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState({ left: menu.x, top: menu.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    // Kept on the window; a menu taller than it scrolls (a card with several kinds of counter has a long one).
    setSpot({ left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)) })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <>
      {/*
        Behind the menu and over the table, so a click or right-click outside the menu only closes it: it never
        reaches a card (a tap), a library (a draw), or another menu. A right-click (or Control-click) closes on its
        contextmenu, which must land here too, so its pointerdown leaves the backdrop in place.
      */}
      <div
        aria-hidden
        onPointerDown={(e) => {
          if (e.button === 0 && !e.ctrlKey) onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
        className="fixed inset-0 z-50"
      />
      <div
        ref={ref}
        role="menu"
        aria-label={menu.title}
        style={spot}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed z-50 max-h-[calc(100dvh-16px)] min-w-52 overflow-y-auto rounded-lg border border-stone-700 bg-stone-900 py-1 text-sm shadow-2xl shadow-black/60"
      >
        <div className="truncate px-3 pt-1 pb-1.5 text-xs text-stone-500">{menu.title}</div>
        {menu.items.map((item, i) =>
          item === 'separator' ? (
            <div key={i} className="my-1 border-t border-stone-800" />
          ) : (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
              className="flex w-full items-baseline justify-between gap-4 px-3 py-1 text-left text-stone-200 outline-none hover:bg-stone-800 focus:bg-stone-800 disabled:text-stone-600 disabled:hover:bg-transparent"
            >
              <span>{item.label}</span>
              {item.hint && <kbd className="font-mono text-xs text-stone-500">{item.hint}</kbd>}
            </button>
          ),
        )}
      </div>
    </>
  )
}

/**
 * A modal dialog: Escape or a click outside closes it. Focus starts on its default (the element marked
 * `data-autofocus`), or else its first field or button.
 */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    // Two lookups, not one list of selectors: one list finds whichever comes first on the page, not the default.
    const section = ref.current
    const first =
      section?.querySelector<HTMLElement>('[data-autofocus]') ??
      section?.querySelector<HTMLElement>('input, select, button:not([aria-label="Close"])')
    first?.focus()
    return () => opener?.focus()
  }, [opener])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative max-h-[90dvh] w-full overflow-auto rounded-xl border border-stone-800 bg-stone-950 p-5 shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-md'}`}
      >
        <h2 className="mb-4 font-serif text-xl text-stone-50">{title}</h2>
        {children}
      </section>
    </div>
  )
}
