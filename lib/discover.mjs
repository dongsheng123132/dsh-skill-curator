import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter.mjs'
import { findProjectRoot, skillRoots } from './paths.mjs'

/** Public skill-name grammar, identical to @deepseek-ai/dsh-skill's isSkillName. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Catalog description cap used by @deepseek-ai/dsh-tool-skill. */
export const CATALOG_DESCRIPTION_MAX_LENGTH = 500

/**
 * Escape model-facing prose exactly like the host does, so measured catalog
 * bytes match what the model actually receives.
 * @param {string} value
 * @returns {string}
 */
export function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Collapse and truncate a description exactly like the host catalog renderer.
 * @param {string} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function catalogDescription(value, maxLength = CATALOG_DESCRIPTION_MAX_LENGTH) {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

/**
 * Render one catalog line exactly like `renderCatalogEntries` does.
 * @param {{name: string, description: string}} entry
 * @returns {string}
 */
export function catalogLine(entry) {
  return `- \`${entry.name}\`: ${escapeText(catalogDescription(entry.description))}`
}

/**
 * Count code points (not UTF-16 units) — the unit tokenizers actually bill.
 * @param {string} text
 * @returns {number}
 */
export function charCount(text) {
  let n = 0
  for (const _ of text) n++
  return n
}

function readSkillFile(path) {
  const raw = readFileSync(path, 'utf8')
  const parsed = parseFrontmatter(raw)
  if (!parsed) return { error: 'missing or malformed YAML frontmatter' }
  const name = typeof parsed.data.name === 'string' ? parsed.data.name : undefined
  const description = typeof parsed.data.description === 'string' ? parsed.data.description : undefined
  if (!name) return { error: 'frontmatter requires name' }
  if (!description) return { error: 'frontmatter requires description' }
  if (!SKILL_NAME_RE.test(name)) return { error: `invalid skill name "${name}"` }
  const whenToUse = typeof parsed.data.whenToUse === 'string' ? parsed.data.whenToUse : undefined
  const modelInvocable = parsed.data['disable-model-invocation'] !== true
  const userInvocable = parsed.data['user-invocable'] !== false
  return {
    name,
    description,
    whenToUse,
    modelInvocable,
    userInvocable,
    body: parsed.body,
    bytes: Buffer.byteLength(raw, 'utf8'),
  }
}

/**
 * Discover every filesystem skill visible from a working directory.
 *
 * Mirrors @deepseek-ai/dsh-skill-filesystem: one directory level per root,
 * `<dir>/SKILL.md` bundles or flat `<name>.md` files, `.system` skipped in the
 * user root, lower rank wins duplicate names.
 *
 * @param {{cwd?: string, dshHomePath?: string, agentsHome?: string, customDirs?: string[]}} [options]
 * @returns {{
 *   roots: Array<{path: string, source: string, rank: number, exists: boolean, count: number}>,
 *   skills: Array<Record<string, any>>,
 *   shadowed: Array<Record<string, any>>,
 *   invalid: Array<{path: string, error: string}>,
 * }}
 */
export function discoverSkills(options = {}) {
  return discoverFromRoots(skillRoots(options))
}

/**
 * Discover skills from project-level roots only for a set of working
 * directories. Used to attribute names seen in session catalogs that are not
 * part of the user-level inventory.
 *
 * @param {string[]} cwds
 * @returns {Array<Record<string, any>>}
 */
export function discoverProjectSkills(cwds) {
  const seenRoots = new Set()
  const skills = []
  for (const cwd of cwds) {
    const projectRoot = findProjectRoot(cwd)
    if (seenRoots.has(projectRoot)) continue
    seenRoots.add(projectRoot)
    const roots = [
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200 },
    ]
    for (const skill of discoverFromRoots(roots).skills) {
      skills.push({ ...skill, projectRoot })
    }
  }
  return skills
}

/**
 * Discover every filesystem skill under an explicit root list.
 *
 * Mirrors @deepseek-ai/dsh-skill-filesystem: one directory level per root,
 * `<dir>/SKILL.md` bundles or flat `<name>.md` files, `.system` skipped in the
 * user root, lower rank wins duplicate names.
 *
 * @param {Array<{path: string, source: string, rank: number, skipSystem?: boolean}>} roots
 * @returns {{
 *   roots: Array<{path: string, source: string, rank: number, exists: boolean, count: number}>,
 *   skills: Array<Record<string, any>>,
 *   shadowed: Array<Record<string, any>>,
 *   invalid: Array<{path: string, error: string}>,
 * }}
 */
export function discoverFromRoots(roots) {
  const winners = new Map()
  const shadowed = []
  const invalid = []
  const rootSummary = []

  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root.path, { withFileTypes: true })
    } catch {
      rootSummary.push({ path: root.path, source: root.source, rank: root.rank, exists: false, count: 0 })
      continue
    }
    let count = 0
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of sorted) {
      if (root.skipSystem && entry.name === '.system') continue
      let filePath
      let directory
      if (entry.isDirectory()) {
        // `.archive` and other bookkeeping dirs simply have no SKILL.md and are
        // skipped by the host as well.
        directory = join(root.path, entry.name)
        filePath = join(directory, 'SKILL.md')
        try {
          if (!statSync(filePath).isFile()) continue
        } catch {
          continue
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        directory = root.path
        filePath = join(root.path, entry.name)
      } else {
        continue
      }

      let parsed
      try {
        parsed = readSkillFile(filePath)
      } catch (error) {
        invalid.push({ path: filePath, error: String(error && error.message ? error.message : error) })
        continue
      }
      if (parsed.error) {
        invalid.push({ path: filePath, error: parsed.error })
        continue
      }

      const record = {
        ...parsed,
        path: filePath,
        directory,
        root: root.path,
        source: root.source,
        rank: root.rank,
        catalogLine: catalogLine(parsed),
      }
      record.catalogChars = charCount(record.catalogLine)
      record.id = `${root.source}:${parsed.name}`

      const winner = winners.get(parsed.name)
      if (!winner) {
        winners.set(parsed.name, record)
        count++
        continue
      }
      if (record.rank < winner.rank) {
        shadowed.push({ ...winner, shadowedBy: record.id })
        winners.set(parsed.name, record)
        count++
      } else {
        shadowed.push({ ...record, shadowedBy: winner.id })
      }
    }
    rootSummary.push({ path: root.path, source: root.source, rank: root.rank, exists: true, count })
  }

  const skills = [...winners.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { roots: rootSummary, skills, shadowed, invalid }
}
