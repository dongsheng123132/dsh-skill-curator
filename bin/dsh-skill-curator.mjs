#!/usr/bin/env node
/**
 * dsh-skill-curator — measure, understand, and reversibly trim the DSH skill
 * catalog. Default posture is read-only; nothing is moved without `archive`
 * plus an explicit confirmation.
 */
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildReport, renderJson, renderMarkdown, renderText } from '../lib/report.mjs'
import { archiveSkill, findSkill, listArchived, planArchive, readPins, restoreSkill, setPin } from '../lib/archive.mjs'
import { discoverSkills } from '../lib/discover.mjs'
import { dshHome, sessionsDir, skillRoots, stateDir } from '../lib/paths.mjs'

const USAGE = `dsh-skill-curator — DSH 技能治理（默认只读）

用法:
  dsh-skill-curator                     体检报告（终端）
  dsh-skill-curator report --json       机器可读 JSON
  dsh-skill-curator report --md         可发布 Markdown
  dsh-skill-curator report --no-sessions  只看文件系统，不扫会话
  dsh-skill-curator explain <name>      单个技能的全部证据
  dsh-skill-curator archive <name...>   归档（移入 <root>/.archive/，需确认）
     --dry-run                          只预览，不动文件
     --yes                              跳过交互确认
  dsh-skill-curator restore <name...>   从 .archive/ 恢复
  dsh-skill-curator archived            列出已归档
  dsh-skill-curator pin <name>          保护：pin 过的技能不许归档
  dsh-skill-curator unpin <name>
  dsh-skill-curator doctor              自检：根、会话目录、归档是否真的不被扫描

全局: --cwd <path>  --sessions <path>  --dsh-home <path>  --no-color  --limit <n>
`

function parseArgs(argv) {
  const flags = { _: [] }
  const takesValue = new Set(['cwd', 'sessions', 'dsh-home', 'limit'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { flags._.push(arg); continue }
    const [rawKey, inline] = arg.slice(2).split('=')
    const key = rawKey
    if (key === 'no-color' || key === 'no-sessions' || key === 'json' || key === 'md' || key === 'dry-run' || key === 'yes' || key === 'help') {
      flags[key] = true
      continue
    }
    if (takesValue.has(key)) {
      flags[key] = inline ?? argv[++i]
      continue
    }
    flags[key] = inline ?? true
  }
  return flags
}

function optionsFrom(flags) {
  return {
    cwd: flags.cwd ? String(flags.cwd) : process.cwd(),
    dshHomePath: flags['dsh-home'] ? String(flags['dsh-home']) : dshHome(),
    sessionsDir: flags.sessions ? String(flags.sessions) : sessionsDir(),
    stateDirPath: flags['dsh-home'] ? join(String(flags['dsh-home']), 'skill-curator') : stateDir(),
  }
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve))
    return /^(y|yes|是|确认)$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

function fail(message, code = 1) {
  process.stderr.write(`✗ ${message}\n`)
  process.exit(code)
}

function fmtDate(ms) {
  if (!ms) return '-'
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'report'
  const rest = argv[0] && !argv[0].startsWith('--') ? argv.slice(1) : argv
  const flags = parseArgs(rest)
  const options = optionsFrom(flags)

  if (flags.help || command === 'help') {
    process.stdout.write(USAGE)
    return
  }

  switch (command) {
    case 'report': {
      const report = buildReport({
        ...options,
        skipSessions: flags['no-sessions'] === true,
        limit: flags.limit ? Number(flags.limit) : 10,
      })
      if (flags.json) process.stdout.write(`${renderJson(report)}\n`)
      else if (flags.md) process.stdout.write(`${renderMarkdown(report)}\n`)
      else process.stdout.write(`${renderText(report, { color: !flags['no-color'] })}\n`)
      return
    }

    case 'explain': {
      const name = flags._[0]
      if (!name) fail('缺少技能名', 2)
      const report = buildReport({ ...options, limit: 1 })
      const skill = report.skills.find((s) => s.name === name)
      if (!skill) {
        const external = report.external.find((s) => s.name === name)
        if (external) {
          process.stdout.write(`${name}\n  来源: 内置/外部（不在本地根，不可归档）\n`)
          return
        }
        fail(`没有找到技能 "${name}"`)
      }
      const lines = [
        skill.name,
        `  来源      ${skill.source} (rank ${skill.rank})`,
        `  路径      ${skill.path}`,
        `  catalog   ${skill.catalogChars} 字符 ≈ ${Math.ceil(skill.catalogChars / 4)} tokens`,
        `  正文      ${skill.bodyBytes} 字节`,
        `  加载      ${skill.loads} 次 / ${skill.sessionsWithLoad} 个会话`,
        `  最近使用  ${fmtDate(skill.lastUsed)}`,
        `  出现于会话 catalog  ${skill.observedInCatalog ? '是' : '否（可能被遮蔽或未发布）'}`,
        `  可归档    ${skill.archivable ? '是' : '否（内置/外部）'}${skill.pinned ? ' · 📌 已 pin' : ''}`,
        '',
        `  ${skill.description}`,
      ]
      process.stdout.write(`${lines.join('\n')}\n`)
      return
    }

    case 'archive': {
      const names = flags._
      if (names.length === 0) fail('缺少技能名', 2)
      const plans = names.map((name) => planArchive(name, options))
      const bad = plans.filter((p) => !p.ok)
      if (bad.length > 0) {
        for (const b of bad) process.stderr.write(`✗ ${b.error}\n`)
        process.exit(1)
      }
      for (const plan of plans) {
        process.stdout.write(`→ ${plan.skill.name}\n    ${plan.from}\n    ⇒ ${plan.to}\n`)
      }
      if (flags['dry-run']) {
        process.stdout.write('（dry-run：未改动任何文件）\n')
        return
      }
      if (!flags.yes) {
        const ok = await confirm(`确认归档 ${plans.length} 个技能？可用 restore 恢复 [y/N] `)
        if (!ok) {
          process.stdout.write('已取消。\n')
          return
        }
      }
      let moved = 0
      for (const plan of plans) {
        const result = archiveSkill(plan.skill.name, options)
        if (!result.ok) {
          process.stderr.write(`✗ ${plan.skill.name}: ${result.error}\n`)
          continue
        }
        moved++
        process.stdout.write(`✓ 已归档 ${result.name} → ${result.to}\n`)
      }
      process.stdout.write(`共归档 ${moved} 个。恢复：dsh-skill-curator restore <name>\n`)
      return
    }

    case 'restore': {
      const names = flags._
      if (names.length === 0) fail('缺少技能名', 2)
      let restored = 0
      for (const name of names) {
        if (flags['dry-run']) {
          const preview = restoreSkill(name, options)
          if (!preview.ok) { process.stderr.write(`✗ ${preview.error}\n`); continue }
          process.stdout.write(`→ ${name}: ${preview.from} ⇒ ${preview.to}\n`)
          continue
        }
        const result = restoreSkill(name, options)
        if (!result.ok) {
          process.stderr.write(`✗ ${name}: ${result.error}\n`)
          continue
        }
        restored++
        process.stdout.write(`✓ 已恢复 ${name} → ${result.to}\n`)
      }
      if (flags['dry-run']) process.stdout.write('（dry-run：未改动任何文件）\n')
      else process.stdout.write(`共恢复 ${restored} 个。\n`)
      return
    }

    case 'archived': {
      const archived = listArchived(options)
      if (archived.length === 0) {
        process.stdout.write('没有已归档的技能。\n')
        return
      }
      for (const entry of archived) {
        process.stdout.write(`${entry.present ? '✓' : '!'} ${entry.name.padEnd(32)} ${entry.kind.padEnd(4)} ${entry.archivedAt.slice(0, 16)}  ${entry.to}\n`)
      }
      return
    }

    case 'pin':
    case 'unpin': {
      const name = flags._[0]
      if (!name) fail('缺少技能名', 2)
      const pins = setPin(name, command === 'pin', options)
      process.stdout.write(`${command === 'pin' ? '📌 已 pin' : '已 unpin'} ${name}\n当前 pin: ${pins.join(', ') || '(空)'}\n`)
      return
    }

    case 'doctor': {
      const roots = skillRoots(options)
      const discovered = discoverSkills(options)
      const lines = ['DSH 技能治理自检', '']
      lines.push(`DSH home      ${options.dshHomePath}`)
      lines.push(`会话目录      ${options.sessionsDir}${existsSync(options.sessionsDir) ? '' : '  (不存在)'}`)
      lines.push(`状态目录      ${options.stateDirPath}`)
      lines.push('')
      lines.push('技能根（rank 小的优先）:')
      for (const root of discovered.roots) {
        lines.push(`  ${root.exists ? '✓' : '-'} [${String(root.rank).padStart(3)}] ${root.source.padEnd(14)} ${String(root.count).padStart(3)} 个  ${root.path}`)
      }
      lines.push('')
      lines.push(`发现技能      ${discovered.skills.length} 个（胜出后）`)
      lines.push(`被遮蔽        ${discovered.shadowed.length}`)
      lines.push(`无法解析      ${discovered.invalid.length}`)
      lines.push(`pin            ${readPins(options).join(', ') || '(空)'}`)
      lines.push(`已归档        ${listArchived(options).length}`)
      lines.push('')
      const archiveDirs = roots.filter((r) => existsSync(join(r.path, '.archive')))
      lines.push(`归档目录      ${archiveDirs.length} 个（.archive 不含 SKILL.md，DSH 只扫一层，因此不会进入 catalog）`)
      const leaked = discovered.skills.filter((s) => s.path.includes('/.archive/'))
      lines.push(`泄漏检查      ${leaked.length === 0 ? '通过：没有 .archive 下的技能进入 catalog' : `失败：${leaked.length} 个`}`)
      process.stdout.write(`${lines.join('\n')}\n`)
      return
    }

    default:
      process.stderr.write(`未知命令: ${command}\n\n${USAGE}`)
      process.exit(2)
  }
}

main().catch((error) => {
  process.stderr.write(`✗ ${error && error.stack ? error.stack : String(error)}\n`)
  process.exit(1)
})
