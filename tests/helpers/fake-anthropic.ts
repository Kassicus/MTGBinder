import http from 'node:http'
import type { AddressInfo } from 'node:net'
import Anthropic from '@anthropic-ai/sdk'
import { onTestFinished } from 'vitest'
import { createAiClient, type AiClient } from '../../src/server/ai/client.ts'

/** A content block the fake streams: text, a note (thinking), a tool call, or a refusal-fallback switch point. */
export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; /** Streamed as-is instead of `input`'s JSON. */ rawJson?: string }
  | { type: 'fallback'; from: string; to: string }

/** One scripted answer to a Messages API request. */
export type FakeReply =
  | { content: FakeBlock[]; stop_reason: string; model?: string; usage?: Partial<Anthropic.Beta.BetaUsage> }
  /** An HTTP error with the API's error body. */
  | { status: number; type: string; message: string }
  /** Streams `content`, then holds the connection open until the client goes away. */
  | { content: FakeBlock[]; hang: true; model?: string }
  /** Streams `content`, then an `error` event, as the API does when it fails partway through an answer. */
  | { content: FakeBlock[]; error: { type: string; message: string } }
  /** Streams `content`, then drops the connection. */
  | { content: FakeBlock[]; drop: true }

export interface FakeRequest {
  headers: http.IncomingHttpHeaders
  body: Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> }
  /** The client closed the connection before the fake finished its answer. */
  hungUp: boolean
}

export interface FakeAnthropic {
  url: string
  /** Every request the fake received, in order. */
  requests: FakeRequest[]
  /** Queues more answers. */
  reply(...replies: FakeReply[]): void
}

/**
 * A local stand-in for the Messages API that streams scripted answers as server-sent events, in the wire format the
 * SDK parses. Answers are used in order; a request with none left fails the test's conversation with a 500. A request
 * whose messages the API would refuse is answered with the API's 400, and uses up no answer.
 */
export async function fakeAnthropic(...replies: FakeReply[]): Promise<FakeAnthropic> {
  const queue = [...replies]
  const requests: FakeRequest[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const request: FakeRequest = { headers: req.headers, body: JSON.parse(raw), hungUp: false }
      requests.push(request)
      let dropping = false
      res.on('close', () => {
        if (!res.writableEnded && !dropping) request.hungUp = true
      })
      const problem = invalidMessages(request.body.messages)
      const reply = problem
        ? { status: 400, type: 'invalid_request_error', message: problem }
        : (queue.shift() ?? { status: 500, type: 'api_error', message: 'The fake has no answer left' })
      if ('status' in reply) {
        res.writeHead(reply.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: reply.type, message: reply.message } }))
        return
      }
      if ('drop' in reply) dropping = true
      stream(res, reply, requests.length)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => {
    server.closeAllConnections()
    server.close()
  })
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    reply: (...more) => queue.push(...more),
  }
}

type WireBlock = Record<string, unknown> & { type: string }

/** Why the API would refuse these messages with a 400, or null when it would take them. */
export function invalidMessages(messages: Array<{ role: string; content: unknown }>): string | null {
  if (messages[0]?.role !== 'user') return 'messages: the first message must use the "user" role'
  const blocksOf = (m: { content: unknown }): WireBlock[] =>
    typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as WireBlock[])
  for (const [i, m] of messages.entries()) {
    const blocks = blocksOf(m)
    if (blocks.length === 0) return `messages.${i}: all messages must have non-empty content`
    for (const [j, block] of blocks.entries()) {
      if (block.type === 'text' && String(block.text).trim() === '') {
        return `messages.${i}.content.${j}.text: text content blocks must contain non-whitespace text`
      }
    }
    const results = blocks.filter((b) => b.type === 'tool_result').map((b) => String(b.tool_use_id))
    if (results.length > 0) {
      const previous = messages[i - 1]
      const asked = previous?.role === 'assistant' ? blocksOf(previous).filter((b) => b.type === 'tool_use').map((b) => String(b.id)) : []
      const unmatched = results.filter((id) => !asked.includes(id))
      if (unmatched.length > 0) {
        return `messages.${i}: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${unmatched.join(', ')}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`
      }
    }
    const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => String(b.id))
    if (calls.length > 0) {
      const next = messages[i + 1]
      const answered = next?.role === 'user' ? blocksOf(next).filter((b) => b.type === 'tool_result').map((b) => String(b.tool_use_id)) : []
      const unanswered = calls.filter((id) => !answered.includes(id))
      if (unanswered.length > 0) {
        return `messages.${i}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${unanswered.join(', ')}. Each \`tool_use\` block must have a corresponding \`tool_result\` block in the next message.`
      }
    }
  }
  return null
}

function stream(res: http.ServerResponse, reply: Exclude<FakeReply, { status: number }>, n: number) {
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const model = 'model' in reply && reply.model ? reply.model : 'claude-opus-5-5'
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  send('message_start', {
    type: 'message_start',
    message: {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  })
  reply.content.forEach((block, index) => {
    const start = (content_block: unknown) => send('content_block_start', { type: 'content_block_start', index, content_block })
    const delta = (d: unknown) => send('content_block_delta', { type: 'content_block_delta', index, delta: d })
    if (block.type === 'text') {
      start({ type: 'text', text: '' })
      for (const part of block.text.match(/[\s\S]{1,8}/g) ?? []) delta({ type: 'text_delta', text: part })
    } else if (block.type === 'thinking') {
      start({ type: 'thinking', thinking: '', signature: '' })
      delta({ type: 'thinking_delta', thinking: block.thinking })
      delta({ type: 'signature_delta', signature: block.signature ?? `sig-${n}-${index}` })
    } else if (block.type === 'tool_use') {
      start({ type: 'tool_use', id: block.id, name: block.name, input: {} })
      const json = block.rawJson ?? JSON.stringify(block.input)
      for (const part of json.match(/[\s\S]{1,16}/g) ?? []) delta({ type: 'input_json_delta', partial_json: part })
    } else {
      start({ type: 'fallback', from: { model: block.from }, to: { model: block.to } })
    }
    send('content_block_stop', { type: 'content_block_stop', index })
  })
  if ('hang' in reply) return
  if ('drop' in reply) {
    // Let what was written reach the client, then cut the connection partway through the body.
    setTimeout(() => res.socket?.destroy(), 20)
    return
  }
  if ('error' in reply) {
    send('error', { type: 'error', error: reply.error })
    res.end()
    return
  }
  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: reply.stop_reason, stop_sequence: null },
    usage: { output_tokens: 200, ...reply.usage },
  })
  send('message_stop', { type: 'message_stop' })
  res.end()
}

/** An AI client with a saved key, talking to `fake` (no retries, so errors surface at once). */
export function fakeAiClient(fake: FakeAnthropic, key: string | null = 'sk-ant-test-0000'): AiClient {
  let saved = key
  return createAiClient(
    { read: () => saved, write: (next) => void (saved = next) },
    (apiKey) => new Anthropic({ apiKey, baseURL: fake.url, authToken: null, maxRetries: 0 }),
  )
}
