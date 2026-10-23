import type { Register } from 'claude-code'

const API = 'http://127.0.0.1:4747'
const MC = '/Users/thinhtran/.claude/bin/mc'
const WAIT_SECONDS = 25
const RETRY_MS = 3000
const MAX_SENTENCES = 2
const MAX_WORDS = 60

type Question = {
  runId: string
  todoId: string
  title: string
  question: string
  text: string
  recommendation: unknown
  options: unknown
  positions: unknown
  tradeoffs: string[]
  caveats: string[]
  conversation: unknown
}

type Work = {
  questions: Question[]
  submitted: { runId: string; todoIds: string[]; waitActive: boolean }[]
  sync: { requestedAt: string; prompt: string } | null
}

function askPrompt(q: Question): string {
  const context = {
    decision: q.question,
    recommendation: q.recommendation,
    options: q.options,
    positions: q.positions,
    tradeoffs: q.tradeoffs,
    caveats: q.caveats,
    conversation: q.conversation,
  }
  return [
    `Thinh is reviewing decision ${q.todoId} "${q.title}" in Mission Control and asks: ${q.text}`,
    '',
    'Answer like a teammate on chat: at most two short sentences, under 40 words in total. Lead with the answer. No preamble, no restating the question, no lists, no headings, no markdown.',
    'Use what you already know from this session and stay consistent with what you said before. If it needs investigation, say in one sentence what you would check.',
    '',
    `Decision context: ${JSON.stringify(context)}`,
  ].join('\n')
}

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentences = flat.split(/(?<=[.!?])\s+/).slice(0, MAX_SENTENCES).join(' ')
  const words = sentences.split(' ')
  return words.length <= MAX_WORDS ? sentences : `${words.slice(0, MAX_WORDS).join(' ')}…`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const env = await $.process.run(['printenv', 'CONDUCTOR_SESSION_ID']).catch(() => null)
    const sessionId = env === null ? '' : env.stdout.trim()
    if (sessionId === '') return started

    const answering = new Set<string>()
    const waking = new Set<string>()
    const syncing = new Set<string>()

    async function answer(q: Question): Promise<void> {
      const reply = await $.model.fork({ prompt: askPrompt(q) })
      if (!reply.isAnswered) return
      await $.http.fetch(`${API}/api/runs/${encodeURIComponent(q.runId)}/todos/${encodeURIComponent(q.todoId)}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: clamp(reply.text) }),
      })
    }

    async function sync(request: { requestedAt: string; prompt: string }): Promise<void> {
      await $.http.fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/sync/ack`, { method: 'POST' })
      await $.prompt.submit({ text: `${request.prompt}\n\n(Requested by Thinh from Mission Control.)` })
    }

    async function wake(runId: string): Promise<void> {
      const ran = await $.process.run([MC, 'wait', runId, '--timeout', '0.1'])
      if (ran.exitCode !== 0 || !ran.stdout.includes('MISSION CONTROL DECISIONS')) return
      await $.prompt.submit({
        text: `${ran.stdout.trim()}\n\n(Woken by the Mission Control mod. Act on these decisions as your skill describes.)`,
      })
    }

    async function poll(): Promise<number> {
      const res = await $.http
        .fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/work?wait=${WAIT_SECONDS}`)
        .catch(() => null)
      if (res === null || !res.ok) return RETRY_MS
      const work = JSON.parse(res.text) as Work
      let started = 0
      for (const q of work.questions) {
        const key = `${q.runId}/${q.todoId}/${q.text}`
        if (answering.has(key)) continue
        answering.add(key)
        started += 1
        void answer(q).catch(() => undefined)
      }
      for (const s of work.submitted) {
        const key = `${s.runId}:${s.todoIds.join(',')}`
        if (s.waitActive || waking.has(key)) continue
        waking.add(key)
        started += 1
        void wake(s.runId).catch(() => undefined)
      }
      if (work.sync !== null && !syncing.has(work.sync.requestedAt)) {
        syncing.add(work.sync.requestedAt)
        started += 1
        void sync(work.sync).catch(() => undefined)
      }
      const busy = work.questions.length > 0 || work.submitted.some((s) => !s.waitActive) || work.sync !== null
      return started === 0 && busy ? 1000 : 50
    }

    function loop(): void {
      void poll()
        .catch(() => RETRY_MS)
        .then((delay) => $.clock.after(delay, loop))
    }

    loop()
    return started
  })
}
