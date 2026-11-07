import { catalogLine, charCount, discoverProjectSkills, discoverSkills } from './discover.mjs'
import { scanSessions } from './sessions.mjs'
import { sessionsDir as defaultSessionsDir } from './paths.mjs'
import { readPins } from './archive.mjs'

/** Rough token estimate used for orientation only — never for billing claims. */
export function estimateTokens(chars) {
  return Math.ceil(chars / 4)
}

/**
 * Build one complete, evidence-linked report.
 *
 * Evidence hierarchy:
 *  1. Session catalogs — the exact text a model was billed for. Authoritative
 *     for totals and for bundled skills we cannot read from disk.
 *  2. Session `skill` tool calls — observed loads, never "usage" in the
 *     abstract. Zero observations stay "unobserved".
 *  3. Filesystem discovery — attribution: which root owns a name, and whether
 *     it can be archived.
 *
 * @param {{cwd?: string, dshHomePath?: string, sessionsDir?: string, skipSessions?: boolean, limit?: number}} [options]
 */
export function buildReport(options = {}) {
  const limit = options.limit ?? 10
  const discovered = discoverSkills(options)
  const pins = new Set(readPins(options))

  const usage = options.skipSessions
    ? {
        files: 0, sessions: 0, events: 0, loads: [], invocations: [], catalogs: [], cwds: [],
        unreadable: 0, projectsWithLoads: 0, skipped: true,
      }
    : scanSessions({ dir: options.sessionsDir ?? defaultSessionsDir() })

  const loadByName = new Map(usage.loads.map((l) => [l.name, l]))
  const invocationByName = new Map((usage.invocations ?? []).map((l) => [l.name, l]))
  const localByName = new Map(discovered.skills.map((s) => [s.name, s]))

  // Attribute names that show up in session catalogs but not in this
  // workspace's roots: other projects' skills, or package-bundled skills.
  const projectSkills = usage.skipped ? [] : discoverProjectSkills(usage.cwds ?? [])
  const projectByName = new Map()
  for (const skill of projectSkills) {
    if (!projectByName.has(skill.name)) projectByName.set(skill.name, skill)
  }

  const latestCatalog = latestCatalogOf(usage.catalogs)
  const measured = latestCatalog
    ? latestCatalog.entryDescriptions.map((entry) => {
        const line = catalogLine(entry)
        const local = localByName.get(entry.name)
        const project = projectByName.get(entry.name)
        const load = loadByName.get(entry.name)
        const source = local ? local.source : project ? 'project-other' : 'bundled'
        return {
          name: entry.name,
          description: entry.description,
          catalogChars: charCount(line),
          source,
          owner: local ? local.root : project ? project.projectRoot : '(package)',
          archivable: Boolean(local) && local.source !== 'bundled',
          pinned: pins.has(entry.name),
          loads: load ? load.count : 0,
          lastUsed: load ? load.lastUsed : 0,
          invocations: invocationByName.get(entry.name)?.count ?? 0,
          drift: local ? local.catalogChars !== charCount(line) : false,
        }
      })
    : discovered.skills.map((skill) => {
        const load = loadByName.get(skill.name)
        return {
          name: skill.name,
          description: skill.description,
          catalogChars: skill.catalogChars,
          source: skill.source,
          owner: skill.root,
          archivable: skill.source !== 'bundled',
          pinned: pins.has(skill.name),
          loads: load ? load.count : 0,
          lastUsed: load ? load.lastUsed : 0,
          invocations: invocationByName.get(skill.name)?.count ?? 0,
          drift: false,
        }
      })

  const measuredByName = new Map(measured.map((entry) => [entry.name, entry]))

  // Local skills keep filesystem-authoritative cost; catalog-only names come
  // from the measured snapshot.
  const skills = discovered.skills.map((skill) => {
    const load = loadByName.get(skill.name)
    const inCatalog = measuredByName.get(skill.name)
    return {
      name: skill.name,
      description: skill.description,
      source: skill.source,
      rank: skill.rank,
      root: skill.root,
      path: skill.path,
      catalogChars: skill.catalogChars,
      bodyBytes: skill.bytes,
      loads: load ? load.count : 0,
      sessionsWithLoad: load ? load.sessions : 0,
      lastUsed: load ? load.lastUsed : 0,
      invocations: invocationByName.get(skill.name)?.count ?? 0,
      observedInCatalog: Boolean(inCatalog),
      archivable: skill.source !== 'bundled',
      pinned: pins.has(skill.name),
      modelInvocable: skill.modelInvocable,
    }
  })

  const localNames = new Set(skills.map((s) => s.name))
  const catalogOnly = measured
    .filter((entry) => !localNames.has(entry.name))
    .sort((a, b) => b.catalogChars - a.catalogChars)
  const missingFromCatalog = skills.filter((s) => !measuredByName.has(s.name)).map((s) => s.name)

  const catalogChars = skills.reduce((sum, s) => sum + s.catalogChars, 0)
  const observed = summarizeCatalogs(usage.catalogs)
  const measuredChars = measured.reduce((sum, e) => sum + e.catalogChars, 0)

  const unobserved = skills.filter((s) => s.loads === 0)
  const unobservedChars = unobserved.reduce((sum, s) => sum + s.catalogChars, 0)

  const archiveCandidates = unobserved
    .filter((s) => s.archivable && !s.pinned)
    .sort((a, b) => b.catalogChars - a.catalogChars || a.name.localeCompare(b.name))
    .slice(0, limit)

  const expensiveLowUse = skills
    .filter((s) => s.loads > 0 && s.loads <= 2)
    .sort((a, b) => b.catalogChars - a.catalogChars || a.name.localeCompare(b.name))
    .slice(0, limit)

  const highValue = skills
    .filter((s) => s.loads >= 3)
    .sort((a, b) => a.catalogChars / a.loads - b.catalogChars / b.loads)
    .slice(0, limit)

  const warnings = []
  if (usage.skipped) warnings.push('会话日志未扫描（--no-sessions）：加载次数全部未知，不可据此归档。')
  else if (usage.catalogs.length === 0) warnings.push('没有找到会话 catalog 快照：总量按文件系统重建，可能与真实会话有差异。')
  if (!usage.skipped && usage.files === 0) warnings.push(`会话目录为空或不可读：${options.sessionsDir ?? defaultSessionsDir()}`)
  if (usage.unreadable > 0) warnings.push(`${usage.unreadable} 个会话文件解压失败，已跳过（不影响其余统计）。`)
  if (discovered.invalid.length > 0) warnings.push(`${discovered.invalid.length} 个 SKILL.md 无法解析，DSH 也不会加载它。`)
  if (discovered.shadowed.length > 0) warnings.push(`${discovered.shadowed.length} 个同名技能被更高优先级的根遮蔽（rank 小的胜出）。`)
  const drift = measured.filter((entry) => entry.drift).length
  if (drift > 0) warnings.push(`${drift} 个技能的 catalog 描述自上次会话后已变更（报告按当前文件计费，仅对本地技能）。`)
  if (missingFromCatalog.length > 0 && latestCatalog) {
    warnings.push(`${missingFromCatalog.length} 个本地技能不在最近一份会话 catalog 里（新加、被遮蔽或只在该项目可见）：${missingFromCatalog.slice(0, 6).join(', ')}${missingFromCatalog.length > 6 ? '…' : ''}`)
  }
  if (unobserved.length > 0) warnings.push(`0 次加载 ≠ 无用：${unobserved.length} 个技能只是在已扫描的 ${usage.sessions} 个会话里没有被观测到。`)

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    cwd: options.cwd ?? process.cwd(),
    roots: discovered.roots,
    catalog: {
      measuredEntries: measured.length,
      measuredChars,
      measuredTokensEstimate: estimateTokens(measuredChars),
      localEntries: skills.length,
      localChars: catalogChars,
      localTokensEstimate: estimateTokens(catalogChars),
      missingFromCatalog,
      unobserved: unobserved.length,
      unobservedChars,
      unobservedTokensEstimate: estimateTokens(unobservedChars),
      unobservedShare: catalogChars === 0 ? 0 : unobservedChars / catalogChars,
      observed,
      latest: latestCatalog
        ? { session: latestCatalog.session, project: latestCatalog.project, time: latestCatalog.time }
        : null,
      sourceMix: countBy(measured, (entry) => entry.source),
    },
    usage: {
      files: usage.files,
      sessions: usage.sessions,
      events: usage.events,
      unreadable: usage.unreadable,
      skillCalls: usage.loads.reduce((sum, l) => sum + l.count, 0),
      distinctSkillsLoaded: usage.loads.length,
      projectsWithLoads: usage.projectsWithLoads,
      userInvocations: (usage.invocations ?? []).reduce((sum, l) => sum + l.count, 0),
      unknownSkillCalls: usage.skillCallNamesUnknown ?? 0,
    },
    skills,
    catalogEntries: measured,
    catalogOnly,
    shadowed: discovered.shadowed.map((s) => ({ name: s.name, path: s.path, source: s.source, shadowedBy: s.shadowedBy })),
    invalid: discovered.invalid,
    buckets: { archiveCandidates, expensiveLowUse, highValue },
    warnings,
  }
}

function countBy(items, keyOf) {
  const out = {}
  for (const item of items) {
    const key = keyOf(item)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function latestCatalogOf(catalogs) {
  if (!catalogs || catalogs.length === 0) return null
  const withEntries = catalogs.filter((c) => Array.isArray(c.entryDescriptions))
  if (withEntries.length === 0) return null
  return withEntries.reduce((best, c) => (c.time > best.time ? c : best))
}

function summarizeCatalogs(catalogs) {
  if (catalogs.length === 0) {
    return { sessions: 0, minChars: 0, maxChars: 0, avgChars: 0, medianChars: 0, maxEntries: 0, latest: null }
  }
  const chars = catalogs.map((c) => c.chars).sort((a, b) => a - b)
  const sum = chars.reduce((a, b) => a + b, 0)
  const latest = [...catalogs].sort((a, b) => b.time - a.time)[0]
  return {
    sessions: catalogs.length,
    minChars: chars[0],
    maxChars: chars[chars.length - 1],
    avgChars: Math.round(sum / chars.length),
    medianChars: chars[Math.floor(chars.length / 2)],
    maxEntries: Math.max(...catalogs.map((c) => c.entries)),
    latest: latest
      ? { session: latest.session, project: latest.project, entries: latest.entries, chars: latest.chars, time: latest.time }
      : null,
  }
}

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
}

/** Approximate display width: CJK and fullwidth forms count as 2 columns. */
export function displayWidth(text) {
  let width = 0
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0)
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff)
    ) width += 2
    else width += 1
  }
  return width
}

function pad(text, width) {
  const value = String(text)
  const gap = width - displayWidth(value)
  return gap > 0 ? value + ' '.repeat(gap) : value
}

function table(rows, columns, color) {
  const widths = columns.map((col) => Math.max(displayWidth(col.header), ...rows.map((row) => displayWidth(row[col.key] ?? ''))))
  const header = columns.map((col, i) => pad(col.header, widths[i])).join('  ')
  const lines = [color ? `${ANSI.dim}${header}${ANSI.reset}` : header]
  for (const row of rows) {
    lines.push(columns.map((col, i) => pad(row[col.key] ?? '', widths[i])).join('  ').replace(/\s+$/, ''))
  }
  return lines.join('\n')
}

const SOURCE_LABEL = {
  'user-dsh': 'user',
  'user-agents': 'agents',
  'project-dsh': 'proj',
  'project-agents': 'proj',
  custom: 'custom',
  'project-other': 'other-proj',
  bundled: 'bundled',
}

/**
 * Render a report for a terminal.
 * @param {ReturnType<typeof buildReport>} report
 * @param {{color?: boolean}} [options]
 */
export function renderText(report, options = {}) {
  const color = options.color !== false
  const c = (name, text) => (color ? `${ANSI[name]}${text}${ANSI.reset}` : text)
  const lines = []
  const { catalog, usage } = report
  const pct = (n, d) => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(1))

  lines.push(c('bold', 'DSH 技能体检报告'))
  lines.push(c('dim', `目录 ${report.cwd}`))
  lines.push(c('dim', `生成 ${report.generatedAt}`))
  lines.push('')

  lines.push(c('bold', '■ 真实会话里，一次会话要背多少'))
  if (catalog.observed.sessions > 0) {
    const o = catalog.observed
    lines.push(`  catalog 快照    ${o.sessions} 份（最近一份 ${catalog.measuredEntries} 条 · 历史最大 ${o.maxEntries} 条）`)
    lines.push(`  每份字符数      中位 ${c('bold', String(o.medianChars))} · 平均 ${o.avgChars} · 最小 ${o.minChars} · 最大 ${o.maxChars}`)
    lines.push(`  中位 token 估算 ≈ ${estimateTokens(o.medianChars)} ${c('dim', '(chars÷4，仅用于量级判断)')}`)
  } else {
    lines.push('  没有会话快照，只能按文件系统重建。')
  }
  lines.push('')

  lines.push(c('bold', '■ 开销归属'))
  lines.push(`  本地技能        ${catalog.localEntries} 个 · ${catalog.localChars} 字符 ≈ ${catalog.localTokensEstimate} tokens（你能治理的部分）`)
  lines.push(`  全部 catalog 行  ${catalog.measuredEntries} 条 · ${catalog.measuredChars} 字符 ≈ ${catalog.measuredTokensEstimate} tokens（含内置/其它项目）`)
  const mix = Object.entries(catalog.sourceMix).map(([k, v]) => `${SOURCE_LABEL[k] ?? k} ${v}`).join(' · ')
  lines.push(c('dim', `  来源分布        ${mix}`))
  lines.push('')

  lines.push(c('bold', '■ 观测到的使用'))
  lines.push(`  会话文件        ${usage.files}（${usage.sessions} 个会话，${usage.events} 条相关事件）`)
  lines.push(`  真实加载        ${usage.skillCalls} 次 · ${usage.distinctSkillsLoaded} 个技能 · 覆盖 ${usage.projectsWithLoads} 个项目`)
  if (usage.userInvocations > 0) lines.push(`  用户 / 调用     ${usage.userInvocations} 次`)
  lines.push('')

  lines.push(c('bold', '■ 结论'))
  lines.push(
    `  从未观测到加载的本地技能：${c('yellow', String(catalog.unobserved))} / ${catalog.localEntries} 个，` +
    `占本地 catalog 字符 ${c('yellow', `${pct(catalog.unobservedChars, catalog.localChars)}%`)}（${catalog.unobservedChars} 字符 ≈ ${catalog.unobservedTokensEstimate} tokens）`,
  )
  if (report.catalogOnly.length > 0) {
    lines.push(c('dim', `  另有 ${report.catalogOnly.length} 条只在会话 catalog 里出现（内置/其它项目，不可从这里归档）`))
  }
  lines.push('')

  const sections = [
    ['最该归档（0 次观测加载，按 catalog 成本降序）', report.buckets.archiveCandidates, true],
    ['高成本低使用（1–2 次）', report.buckets.expensiveLowUse, true],
    ['高价值（≥3 次，按 tokens/次 升序）', report.buckets.highValue, true],
  ]
  for (const [title, rows] of sections) {
    if (rows.length === 0) continue
    lines.push(c('bold', `■ ${title}`))
    lines.push(
      table(
        rows.map((s) => ({
          chars: String(s.catalogChars),
          loads: s.loads === 0 ? '0' : String(s.loads),
          source: SOURCE_LABEL[s.source] ?? s.source,
          name: s.pinned ? `${s.name} (pinned)` : s.name,
          last: s.lastUsed ? new Date(s.lastUsed).toISOString().slice(0, 10) : '-',
        })),
        [
          { key: 'chars', header: '字符' },
          { key: 'loads', header: '加载' },
          { key: 'source', header: '来源' },
          { key: 'name', header: '技能' },
          { key: 'last', header: '最近' },
        ],
        color,
      ),
    )
    lines.push('')
  }

  if (report.warnings.length > 0) {
    lines.push(c('bold', '■ 读数须知'))
    for (const warning of report.warnings) lines.push(`  · ${warning}`)
    lines.push('')
  }

  lines.push(c('dim', '默认只读。归档前用 `dsh-skill-curator archive <name> --dry-run` 预览；归档进 <root>/.archive/，可 restore 恢复。'))
  return lines.join('\n')
}

/**
 * Render a GitHub-friendly markdown report.
 * @param {ReturnType<typeof buildReport>} report
 */
export function renderMarkdown(report) {
  const { catalog, usage } = report
  const pct = (n, d) => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(1))
  const lines = []
  lines.push('# DSH 技能体检报告')
  lines.push('')
  lines.push(`- 目录：\`${report.cwd}\``)
  lines.push(`- 生成时间：${report.generatedAt}`)
  lines.push('')
  lines.push('## 总览')
  lines.push('')
  lines.push('| 指标 | 数值 |')
  lines.push('| --- | --- |')
  if (catalog.observed.sessions > 0) {
    lines.push(`| 真实 catalog 快照 | ${catalog.observed.sessions} 份 · ${catalog.observed.maxEntries} 条技能 |`)
    lines.push(`| 每会话 catalog 字符 | 中位 ${catalog.observed.medianChars} · 最大 ${catalog.observed.maxChars} |`)
    lines.push(`| 中位 token 估算 | ≈ ${estimateTokens(catalog.observed.medianChars)}（chars÷4） |`)
  }
  lines.push(`| 本地技能 | ${catalog.localEntries} 个 · ${catalog.localChars} 字符 |`)
  lines.push(`| 全部 catalog 行 | ${catalog.measuredEntries} 条 · ${catalog.measuredChars} 字符 |`)
  lines.push(`| 真实加载 | ${usage.skillCalls} 次 · ${usage.distinctSkillsLoaded} 个技能 |`)
  lines.push(`| 从未观测到加载 | ${catalog.unobserved} 个（${pct(catalog.unobservedChars, catalog.localChars)}%，${catalog.unobservedChars} 字符） |`)
  lines.push('')
  const sections = [
    ['最该归档', report.buckets.archiveCandidates],
    ['高成本低使用', report.buckets.expensiveLowUse],
    ['高价值', report.buckets.highValue],
  ]
  for (const [title, rows] of sections) {
    if (rows.length === 0) continue
    lines.push(`## ${title}`)
    lines.push('')
    lines.push('| 技能 | 字符 | 加载 | 来源 | 最近使用 |')
    lines.push('| --- | ---: | ---: | --- | --- |')
    for (const s of rows) {
      lines.push(`| \`${s.name}\` | ${s.catalogChars} | ${s.loads} | ${SOURCE_LABEL[s.source] ?? s.source} | ${s.lastUsed ? new Date(s.lastUsed).toISOString().slice(0, 10) : '-'} |`)
    }
    lines.push('')
  }
  if (report.warnings.length > 0) {
    lines.push('## 读数须知')
    lines.push('')
    for (const warning of report.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Machine-readable shape for the plugin UI / other tools. */
export function renderJson(report) {
  return JSON.stringify(report, null, 2)
}
