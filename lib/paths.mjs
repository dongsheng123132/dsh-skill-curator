import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Root ranks, mirroring @deepseek-ai/dsh-skill-filesystem exactly. */
export const RANK = Object.freeze({
  'project-dsh': 100,
  'project-agents': 200,
  custom: 300,
  'user-dsh': 400,
  'user-agents': 500,
  bundled: 600,
})

/** Resolve the DSH home the same way the launcher does (DSH_HOME override). */
export function dshHome() {
  return process.env.DSH_HOME ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

/** Directory where this tool keeps its own state (pins, last report). */
export function stateDir() {
  return join(dshHome(), 'skill-curator')
}

/** Default session-log root. */
export function sessionsDir() {
  return join(dshHome(), 'sessions')
}

/**
 * Build the ordered skill-root list for a working directory.
 *
 * Order and ranks are the contract DSH itself uses: lower rank wins a
 * duplicate name, and the catalog a session sees is the set of winners.
 *
 * @param {{cwd?: string, dshHomePath?: string, agentsHome?: string, customDirs?: string[]}} [options]
 * @returns {Array<{path: string, source: string, rank: number}>}
 */
export function skillRoots(options = {}) {
  const home = options.dshHomePath ?? dshHome()
  const agents = options.agentsHome ?? join(homedir(), '.agents')
  const roots = []
  if (options.cwd) {
    const projectRoot = findProjectRoot(options.cwd)
    // Running from $HOME makes the project root the home directory, which
    // would scan the user skill roots twice under a "project" label. Skip the
    // duplicate: the effective catalog is unchanged.
    if (projectRoot !== homedir()) {
      roots.push(
        { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: RANK['project-dsh'] },
        { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: RANK['project-agents'] },
      )
    }
  }
  for (const dir of options.customDirs ?? []) {
    roots.push({ path: dir, source: 'custom', rank: RANK.custom })
  }
  roots.push(
    { path: join(home, 'skills'), source: 'user-dsh', rank: RANK['user-dsh'], skipSystem: true },
    { path: join(agents, 'skills'), source: 'user-agents', rank: RANK['user-agents'] },
  )
  if (process.env.DSH_BUNDLED_SKILL_DIR) {
    roots.push({ path: process.env.DSH_BUNDLED_SKILL_DIR, source: 'bundled', rank: RANK.bundled })
  }
  return roots
}

/** Walk up to the nearest directory containing `.git`, else the original cwd. */
export function findProjectRoot(cwd) {
  // Resolve first: session logs contain relative or stray cwds, and a relative
  // path makes `join(current, '..')` grow forever instead of converging.
  const start = resolve(cwd || '.')
  let current = start
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}
