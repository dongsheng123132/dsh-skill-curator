import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { charCount } from './discover.mjs'

/**
 * Walk `~/.dsh/sessions` recursively and collect real, per-event evidence:
 *
 *  - `skill` tool calls          → a skill body was actually loaded into context
 *  - `skill-invocation` messages → the user invoked a skill with `/name`
 *  - `skill-catalog` messages    → the exact catalog text one session was billed
 *
 * Everything here is observed data. A skill with zero observations is reported
 * as *unobserved*, never as "unused".
 *
 * @param {{dir: string, onProgress?: (done: number, total: number) => void}} options
 */
export function scanSessions({ dir, onProgress } = {}) {
  const files = []
  walk(dir, files)

  const result = {
    dir,
    files: files.length,
    unreadable: 0,
    events: 0,
    sessions: 0,
    catalogs: [],
    cwds: new Set(),
    loads: new Map(),
    invocations: new Map(),
    skillCallNamesUnknown: 0,
    projectsWithLoads: new Set(),
    scannedAt: new Date().toISOString(),
  }

  files.forEach((file, index) => {
    scanFile(file, result)
    if (onProgress && (index % 250 === 0 || index === files.length - 1)) {
      onProgress(index + 1, files.length)
    }
  })

  return {
    ...result,
    cwds: [...result.cwds],
    projectsWithLoads: result.projectsWithLoads.size,
    loads: [...result.loads.entries()]
      .map(([name, v]) => ({ name, count: v.count, lastUsed: v.lastUsed, sessions: v.sessions.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    invocations: [...result.invocations.entries()]
      .map(([name, v]) => ({ name, count: v.count, lastUsed: v.lastUsed }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name === 'session.v4.jsonl.zstd') out.push(path)
  }
}

function projectOf(file, sessionsRoot) {
  const rel = file.startsWith(sessionsRoot) ? file.slice(sessionsRoot.length + 1) : file
  const parts = rel.split('/')
  return parts.length > 1 ? parts[0] : '(root)'
}

function noteLoad(map, name, time, project, sessionId) {
  let entry = map.get(name)
  if (!entry) {
    entry = { count: 0, lastUsed: 0, sessions: new Set(), projects: new Set() }
    map.set(name, entry)
  }
  entry.count++
  if (time > entry.lastUsed) entry.lastUsed = time
  entry.projects.add(project)
  if (sessionId) entry.sessions.add(sessionId)
}

function scanFile(file, result) {
  let text
  try {
    text = zstdDecompressSync(readFileSync(file)).toString('utf8')
  } catch {
    result.unreadable++
    return
  }
  result.sessions++
  const project = projectOf(file, result.dir)
  const sessionId = file.split('/').slice(-2, -1)[0]
  let lastCatalog = null

  const lines = text.split('\n')
  // The first record is the session header and carries the real cwd.
  if (lines[0]) {
    try {
      const header = JSON.parse(lines[0])
      if (header.type === 'session' && typeof header.cwd === 'string') result.cwds.add(header.cwd)
    } catch {
      /* header is optional evidence; ignore malformed */
    }
  }

  for (const line of lines) {
    if (!line) continue
    // Cheap prefilter: only these event types can carry the evidence we want.
    if (!line.includes('tool/call') && !line.includes('skill-catalog') && !line.includes('skill-invocation')) continue
    result.events++
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }

    if (ev.type === 'tool/call') {
      const data = ev.data
      if (!data || data.name !== 'skill') continue
      const name = parseSkillArgument(data.arguments)
      if (typeof name !== 'string') {
        result.skillCallNamesUnknown++
        continue
      }
      noteLoad(result.loads, name, ev.time ?? 0, project, sessionId)
      result.projectsWithLoads.add(project)
      continue
    }

    if (ev.type !== 'user/message') continue
    const source = ev.data && ev.data.source
    if (!source || typeof source.kind !== 'string') continue

    if (source.kind === 'skill-invocation' && typeof source.name === 'string') {
      let entry = result.invocations.get(source.name)
      if (!entry) {
        entry = { count: 0, lastUsed: 0 }
        result.invocations.set(source.name, entry)
      }
      entry.count++
      if ((ev.time ?? 0) > entry.lastUsed) entry.lastUsed = ev.time ?? 0
      continue
    }

    if (source.kind === 'skill-catalog' && Array.isArray(source.entries)) {
      const blocks = Array.isArray(ev.data.content) ? ev.data.content : []
      const rendered = blocks.map((b) => (typeof b.text === 'string' ? b.text : '')).join('')
      lastCatalog = {
        session: sessionId,
        project,
        time: ev.time ?? 0,
        entries: source.entries.length,
        chars: charCount(rendered),
        complete: source.incomplete !== true,
        names: source.entries.map((e) => e.name),
        entryDescriptions: source.entries.map((e) => ({ name: e.name, description: typeof e.description === 'string' ? e.description : '' })),
      }
    }
  }

  if (lastCatalog) result.catalogs.push(lastCatalog)
}

/** Extract the skill name from the `skill` tool's JSON arguments. */
function parseSkillArgument(args) {
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (!value || typeof value !== 'object') return undefined
  return typeof value.name === 'string' ? value.name : undefined
}
