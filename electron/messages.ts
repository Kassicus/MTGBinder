/** Why Binder couldn't start, as the app's dialog says it. The server's own lines, but for a port in use. */
export function startupFailure(error: { code: string; message: string }, port: number): string {
  if (error.code === 'port_in_use') {
    return `Port ${port} is already in use: Binder may already be running from the terminal (pnpm start). Quit that one, then open Binder again.`
  }
  return error.message
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The page the window shows while Binder starts, saying what it's doing. */
export function startingPage(status: string): string {
  const html = `<!doctype html><meta charset="utf-8"><title>Binder</title>
<style>
  html, body { height: 100%; margin: 0; background: #0c0a09; color: #e7e5e4; font: 15px -apple-system, system-ui, sans-serif; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; -webkit-user-select: none; }
  h1 { margin: 0; font: 600 28px ui-serif, Georgia, serif; color: #fbbf24; }
  p { margin: 0; color: #a8a29e; }
</style>
<h1>Binder</h1>
<p id="status">${escape(status)}</p>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
