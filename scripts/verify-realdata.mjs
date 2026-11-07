import { apply } from '../plugin.mjs'

const channels = new Map()
const logger = { info: (m) => console.log('[info]', m), warn: (m) => console.log('[warn]', m), error: (m) => console.log('[error]', m) }
const ctx = {
  logger,
  skills: {
    snapshot: async () => ({ skills: new Array(148).fill(0).map((_, i) => ({ name: 'x' + i })), complete: true }),
  },
  inject(services, fn) {
    if (services.includes('connection')) {
      fn({ connection: { rpc: { handle: (ch, handler) => channels.set(ch, handler) } }, logger })
    }
  },
  on() {},
}

apply(ctx, { refreshSeconds: 0 })
const handler = channels.get('/skill-curator')
if (!handler) throw new Error('channel not mounted')

const t0 = Date.now()
const report = await handler('report', { args: {} })
console.log('report ok:', report.ok, 'ms:', Date.now() - t0, 'buildMs:', report.value.buildMs)
console.log('summary:', JSON.stringify({
  measuredEntries: report.value.catalog.measuredEntries,
  measuredChars: report.value.catalog.measuredChars,
  localEntries: report.value.catalog.localEntries,
  unobserved: report.value.catalog.unobserved,
  observedSessions: report.value.catalog.observed.sessions,
  medianChars: report.value.catalog.observed.medianChars,
  skillCalls: report.value.usage.skillCalls,
  hostCatalog: report.value.hostCatalog,
}, null, 2))

const page = await handler('page', { args: { limit: 5 } })
console.log('page ok:', page.ok, 'total:', page.value.total)
console.log('top rows:', page.value.rows.map((r) => `${r.name}=${r.catalogChars}/${r.loads}loads`).join(', '))

const doctor = await handler('doctor', { args: {} })
console.log('doctor ok:', doctor.ok, 'roots:', doctor.value.roots.map((r) => `${r.source}:${r.count}`).join(' '))

const archive = await handler('plan', { args: { name: 'machine' } })
console.log('plan ok:', archive.ok, archive.ok ? archive.value.to : archive.error.message)
