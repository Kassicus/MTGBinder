import { useState } from 'react'

/**
 * The message box: Enter sends, Shift+Enter starts a new line. While `running`, Stop replaces Send when there is
 * `onStop`; otherwise Send waits, disabled.
 */
export function Composer({
  onSend,
  onStop,
  running = false,
  disabled = false,
  placeholder = 'Ask Claude…',
}: {
  onSend: (text: string) => void
  onStop?: () => void
  running?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const typed = text.trim()
  function send() {
    if (!typed || running || disabled) return
    onSend(typed)
    setText('')
  }
  return (
    <div className="flex items-end gap-2 rounded-xl border border-stone-700 bg-stone-900 p-2 focus-within:border-amber-500/70">
      <textarea
        aria-label="Message"
        value={text}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
        className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-stone-100 outline-none placeholder:text-stone-500 disabled:opacity-50"
      />
      {running && onStop ? (
        <button onClick={onStop} className="rounded-lg border border-stone-600 px-4 py-2 text-sm text-stone-200 hover:bg-stone-800">
          Stop
        </button>
      ) : (
        <button
          onClick={send}
          disabled={!typed || disabled || running}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          Send
        </button>
      )}
    </div>
  )
}
