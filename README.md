# dsh-skill-curator

**看清 DSH 技能目录花了多少钱 → 判断哪些该留 → 确认后归档，随时可恢复。**

A read-only-by-default skill auditor for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).
It measures the real catalog bill from your own session logs, attributes every
catalog line to a source root, and lets you reversibly archive what you do not
use.

[中文说明](#中文) · English below.

---

## Why

Every DSH session ships a `<available_skills>` catalog into the model context.
That catalog is cheap per skill and expensive in aggregate: on this machine a
single session carried a catalog message of **28,229 characters at the median,
36,202 at the maximum** — before a single skill body was loaded.

The catalog is also mostly dead weight: of 138 locally discovered skills, **115
were never loaded once** across 3,552 scanned sessions, and they account for
**75.1%** of the catalog's characters.

This tool exists to make that measurable and reversible instead of a guess.

## What it does not do

- It does not generate skills.
- It does not sync skills across tools.
- It does not invent savings percentages or dollar figures. Every number is
  traceable to `~/.dsh/sessions/**/session.v4.jsonl.zstd` or to a `SKILL.md` on
  disk, and anything unobserved is labelled **unobserved**, not "unused".
- It does not rewrite a skill you wrote.

## Install

```bash
npm install -g dsh-skill-curator      # CLI
dsh plugin --profile web add dsh-skill-curator   # optional: Settings panel
```

## CLI

```bash
dsh-skill-curator                      # terminal report (read-only)
dsh-skill-curator report --md          # publishable markdown
dsh-skill-curator report --json        # machine readable
dsh-skill-curator report --no-sessions # filesystem only, no usage evidence
dsh-skill-curator explain <name>       # every piece of evidence for one skill
dsh-skill-curator archive <name> --dry-run   # preview a move
dsh-skill-curator archive <name> --yes       # move into <root>/.archive/
dsh-skill-curator restore <name>       # put it back exactly where it was
dsh-skill-curator archived             # list every archived skill
dsh-skill-curator pin <name>           # protect from archiving
dsh-skill-curator doctor               # roots, sessions, leak check
```

## Where the numbers come from

| Number | Source |
| --- | --- |
| catalog characters per session | `user/message` events whose `source.kind` is `skill-catalog` — the exact text the model was billed |
| catalog line cost per skill | re-rendered with the host's own rules: ``- `name`: description``, whitespace collapsed, `<`/`>`/`&` escaped, 500-char cap |
| load count | `tool/call` events with `data.name === "skill"` and a `name` argument |
| user invocation count | `user/message` events with `source.kind === "skill-invocation"` |
| ownership / rank | the same five roots and ranks DSH uses: project `.dsh` 100, project `.agents` 200, custom 300, user `~/.dsh` 400, user `~/.agents` 500, bundled 600 |
| which skills exist | one directory level per root: `<dir>/SKILL.md` or flat `<name>.md`, frontmatter must carry a kebab-case `name` and a `description` |

Token figures are `chars ÷ 4` and are labelled as estimates. They are for
magnitude only — never a billing claim.

## Archive is a rename

`archive` moves the skill into `<root>/.archive/` and appends an entry to
`<root>/.archive/manifest.json` (original path, kind, sha256 of `SKILL.md`,
timestamp). DSH scans exactly one level per root and `.archive` carries no
`SKILL.md`, so the skill leaves the catalog immediately — and `restore` is a
rename back to the recorded path.

Guards:

- pinned skills refuse to archive (`pin` / `unpin`)
- bundled and other-project skills are never archivable from your user root
- an existing target or an occupied original path aborts instead of overwriting
- cross-device moves fall back to copy + remove

## Settings panel

When installed as a DSH plugin, a **技能治理** section appears in Settings with:

- four headline numbers: catalog entries, catalog chars per session, real load
  count, share of characters never loaded
- tabs for *0 loads (archive candidates)*, *1–2 loads but expensive*, *all
  catalog*, *archived*
- per-row `pin` and a two-step `归档` confirmation, plus one-click `恢复`
- a live counter of skill loads observed in the current process

The RPC channel is `/skill-curator` on the host's authenticated connection
service.

## Verified on

macOS, Node 22, DSH 0.2.2-rc.1. `node --test test/*.test.mjs` covers frontmatter
parsing (quoted / block scalars / comments), catalog rendering and truncation,
rank shadowing, `.archive` leak prevention, archive→restore round trip, pin
guards, RPC endpoints, live tracking, and a broken-connection fallback.

---

## 中文

**定位：技能治理管家。** 不生成技能、不跨工具同步，只做三件事：看清开销、判断去留、确认后可逆整理。

### 三条红线

1. 零原生依赖，只用 `node:` 内置模块；零硬编码路径（`DSH_HOME` 可覆盖）。
2. 默认只读；**未观测 ≠ 无用**；归档必须显式确认且可一键恢复。
3. 不自动改写任何手写技能。

### 为什么不用"节省比例/美元"做卖点

不同模型、不同缓存策略、不同上下文窗口下，同一个 catalog 的真实费用差一个数量级。
本工具只报**可复现的字符数与观测次数**，token 一律标注为 `chars÷4` 估算。
要传播就用这两个数字：**"115 个技能从未被加载，占 catalog 字符 75.1%"** ——
每一个都能在你自己的会话日志里复核。

### 本机实测（2026-11-07，3552 个会话）

```
catalog 快照      58 份 · 最近一份 148 条 · 历史最大 165 条
每份字符数        中位 28,229 · 平均 30,709 · 最大 36,202
本地技能          138 个 · 29,737 字符
真实加载          76 次 · 29 个技能 · 覆盖 11 个项目
从未观测到加载    115 / 138 个（占本地 catalog 字符 75.1%）
```

顺带查出一个真实问题：`~/.agents/skills/watchos/SKILL.md` 的 `name: watchOS`
不符合 kebab-case 语法，DSH 根本不会加载它 —— `doctor` / `report` 会把它列在
"无法解析" 里，而不是悄悄忽略。
