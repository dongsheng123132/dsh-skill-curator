import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply, name as pluginName, inject } from '../plugin.mjs'

function fakeCtx() {
  const channels = new Map()
  const listeners = []
  const logs = []
  const logger = {
    info: (msg) => logs.push(['info', msg]),
    warn: (msg) => logs.push(['warn', msg]),
    error: (msg) => logs.push(['error', msg]),
  }
  const ctx = {
    logger,
    skills: { snapshot: async () => ({ skills: [{ name: 'a' }, { name: 'b' }], complete: true }) },
    inject(services, fn) {
      if (services.includes('connection')) {
        fn({ connection: { rpc: { handle: (channel, handler) => channels.set(channel, handler) } }, logger })
      }
    },
    on(type, fn) {
      listeners.push([type, fn])
    },
  }
  return { ctx, channels, listeners, logs }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsc-plugin-'))
  const home = join(root, 'home')
  const skills = join(home, 'skills')
  const sessions = join(root, 'sessions')
  mkdirSync(sessions, { recursive: true })
  mkdirSync(join(skills, 'alpha'), { recursive: true })
  writeFileSync(join(skills, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: alpha skill\n---\nbody\n')
  mkdirSync(join(skills, 'beta'), { recursive: true })
  writeFileSync(join(skills, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: beta skill\n---\nbody\n')
  return {
    root,
    options: {
      dshHome: home,
      sessionsDir: sessions,
      stateDir: join(home, 'skill-curator'),
      agentsHome: join(root, 'agents'),
      refreshSeconds: 0,
    },
  }
}

test('plugin exposes the expected contract', () => {
  assert.equal(pluginName, 'skill-curator')
  assert.deepEqual(inject, ['skills'])
  assert.equal(typeof apply, 'function')
})

test('plugin mounts the RPC channel and answers report/page', async () => {
  const { ctx, channels } = fakeCtx()
  const { options } = fixture()
  apply(ctx, options)

  const handler = channels.get('/skill-curator')
  assert.equal(typeof handler, 'function', 'channel should be mounted')

  const report = await handler('report', { args: {} })
  assert.equal(report.ok, true)
  assert.equal(report.value.catalog.localEntries, 2)
  assert.equal(report.value.hostCatalog.entries, 2)

  const page = await handler('page', { args: { limit: 10 } })
  assert.equal(page.ok, true)
  assert.equal(page.value.total, 2)
  assert.ok(page.value.rows.every((row) => typeof row.tokensEstimate === 'number'))
})

test('plugin archives and restores through RPC', async () => {
  const { ctx, channels } = fakeCtx()
  const { root, options } = fixture()
  apply(ctx, options)
  const handler = channels.get('/skill-curator')

  const plan = await handler('plan', { args: { name: 'alpha' } })
  assert.equal(plan.ok, true)
  assert.match(plan.value.to, /\.archive/)

  const archived = await handler('archive', { args: { name: 'alpha' } })
  assert.equal(archived.ok, true)
  assert.equal(existsSync(join(options.dshHome, 'skills', 'alpha')), false)

  const listed = await handler('archived', {})
  assert.equal(listed.value.entries.length, 1)

  const restored = await handler('restore', { args: { name: 'alpha' } })
  assert.equal(restored.ok, true)
  assert.equal(existsSync(join(options.dshHome, 'skills', 'alpha', 'SKILL.md')), true)

  assert.ok(root)
})

test('plugin refuses to archive a pinned skill and reports unknown endpoints', async () => {
  const { ctx, channels } = fakeCtx()
  const { options } = fixture()
  apply(ctx, options)
  const handler = channels.get('/skill-curator')

  const pinned = await handler('pin', { args: { name: 'beta', pinned: true } })
  assert.equal(pinned.ok, true)
  assert.deepEqual(pinned.value.pins, ['beta'])

  const refused = await handler('archive', { args: { name: 'beta' } })
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /pin/)

  const unknown = await handler('nope', { args: {} })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'skill-curator/unknown-endpoint')
})

test('plugin tracks live skill loads from session events', async () => {
  const { ctx, channels, listeners } = fakeCtx()
  const { options } = fixture()
  apply(ctx, options)

  const sessionListener = listeners.find(([type]) => type === 'session/event')
  assert.ok(sessionListener, 'session/event listener should be registered')
  sessionListener[1]({ id: 's1' }, { type: 'tool/call', time: 1000, data: { name: 'skill', arguments: '{"name":"alpha"}' } })
  sessionListener[1]({ id: 's1' }, { type: 'tool/call', time: 2000, data: { name: 'skill', arguments: { name: 'alpha' } } })
  sessionListener[1]({ id: 's1' }, { type: 'tool/call', time: 3000, data: { name: 'bash', arguments: '{}' } })

  const handler = channels.get('/skill-curator')
  const report = await handler('report', { args: {} })
  assert.equal(report.value.live.loads.length, 1)
  assert.equal(report.value.live.loads[0].name, 'alpha')
  assert.equal(report.value.live.loads[0].count, 2)
})

test('plugin survives a broken connection service', () => {
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: () => {} },
    skills: {},
    inject(services, fn) {
      fn({
        connection: { rpc: { handle() { throw new Error('no rpc here') } } },
        logger: ctx.logger,
      })
    },
    on() {},
  }
  assert.doesNotThrow(() => apply(ctx, { dshHome: join(tmpdir(), 'dsc-missing'), sessionsDir: join(tmpdir(), 'dsc-missing-sessions'), stateDir: join(tmpdir(), 'dsc-missing-state'), refreshSeconds: 0 }))
  assert.ok(logs.some((line) => /RPC channel unavailable/.test(line)))
})
