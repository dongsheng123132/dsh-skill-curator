/**
 * Minimal, dependency-free YAML frontmatter parser.
 *
 * DSH parses SKILL.md frontmatter with the full `yaml` package. We only need a
 * handful of top-level fields, so this module implements the subset that real
 * skills actually use, and *fails loudly* instead of guessing:
 *
 *   key: plain value
 *   key: "double quoted \u escape"
 *   key: 'single quoted with '' escape'
 *   key: |      literal block scalar (with optional + / - chomping)
 *   key: >      folded block scalar (with optional + / - chomping)
 *   key: value # trailing comment
 *
 * Anything it cannot parse becomes `null` from parseFrontmatter, and callers
 * must report the file as invalid rather than inventing a description.
 */

/** Strip a trailing YAML comment from an unquoted scalar. */
function stripComment(value) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && inDouble) { i++; continue }
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd()
    }
  }
  return value.trimEnd()
}

/** Decode a YAML double-quoted scalar body (without the surrounding quotes). */
function decodeDoubleQuoted(body) {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') { out += ch; continue }
    const next = body[++i]
    switch (next) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case '0': out += '\0'; break
      case 'a': out += '\x07'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case 'v': out += '\v'; break
      case 'e': out += '\x1b'; break
      case 'N': out += '\u0085'; break
      case '_': out += '\u00a0'; break
      case 'L': out += '\u2028'; break
      case 'P': out += '\u2029'; break
      case 'x': {
        const hex = body.slice(i + 1, i + 3)
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error('bad \\x escape')
        out += String.fromCharCode(parseInt(hex, 16))
        i += 2
        break
      }
      case 'u': {
        const hex = body.slice(i + 1, i + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('bad \\u escape')
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
        break
      }
      case 'U': {
        const hex = body.slice(i + 1, i + 9)
        if (!/^[0-9a-fA-F]{8}$/.test(hex)) throw new Error('bad \\U escape')
        out += String.fromCodePoint(parseInt(hex, 16))
        i += 8
        break
      }
      default: out += next
    }
  }
  return out
}

/** Find the closing quote of a quoted scalar, honoring escapes / doubles. */
function findQuoteEnd(text, start, quote) {
  for (let i = start + 1; i < text.length; i++) {
    if (quote === '"') {
      if (text[i] === '\\') { i++; continue }
      if (text[i] === '"') return i
    } else {
      if (text[i] === "'") {
        if (text[i + 1] === "'") { i++; continue }
        return i
      }
    }
  }
  return -1
}

/** Indentation width of a line (tabs count as one, matching YAML's ban on tabs). */
function indentOf(line) {
  let n = 0
  while (n < line.length && line[n] === ' ') n++
  return n
}

/**
 * Parse the frontmatter block of a SKILL.md document.
 *
 * @param {string} raw - full file text.
 * @returns {{data: Record<string, string|boolean|number>, body: string} | null}
 *   `null` when there is no frontmatter or the block is malformed.
 */
export function parseFrontmatter(raw) {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const normalized = text.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---')) return null
  const firstBreak = normalized.indexOf('\n')
  if (firstBreak === -1 || normalized.slice(0, firstBreak).trim() !== '---') return null

  const rest = normalized.slice(firstBreak + 1)
  const lines = rest.split('\n')
  let close = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') { close = i; break }
  }
  if (close === -1) return null

  const head = lines.slice(0, close)
  const body = lines.slice(close + 1).join('\n')
  const data = Object.create(null)

  for (let i = 0; i < head.length; i++) {
    const line = head[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const m = /^([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$/.exec(line)
    if (!m) {
      // A continuation or a nested line we do not need. Reject only when it
      // looks like a broken top-level key (e.g. tab indentation).
      if (indentOf(line) === 0) throw new Error(`unparsable frontmatter line: ${line}`)
      continue
    }
    const key = m[1]
    const rawValue = (m[2] ?? '').trimEnd()

    // Block scalar: `|`, `|-`, `|+`, `>`, `>-`, `>+`
    const block = /^([|>])([+-]?)$/.exec(rawValue)
    if (block) {
      const collected = []
      let j = i + 1
      let blockIndent = -1
      for (; j < head.length; j++) {
        const l = head[j]
        if (l.trim() === '') { collected.push(''); continue }
        const ind = indentOf(l)
        if (ind === 0) break
        if (blockIndent === -1) blockIndent = ind
        collected.push(ind >= blockIndent ? l.slice(blockIndent) : l.trimStart())
      }
      i = j - 1
      while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
      const joined = block[1] === '|'
        ? collected.join('\n')
        : collected.reduce((acc, l, idx) => {
            if (idx === 0) return l
            if (l === '') return `${acc}\n`
            if (acc.endsWith('\n')) return acc + l
            return `${acc} ${l}`
          }, '')
      data[key] = block[2] === '-' ? joined : `${joined}\n`
      continue
    }

    // Quoted scalar, possibly spanning lines.
    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const quote = rawValue[0]
      let combined = rawValue
      let end = findQuoteEnd(combined, 0, quote)
      while (end === -1 && i + 1 < head.length) {
        i++
        combined += `\n${head[i]}`
        end = findQuoteEnd(combined, 0, quote)
      }
      if (end === -1) throw new Error(`unterminated quoted value for ${key}`)
      const inner = combined.slice(1, end)
      const trailing = combined.slice(end + 1).trim()
      if (trailing !== '' && !trailing.startsWith('#')) throw new Error(`junk after quoted value for ${key}`)
      data[key] = quote === '"' ? decodeDoubleQuoted(inner) : inner.replaceAll("''", "'")
      continue
    }

    // Plain scalar, possibly continued on more-indented lines.
    let value = stripComment(rawValue)
    let j = i + 1
    const continuations = []
    for (; j < head.length; j++) {
      const l = head[j]
      if (l.trim() === '') break
      if (indentOf(l) === 0) break
      continuations.push(l.trim())
    }
    if (continuations.length > 0) {
      i = j - 1
      value = [value, ...continuations].filter(Boolean).join(' ')
    }
    if (value === '') { data[key] = ''; continue }
    if (value === 'true') { data[key] = true; continue }
    if (value === 'false') { data[key] = false; continue }
    if (/^-?\d+$/.test(value)) { data[key] = Number(value); continue }
    data[key] = value
  }

  return { data, body }
}
