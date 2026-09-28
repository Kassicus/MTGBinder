import type Anthropic from '@anthropic-ai/sdk'
import type { ThreadSummary } from '../../shared/types.ts'
import type { DB } from '../db/index.ts'

export type ContentBlock = Anthropic.Beta.BetaContentBlockParam

/** What Binder records about an assistant message besides its content. */
export interface MessageMeta {
  /** The model that wrote it: Claude Opus 5.5, or the model a refusal fell back to. */
  model: string
  /**
   * Why it ended: the API's stop reason, or `stopped` when the owner stopped it (keeping the text so far). A `refusal`
   * message has no content and, with the question before it, is left out of what Claude sees later.
   */
  stopReason: string
  usage: Anthropic.Beta.BetaUsage | null
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: ContentBlock[]
  meta: MessageMeta | null
  createdAt: string
}

export interface NewMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
  meta?: MessageMeta
}

interface ThreadRow {
  id: number
  title: string
  deck_id: number | null
  deck_name: string | null
  created_at: string
  updated_at: string
}

const THREAD_SELECT = `
  SELECT t.id, t.title, t.deck_id, d.name AS deck_name, t.created_at, t.updated_at
  FROM ai_threads t LEFT JOIN decks d ON d.id = t.deck_id`

function toSummary(row: ThreadRow): ThreadSummary {
  return {
    id: row.id,
    title: row.title,
    deck: row.deck_id !== null && row.deck_name !== null ? { id: row.deck_id, name: row.deck_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Starts a conversation, about one deck when `deckId` is set. */
export function createThread(db: DB, deckId: number | null, now = new Date()): number {
  const at = now.toISOString()
  return Number(
    db
      .prepare("INSERT INTO ai_threads (title, deck_id, created_at, updated_at) VALUES ('', ?, ?, ?)")
      .run(deckId, at, at).lastInsertRowid,
  )
}

/**
 * Opens a conversation to start brainstorming (spec §5.5): the newest one about the same deck (or about none) that
 * nothing has been said in yet and the owner hasn't named, or a new one. Clicking "Brainstorm with Claude" again, or
 * twice, doesn't pile up empty conversations. A reused one moves to the top of the list.
 */
export function startThread(db: DB, deckId: number | null, now = new Date()): { id: number; reused: boolean } {
  const empty = db
    .prepare(
      `SELECT id FROM ai_threads t
       WHERE t.deck_id IS ? AND t.title = '' AND NOT EXISTS (SELECT 1 FROM ai_messages m WHERE m.thread_id = t.id)
       ORDER BY t.id DESC LIMIT 1`,
    )
    .pluck()
    .get(deckId) as number | undefined
  if (empty === undefined) return { id: createThread(db, deckId, now), reused: false }
  db.prepare('UPDATE ai_threads SET updated_at = ? WHERE id = ?').run(now.toISOString(), empty)
  return { id: empty, reused: true }
}

/** Every conversation, the most recently active first. */
export function listThreads(db: DB): ThreadSummary[] {
  return (db.prepare(`${THREAD_SELECT} ORDER BY t.updated_at DESC, t.id DESC`).all() as ThreadRow[]).map(toSummary)
}

export function getThread(db: DB, id: number): ThreadSummary | null {
  const row = db.prepare(`${THREAD_SELECT} WHERE t.id = ?`).get(id) as ThreadRow | undefined
  return row ? toSummary(row) : null
}

export function renameThread(db: DB, id: number, title: string, now = new Date()): boolean {
  return db.prepare('UPDATE ai_threads SET title = ?, updated_at = ? WHERE id = ?').run(title, now.toISOString(), id).changes > 0
}

/** Deletes a conversation and its messages. A deck Claude created stays. */
export function deleteThread(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM ai_threads WHERE id = ?').run(id).changes > 0
}

export function getMessages(db: DB, threadId: number): StoredMessage[] {
  const rows = db
    .prepare('SELECT id, role, content, meta, created_at FROM ai_messages WHERE thread_id = ? ORDER BY id')
    .all(threadId) as Array<{ id: number; role: 'user' | 'assistant'; content: string; meta: string | null; created_at: string }>
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: JSON.parse(r.content) as ContentBlock[],
    meta: r.meta === null ? null : (JSON.parse(r.meta) as MessageMeta),
    createdAt: r.created_at,
  }))
}

/**
 * Appends messages in one transaction, so a tool call is never stored without its result. The first message a
 * conversation gets names it: `title` is used when the conversation has none yet.
 */
export function appendMessages(db: DB, threadId: number, messages: readonly NewMessage[], title?: string, now = new Date()): void {
  const at = now.toISOString()
  const insert = db.prepare('INSERT INTO ai_messages (thread_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)')
  db.transaction(() => {
    for (const m of messages) insert.run(threadId, m.role, JSON.stringify(m.content), m.meta ? JSON.stringify(m.meta) : null, at)
    db.prepare(
      `UPDATE ai_threads SET updated_at = @at, title = CASE WHEN title = '' AND @title IS NOT NULL THEN @title ELSE title END
       WHERE id = @id`,
    ).run({ at, title: title ?? null, id: threadId })
  })()
}
