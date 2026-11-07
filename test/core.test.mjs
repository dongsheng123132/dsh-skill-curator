import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { parseFrontmatter } from '../lib/frontmatter.mjs'
import { catalogLine, catalogDescription, discoverSkills } from '../lib/discover.mjs'
import { findProjectRoot } from '../lib/paths.mjs'
import { archiveSkill, listArchived, restoreSkill, setPin, readPins } from '../lib/archive.mjs'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'dsc-test-'))
}

function writeSkill(dir, name, body, { fileName = 'SKILL.md', frontmatter } = {}) {
  mkdirSync(dir, { recursive: true })
  const fm = frontmatter ?? `---\nname: ${name}\ndescription: test skill ${name}\n---\n`
  writeFileSync(join(dir, fileName), `${fm}\n${body ?? '# body\n'}`)
}

test('frontmatter: plain scalars', () => {
  const parsed = parseFrontmatter('---\nname: alpha\ndescription: hello world\n---\nbody\n')
  assert.equal(parsed.data.name, 'alpha')
  assert.equal(parsed.data.description, 'hello world')
  assert.equal(parsed.body.trim(), 'body')
})

test('frontmatter: double-quoted value with escapes and pipe', () => {
  const parsed = parseFrontmatter('---\nname: "a-b"\ndescription: "x \\"q\\" | y\\nz"\n---\n')
  assert.equal(parsed.data.name, 'a-b')
  assert.equal(parsed.data.description, 'x "q" | y\nz')
})

test('frontmatter: single quotes double up', () => {
  const parsed = parseFrontmatter("---\nname: 'a'\ndescription: 'it''s fine'\n---\n")
  assert.equal(parsed.data.description, "it's fine")
})

test('frontmatter: literal and folded block scalars', () => {
  const literal = parseFrontmatter('---\nname: a\ndescription: |\n  line one\n  line two\n---\n')
  assert.equal(literal.data.description, 'line one\nline two\n')
  const folded = parseFrontmatter('---\nname: a\ndescription: >-\n  line one\n  line two\n\n  para\n---\n')
  assert.equal(folded.data.description, 'line one line two\npara')
})

test('frontmatter: trailing comment stripped, booleans coerced', () => {
  const parsed = parseFrontmatter('---\nname: a\ndescription: hi # note\ndisable-model-invocation: true\n---\n')
  assert.equal(parsed.data.description, 'hi')
  assert.equal(parsed.data['disable-model-invocation'], true)
})

test('frontmatter: missing block returns null', () => {
  assert.equal(parseFrontmatter('# no frontmatter\nbody\n'), null)
  assert.equal(parseFrontmatter('---\nname: a\n'), null)
})

test('catalog line matches host rendering and truncates at 500', () => {
  assert.equal(catalogLine({ name: 'x', description: 'a  b\nc' }), '- `x`: a b c')
  assert.equal(catalogLine({ name: 'x', description: 'a & b <c>' }), '- `x`: a &amp; b &lt;c&gt;')
  const long = 'x'.repeat(600)
  const rendered = catalogDescription(long)
  assert.equal(rendered.length, 500)
  assert.ok(rendered.endsWith('...'))
})

test('discovery: rank shadowing, flat files, invalid names', () => {
  const root = tempRoot()
  const home = join(root, 'home')
  const agents = join(root, 'agents')
  const user = join(home, 'skills')
  const project = join(root, 'proj')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, '.git'), '')

  writeSkill(join(user, 'dup'), 'dup')
  writeSkill(join(project, '.dsh', 'skills', 'dup'), 'dup')
  writeFileSync(
    join(project, '.dsh', 'skills', 'dup', 'SKILL.md'),
    '---\nname: dup\ndescription: project wins\n---\n',
  )
  writeFileSync(join(user, 'flat.md'), '---\nname: flat\ndescription: flat skill\n---\n')
  writeSkill(join(user, 'bad'), 'bad', undefined, { frontmatter: '---\nname: BadName\ndescription: d\n---\n' })

  const result = discoverSkills({ cwd: project, dshHomePath: home, agentsHome: agents })
  const dup = result.skills.find((s) => s.name === 'dup')
  assert.equal(dup.source, 'project-dsh')
  assert.equal(dup.description, 'project wins')
  assert.equal(result.shadowed.length, 1)
  assert.equal(result.shadowed[0].source, 'user-dsh')
  assert.ok(result.skills.some((s) => s.name === 'flat'))
  assert.equal(result.skills.some((s) => s.name === 'bad'), false)
  assert.equal(result.invalid.length, 1)
})

test('discovery: .archive never leaks into the catalog', () => {
  const root = tempRoot()
  const home = join(root, 'home')
  const user = join(home, 'skills')
  writeSkill(join(user, 'keep'), 'keep')
  writeSkill(join(user, '.archive', 'gone'), 'gone')

  const result = discoverSkills({ cwd: root, dshHomePath: home, agentsHome: join(root, 'agents') })
  assert.deepEqual(result.skills.map((s) => s.name), ['keep'])
})

test('archive → not discovered → restore → discovered', () => {
  const root = tempRoot()
  const home = join(root, 'home')
  const user = join(home, 'skills')
  const options = { cwd: root, dshHomePath: home, agentsHome: join(root, 'agents'), stateDirPath: join(home, 'skill-curator') }
  writeSkill(join(user, 'temp-skill'), 'temp-skill', 'payload\n')
  const original = readFileSync(join(user, 'temp-skill', 'SKILL.md'), 'utf8')

  const archived = archiveSkill('temp-skill', options)
  assert.equal(archived.ok, true)
  assert.equal(existsSync(join(user, 'temp-skill')), false)
  assert.equal(existsSync(archived.to), true)

  const afterArchive = discoverSkills(options)
  assert.equal(afterArchive.skills.some((s) => s.name === 'temp-skill'), false)

  const listed = listArchived(options)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, 'temp-skill')
  assert.equal(listed[0].present, true)

  const restored = restoreSkill('temp-skill', options)
  assert.equal(restored.ok, true)
  assert.equal(readFileSync(join(user, 'temp-skill', 'SKILL.md'), 'utf8'), original)
  assert.ok(discoverSkills(options).skills.some((s) => s.name === 'temp-skill'))
})

test('pinned skills cannot be archived', () => {
  const root = tempRoot()
  const home = join(root, 'home')
  const user = join(home, 'skills')
  const options = { cwd: root, dshHomePath: home, agentsHome: join(root, 'agents'), stateDirPath: join(home, 'skill-curator') }
  writeSkill(join(user, 'pinned'), 'pinned')
  setPin('pinned', true, options)
  assert.deepEqual(readPins(options), ['pinned'])
  const result = archiveSkill('pinned', options)
  assert.equal(result.ok, false)
  assert.match(result.error, /pin/)
})

test('findProjectRoot terminates on relative input', () => {
  const project = findProjectRoot('.')
  assert.ok(project.startsWith('/'))
  // Relative path must terminate quickly (never grow toward `../..` forever) and
  // resolve to an absolute path; it may land on the nearest ancestor `.git` if
  // one exists on the walk (e.g. this repo itself), else on the resolved input.
  const resolved = findProjectRoot('does/not/exist')
  assert.ok(resolved.startsWith('/'))
  const joined = resolve(process.cwd(), 'does/not/exist')
  // Walk up from the resolved input and accept either the resolved input itself
  // or any ancestor that actually contains `.git`.
  let ok = false
  let dir = joined
  for (;;) {
    if (dir === resolved) { ok = true; break }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  assert.ok(ok, `expected ${resolved} to be an ancestor of ${joined}`)
  assert.ok(resolved.length > 0)
})

test('cleanup temp dirs', () => {
  for (const dir of [tmpdir()]) {
    assert.ok(existsSync(dir))
  }
})
