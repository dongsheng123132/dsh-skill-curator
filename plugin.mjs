/**
 * dsh-skill-curator — host half.
 *
 * Exposes the curator to the web client over an authenticated RPC channel:
 *
 *   POST <channel>/report    {refresh?, skipSessions?}
 *   POST <channel>/archive   {name}          move into <root>/.archive/
 *   POST <channel>/restore   {name}
 *   POST <channel>/archived  {}
 *   POST <channel>/pin       {name, pinned}
 *   POST <channel>/doctor    {}
 *
 * Design constraints:
 *  - Only `node:` builtins and relative files; no @deepseek-ai imports, so the
 *    plugin can never fight the host's own cordis instance.
 *  - Read-only unless the caller explicitly archives, and every archive is a
 *    rename into `.archive/` plus a manifest entry — reversible by `restore`.
 *  - A failure in here must never take the host down: every RPC returns an
 *    envelope and every handler catches.
 */
import { buildReport, estimateTokens, renderMarkdown } from './lib/report.mjs'
import { archiveSkill, listArchived, planArchive, restoreSkill, setPin } from './lib/archive.mjs'
import { discoverSkills } from './lib/discover.mjs'
import { dshHome, sessionsDir, stateDir } from './lib/paths.mjs'

export const name = 'skill-curator'
export const inject = ['skills']

const RPC_CHANNEL = '/skill-curator'
const DEFAULT_REFRESH_SECONDS = 60

function ok(value) {
  return { ok: true, value }
}

function fail(code, message) {
  return { ok: false, error: { code, message } }
}

/**
 * @param {object} ctx - Cordis context (skills, connection, logger, on()).
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const options = {
    dshHomePath: config.dshHome ?? dshHome(),
    sessionsDir: config.sessionsDir ?? sessionsDir(),
    stateDirPath: config.stateDir ?? stateDir(),
    agentsHome: config.agentsHome,
  }
  const refreshSeconds = Number.isFinite(config.refreshSeconds) ? config.refreshSeconds : DEFAULT_REFRESH_SECONDS

  /** @type {{report: object, at: number} | null} */
  let cache = null
  let building = null

  /** Live counters for the current process: "what happened while I was open". */
  const live = { loads: new Map(), lastEventAt: 0 }

  function liveSnapshot() {
    return {
      loads: [...live.loads.entries()]
        .map(([skillName, entry]) => ({ name: skillName, count: entry.count, lastUsed: entry.lastUsed }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      lastEventAt: live.lastEventAt,
    }
  }

  async function hostCatalog() {
    try {
      if (typeof ctx.skills?.snapshot === 'function') {
        const snapshot = await ctx.skills.snapshot({ cwd: process.cwd() })
        return { entries: snapshot.skills.length, complete: snapshot.complete }
      }
      if (typeof ctx.skills?.list === 'function') {
        const list = await ctx.skills.list({ cwd: process.cwd() })
        return { entries: list.length, complete: true }
      }
    } catch (error) {
      ctx.logger?.warn?.(`skill-curator: host catalog unavailable: ${String(error)}`)
    }
    return null
  }

  async function getReport({ refresh = false, skipSessions = false } = {}) {
    const fresh = refresh || (cache !== null && refreshSeconds <= 0)
    if (!fresh && cache && Date.now() - cache.at < refreshSeconds * 1000) {
      return { ...cache.report, cached: true }
    }
    if (building) return building
    building = (async () => {
      const started = Date.now()
      const report = buildReport({ ...options, skipSessions })
      const host = await hostCatalog()
      const enriched = {
        ...report,
        hostCatalog: host,
        live: liveSnapshot(),
        buildMs: Date.now() - started,
        cached: false,
      }
      cache = { report: enriched, at: Date.now() }
      return enriched
    })()
    try {
      return await building
    } finally {
      building = null
    }
  }

  async function handleRpc(endpoint, payload) {
    const args = (payload && payload.args) || {}
    switch (endpoint) {
      case 'report': {
        const report = await getReport(args)
        return ok({ ...report, markdown: args.markdown === true ? renderMarkdown(report) : undefined })
      }
      case 'page': {
        const report = await getReport(args)
        const offset = Number.isFinite(args.offset) ? Math.max(0, args.offset) : 0
        const limit = Number.isFinite(args.limit) ? Math.min(200, Math.max(1, args.limit)) : 40
        const rows = report.catalogEntries
          .slice()
          .sort((a, b) => b.catalogChars - a.catalogChars)
          .slice(offset, offset + limit)
          .map((entry) => ({ ...entry, tokensEstimate: estimateTokens(entry.catalogChars) }))
        return ok({ rows, total: report.catalogEntries.length, offset, limit, summary: summarize(report) })
      }
      case 'archive': {
        if (typeof args.name !== 'string' || args.name.length === 0) return fail('skill-curator/bad-request', '缺少 name')
        const result = archiveSkill(args.name, options)
        if (result.ok) cache = null
        return result.ok ? ok(result) : fail('skill-curator/archive', result.error)
      }
      case 'plan': {
        if (typeof args.name !== 'string' || args.name.length === 0) return fail('skill-curator/bad-request', '缺少 name')
        const plan = planArchive(args.name, options)
        if (!plan.ok) return fail('skill-curator/plan', plan.error)
        return ok({ name: plan.skill.name, kind: plan.kind, from: plan.from, to: plan.to })
      }
      case 'restore': {
        if (typeof args.name !== 'string' || args.name.length === 0) return fail('skill-curator/bad-request', '缺少 name')
        const result = restoreSkill(args.name, options)
        if (result.ok) cache = null
        return result.ok ? ok(result) : fail('skill-curator/restore', result.error)
      }
      case 'archived':
        return ok({ entries: listArchived(options) })
      case 'pin': {
        if (typeof args.name !== 'string' || args.name.length === 0) return fail('skill-curator/bad-request', '缺少 name')
        const pins = setPin(args.name, args.pinned !== false, options)
        cache = null
        return ok({ pins, name: args.name, pinned: args.pinned !== false })
      }
      case 'doctor': {
        const discovered = discoverSkills(options)
        return ok({
          dshHome: options.dshHomePath,
          sessionsDir: options.sessionsDir,
          stateDir: options.stateDirPath,
          roots: discovered.roots,
          discovered: discovered.skills.length,
          shadowed: discovered.shadowed.length,
          invalid: discovered.invalid.length,
          archived: listArchived(options).length,
          live: liveSnapshot(),
        })
      }
      default:
        return fail('skill-curator/unknown-endpoint', `未知端点: ${endpoint}`)
    }
  }

  // `connection` is not present in every profile; inject it lazily like the
  // other web plugins do, and log instead of throwing when it is absent.
  ctx.inject(['connection'], (inner) => {
    try {
      inner.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
        try {
          return await handleRpc(endpoint, payload)
        } catch (error) {
          inner.logger?.warn?.(`skill-curator: RPC ${endpoint} failed: ${String(error)}`)
          return fail('skill-curator/internal', String(error && error.message ? error.message : error))
        }
      })
      inner.logger?.info?.('skill-curator: RPC channel mounted')
    } catch (error) {
      inner.logger?.warn?.(`skill-curator: RPC channel unavailable: ${String(error)}`)
    }
  })

  // Live view of what the running process actually loads. This is a bonus
  // signal for the panel; the durable numbers still come from session logs.
  ctx.on('session/event', (session, event) => {
    if (!event || event.type !== 'tool/call') return
    const data = event.data
    if (!data || data.name !== 'skill') return
    let args = data.arguments
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        return
      }
    }
    const skillName = args && typeof args.name === 'string' ? args.name : undefined
    if (!skillName) return
    const entry = live.loads.get(skillName) ?? { count: 0, lastUsed: 0 }
    entry.count++
    entry.lastUsed = event.time ?? Date.now()
    live.loads.set(skillName, entry)
    live.lastEventAt = entry.lastUsed
  })

  ctx.logger?.info?.(`skill-curator: ready (home=${options.dshHomePath}, sessions=${options.sessionsDir})`)
}

function summarize(report) {
  return {
    generatedAt: report.generatedAt,
    observed: report.catalog.observed,
    localEntries: report.catalog.localEntries,
    localChars: report.catalog.localChars,
    localTokensEstimate: report.catalog.localTokensEstimate,
    measuredEntries: report.catalog.measuredEntries,
    measuredChars: report.catalog.measuredChars,
    unobserved: report.catalog.unobserved,
    unobservedChars: report.catalog.unobservedChars,
    unobservedShare: report.catalog.unobservedShare,
    skillCalls: report.usage.skillCalls,
    sessions: report.usage.sessions,
    distinctSkillsLoaded: report.usage.distinctSkillsLoaded,
    warnings: report.warnings,
    hostCatalog: report.hostCatalog,
    buildMs: report.buildMs,
  }
}
