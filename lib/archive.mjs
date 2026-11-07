import { createHash } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { discoverSkills } from './discover.mjs'
import { skillRoots, stateDir } from './paths.mjs'

const MANIFEST_NAME = 'manifest.json'

/** Read the pin set from `<dsh-home>/skill-curator/pins.json`. */
export function readPins(options = {}) {
  const file = join(options.stateDirPath ?? stateDir(), 'pins.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed.pins) ? parsed.pins.filter((n) => typeof n === 'string') : []
  } catch {
    return []
  }
}

/**
 * Atomically persist the pin set.
 * @param {string[]} pins
 */
export function writePins(pins, options = {}) {
  const dir = options.stateDirPath ?? stateDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'pins.json')
  atomicWrite(file, `${JSON.stringify({ pins: [...new Set(pins)].sort() }, null, 2)}\n`)
}

/** Add or remove one pin and return the resulting set. */
export function setPin(name, pinned, options = {}) {
  const pins = new Set(readPins(options))
  if (pinned) pins.add(name)
  else pins.delete(name)
  writePins([...pins], options)
  return [...pins].sort()
}

/**
 * Write a file atomically (temp file in the same directory + rename).
 * @param {string} file
 * @param {string} content
 */
export function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content)
  renameSync(tmp, file)
}

function sha256File(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

function manifestPath(root) {
  return join(root, '.archive', MANIFEST_NAME)
}

function readManifest(root) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(root), 'utf8'))
    return Array.isArray(parsed.entries) ? parsed : { entries: [] }
  } catch {
    return { entries: [] }
  }
}

function writeManifest(root, manifest) {
  const dir = join(root, '.archive')
  mkdirSync(dir, { recursive: true })
  atomicWrite(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Find the winning local skill by exact name.
 * @param {string} name
 * @param {object} [options]
 */
export function findSkill(name, options = {}) {
  const { skills } = discoverSkills(options)
  return skills.find((s) => s.name === name)
}

/**
 * Preview an archive operation without touching the filesystem.
 * @param {string} name
 * @param {object} [options]
 */
export function planArchive(name, options = {}) {
  const skill = findSkill(name, options)
  if (!skill) return { ok: false, error: `没有找到技能 "${name}"（只匹配本地根里胜出的技能）` }
  if (skill.source === 'bundled') return { ok: false, error: `"${name}" 来自内置/外部包，不在可归档范围` }
  const pins = readPins(options)
  if (pins.includes(name)) return { ok: false, error: `"${name}" 已被 pin 保护，先 unpin 才能归档` }
  const kind = skill.path.endsWith('SKILL.md') ? 'dir' : 'file'
  const targetName = kind === 'dir' ? name : `${name}.md`
  return {
    ok: true,
    skill,
    kind,
    from: kind === 'dir' ? skill.directory : skill.path,
    to: join(skill.root, '.archive', targetName),
  }
}

/**
 * Move one skill into its root's `.archive/` and record a manifest entry.
 *
 * The archive directory is never scanned by DSH (one level per root, and
 * `.archive` carries no SKILL.md), so the skill leaves the catalog while
 * staying on disk. Restore is a rename back.
 *
 * @param {string} name
 * @param {{cwd?: string, dryRun?: boolean}} [options]
 */
export function archiveSkill(name, options = {}) {
  const plan = planArchive(name, options)
  if (!plan.ok) return plan
  if (options.dryRun) return { ...plan, dryRun: true }

  mkdirSync(join(plan.skill.root, '.archive'), { recursive: true })
  if (existsSync(plan.to)) return { ok: false, error: `归档目标已存在：${plan.to}` }

  movePath(plan.from, plan.to)

  const manifest = readManifest(plan.skill.root)
  manifest.entries = manifest.entries.filter((e) => e.name !== name)
  manifest.entries.push({
    name,
    kind: plan.kind,
    source: plan.skill.source,
    from: plan.from,
    to: plan.to,
    archivedAt: new Date().toISOString(),
    sha256: plan.kind === 'dir' ? sha256File(join(plan.to, 'SKILL.md')) : sha256File(plan.to),
  })
  writeManifest(plan.skill.root, manifest)

  return { ok: true, name, kind: plan.kind, from: plan.from, to: plan.to }
}

/**
 * Restore one archived skill back to its original path.
 * @param {string} name
 * @param {{cwd?: string, dryRun?: boolean}} [options]
 */
export function restoreSkill(name, options = {}) {
  const roots = skillRoots(options)
  for (const root of roots) {
    const manifest = readManifest(root.path)
    const entry = manifest.entries.find((e) => e.name === name)
    if (!entry) continue
    if (!existsSync(entry.to)) {
      return { ok: false, error: `清单里有 "${name}"，但归档文件不存在：${entry.to}` }
    }
    if (existsSync(entry.from)) {
      return { ok: false, error: `原位置已被占用：${entry.from}（先移走它再恢复）` }
    }
    if (options.dryRun) return { ok: true, dryRun: true, name, from: entry.to, to: entry.from }
    movePath(entry.to, entry.from)
    manifest.entries = manifest.entries.filter((e) => e.name !== name)
    writeManifest(root.path, manifest)
    return { ok: true, name, from: entry.to, to: entry.from }
  }
  return { ok: false, error: `没有 "${name}" 的归档记录` }
}

/** List every archived skill across all visible roots. */
export function listArchived(options = {}) {
  const out = []
  for (const root of skillRoots(options)) {
    const manifest = readManifest(root.path)
    for (const entry of manifest.entries) {
      out.push({ ...entry, root: root.path, rootSource: root.source, present: existsSync(entry.to) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function movePath(from, to) {
  try {
    renameSync(from, to)
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      // Cross-device: copy then remove. Slow but correct.
      cpSync(from, to, { recursive: true })
      rmSync(from, { recursive: true, force: true })
      return
    }
    throw error
  }
}

/** Copy (not move) a skill — used by tests and `--copy` previews. */
export function copySkill(from, to) {
  cpSync(from, to, { recursive: true })
}
