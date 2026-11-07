window.__ModuleLoader__.load({
  id: "skill-curator",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useState } = React;

    const CHANNEL = "/skill-curator";

    const CSS = `
.dsc-section{width:100%;max-width:820px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}
.dsc-head{align-items:flex-start;gap:10px;justify-content:space-between;display:flex}
.dsc-head h3{margin:0;font-size:15px;font-weight:600;line-height:22px}
.dsc-sub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px}
.dsc-actions{align-items:center;gap:8px;display:flex;flex:none}
.dsc-btn{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;background:0 0;border-radius:6px;align-items:center;gap:5px;padding:4px 10px;display:inline-flex}
.dsc-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsc-btn:disabled{opacity:.55;cursor:default}
.dsc-btn[data-danger=true]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)}
.dsc-btn[data-primary=true]{color:var(--dsw-alias-state-business-primary)}
.dsc-tabs{gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex}
.dsc-tab{border:0;border-bottom:2px solid transparent;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer;padding:6px 10px}
.dsc-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.dsc-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
@media (width<=680px){.dsc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.dsc-stat{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.dsc-stat b{font-size:17px;line-height:24px;font-variant-numeric:tabular-nums}
.dsc-stat span{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px}
.dsc-note{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px}
.dsc-note[data-kind=warn]{border-color:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b45309) 40%, transparent);color:var(--dsw-alias-state-warning-primary,#b45309)}
.dsc-note[data-kind=error]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);color:var(--dsw-alias-state-error-primary)}
.dsc-table{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dsc-row{display:grid;grid-template-columns:1fr 74px 64px 74px 150px;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2);font-size:12.5px}
.dsc-row:first-child{border-top:0}
.dsc-row[data-head=true]{color:var(--dsw-alias-label-tertiary);font-size:11px;background:var(--dsw-alias-bg-layer-1)}
.dsc-row[data-kind=archived]{grid-template-columns:1fr 90px 150px}
.dsc-name{font-family:var(--ds-font-family-code);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-desc{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-num{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);text-align:right}
.dsc-tag{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;padding:1px 6px;font-size:10.5px;line-height:18px;display:inline-flex}
.dsc-tag[data-kind=hot]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary);border-color:transparent}
.dsc-tag[data-kind=warn]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b45309) 12%, transparent);color:var(--dsw-alias-state-warning-primary,#b45309);border-color:transparent}
.dsc-tag[data-kind=pinned]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);color:var(--dsw-alias-brand-primary);border-color:transparent}
.dsc-cellActions{display:flex;gap:6px;justify-content:flex-end}
.dsc-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:14px;text-align:center}
.dsc-foot{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
`;

    function rpcId() {
      try {
        return crypto.randomUUID();
      } catch {
        return "rpc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      }
    }

    async function rpc(endpoint, args) {
      const response = await fetch(CHANNEL + "/" + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId: rpcId(), method: endpoint, payload: { args: args || {} } })
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const envelope = await response.json();
      const result = envelope && envelope.result;
      if (!result || result.ok !== true) {
        const error = result && result.error;
        throw new Error(error ? error.message : "请求失败");
      }
      return result.value;
    }

    function pct(n, d) {
      if (!d) return "0%";
      return ((n / d) * 100).toFixed(1) + "%";
    }

    function compact(n) {
      if (!Number.isFinite(n)) return "-";
      if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
      if (n >= 10000) return (n / 1000).toFixed(1) + "k";
      return String(n);
    }

    function fmtDate(ms) {
      if (!ms) return "从未";
      try {
        return new Date(ms).toISOString().slice(0, 10);
      } catch {
        return "-";
      }
    }

    const SOURCE_LABEL = {
      "user-dsh": "user",
      "user-agents": "agents",
      "project-dsh": "project",
      "project-agents": "project",
      "project-other": "其它项目",
      bundled: "内置",
      custom: "custom"
    };

    function Stat(props) {
      return h("div", { className: "dsc-stat" }, h("b", null, props.value), h("span", null, props.label));
    }

    function SkillRow(props) {
      const entry = props.entry;
      const [confirming, setConfirming] = useState(false);
      useEffect(() => {
        if (!confirming) return undefined;
        const timer = setTimeout(() => setConfirming(false), 4000);
        return () => clearTimeout(timer);
      }, [confirming]);

      const canArchive = entry.archivable && !entry.pinned && props.mode !== "archived";
      const loadTag = entry.loads === 0
        ? h("span", { className: "dsc-tag", "data-kind": "warn" }, "0 次")
        : h("span", { className: "dsc-tag", "data-kind": "hot" }, entry.loads + " 次");

      return h("div", { className: "dsc-row", "data-kind": props.mode === "archived" ? "archived" : undefined },
        h("div", null,
          h("div", { className: "dsc-name" }, entry.name, entry.pinned ? h("span", { className: "dsc-tag", "data-kind": "pinned", style: { marginLeft: 6 } }, "pinned") : null),
          h("div", { className: "dsc-desc" }, entry.description || "")
        ),
        props.mode === "archived"
          ? h("div", { className: "dsc-num" }, (entry.archivedAt || "").slice(0, 10))
          : h("div", { className: "dsc-num" }, compact(entry.catalogChars) + " 字符"),
        props.mode === "archived" ? null : h("div", { className: "dsc-num" }, h("span", { className: "dsc-tag" }, SOURCE_LABEL[entry.source] || entry.source)),
        props.mode === "archived" ? null : h("div", { className: "dsc-num" }, loadTag),
        h("div", { className: "dsc-cellActions" },
          props.mode === "archived"
            ? h("button", { className: "dsc-btn", "data-primary": "true", onClick: () => props.onRestore(entry.name) }, "恢复")
            : [
                h("button", {
                  key: "pin",
                  className: "dsc-btn",
                  title: entry.pinned ? "取消 pin" : "pin 保护，禁止归档",
                  onClick: () => props.onPin(entry.name, !entry.pinned)
                }, entry.pinned ? "unpin" : "pin"),
                h("button", {
                  key: "archive",
                  className: "dsc-btn",
                  "data-danger": "true",
                  disabled: !canArchive || props.busy,
                  title: canArchive ? "移入 .archive/，可随时恢复" : "内置/已 pin 的技能不能归档",
                  onClick: () => {
                    if (!confirming) { setConfirming(true); return; }
                    setConfirming(false);
                    props.onArchive(entry.name);
                  }
                }, confirming ? "确认归档？" : "归档")
              ]
        )
      );
    }

    function SkillCuratorSection() {
      const [tab, setTab] = useState("candidates");
      const [page, setPage] = useState(null);
      const [archived, setArchived] = useState([]);
      const [error, setError] = useState("");
      const [busy, setBusy] = useState(false);
      const [loading, setLoading] = useState(true);

      const load = useCallback(async (refresh) => {
        setLoading(true);
        setError("");
        try {
          const [nextPage, nextArchived] = await Promise.all([
            rpc("page", { refresh: refresh === true, limit: 400 }),
            rpc("archived")
          ]);
          setPage(nextPage);
          setArchived(nextArchived.entries || []);
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { load(false); }, [load]);

      const act = useCallback(async (fn, args) => {
        setBusy(true);
        setError("");
        try {
          await fn(args);
          await load(true);
        } catch (e) {
          setError(String(e && e.message ? e.message : e));
        } finally {
          setBusy(false);
        }
      }, [load]);

      const onArchive = useCallback((name) => act(rpc, ["archive", { name }]), [act]);
      const onRestore = useCallback((name) => act(rpc, ["restore", { name }]), [act]);
      const onPin = useCallback((name, pinned) => act(rpc, ["pin", { name, pinned }]), [act]);

      const summary = page && page.summary;
      const rows = useMemo(() => {
        if (!page) return [];
        if (tab === "all") return page.rows;
        if (tab === "candidates") {
          return page.rows.filter((row) => row.loads === 0 && row.archivable).slice(0, 40);
        }
        return page.rows.filter((row) => row.loads > 0 && row.loads <= 2).slice(0, 40);
      }, [page, tab]);

      if (loading && !page) {
        return h("div", { className: "dsc-section" }, h("div", { className: "dsc-note" }, "正在扫描技能目录与会话日志…"));
      }

      return h("div", { className: "dsc-section" },
        h("style", null, CSS),
        h("div", { className: "dsc-head" },
          h("div", null,
            h("h3", null, "技能治理"),
            h("p", { className: "dsc-sub" }, "看清开销 → 判断去留 → 确认后归档（可恢复）。默认只读。")
          ),
          h("div", { className: "dsc-actions" },
            summary ? h("span", { className: "dsc-tag" }, "扫描 " + summary.buildMs + "ms") : null,
            h("button", { className: "dsc-btn", onClick: () => load(true), disabled: loading }, loading ? "刷新中…" : "重新扫描")
          )
        ),
        error ? h("div", { className: "dsc-note", "data-kind": "error" }, error) : null,
        summary
          ? h("div", { className: "dsc-stats" },
              h(Stat, { value: summary.measuredEntries, label: "catalog 条目" }),
              h(Stat, { value: compact(summary.measuredChars), label: "catalog 字符/会话" }),
              h(Stat, { value: compact(summary.skillCalls), label: "真实加载次数" }),
              h(Stat, { value: pct(summary.unobservedChars, summary.localChars), label: "从未加载的字符占比" })
            )
          : null,
        summary && summary.observed && summary.observed.sessions
          ? h("div", { className: "dsc-note" },
              "真实会话 " + summary.observed.sessions + " 份快照 · 每份中位 " + summary.observed.medianChars +
              " 字符 / 最大 " + summary.observed.maxChars + " 字符；已扫描 " + summary.sessions + " 个会话，" +
              summary.distinctSkillsLoaded + " 个技能被加载过。" +
              (summary.hostCatalog ? " 当前进程 catalog " + summary.hostCatalog.entries + " 条。" : ""))
          : null,
        summary && summary.warnings && summary.warnings.length
          ? h("div", { className: "dsc-note", "data-kind": "warn" }, summary.warnings.map((w, i) => h("div", { key: i }, "· " + w)))
          : null,
        h("div", { className: "dsc-tabs" },
          h("button", { className: "dsc-tab", "data-active": tab === "candidates", onClick: () => setTab("candidates") }, "0 次使用（候选归档）"),
          h("button", { className: "dsc-tab", "data-active": tab === "low", onClick: () => setTab("low") }, "1–2 次但很贵"),
          h("button", { className: "dsc-tab", "data-active": tab === "all", onClick: () => setTab("all") }, "全部 catalog"),
          h("button", { className: "dsc-tab", "data-active": tab === "archived", onClick: () => setTab("archived") }, "已归档 " + archived.length)
        ),
        tab === "archived"
          ? h("div", { className: "dsc-table" },
              h("div", { className: "dsc-row", "data-head": "true", "data-kind": "archived" },
                h("div", null, "技能"), h("div", { className: "dsc-num" }, "归档时间"), h("div", { className: "dsc-cellActions" }, "操作")),
              archived.length === 0
                ? h("div", { className: "dsc-empty" }, "还没有归档任何技能。")
                : archived.map((entry) => h(SkillRow, {
                    key: entry.name,
                    entry,
                    mode: "archived",
                    busy,
                    onRestore,
                    onPin
                  }))
            )
          : h("div", { className: "dsc-table" },
              h("div", { className: "dsc-row", "data-head": "true" },
                h("div", null, "技能 / 描述"), h("div", { className: "dsc-num" }, "catalog 成本"),
                h("div", { className: "dsc-num" }, "来源"), h("div", { className: "dsc-num" }, "加载"), h("div", { className: "dsc-cellActions" }, "操作")),
              rows.length === 0
                ? h("div", { className: "dsc-empty" }, tab === "candidates" ? "没有 0 次使用的可归档技能。" : "没有数据。")
                : rows.map((entry) => h(SkillRow, {
                    key: entry.name,
                    entry,
                    mode: tab === "archived" ? "archived" : "list",
                    busy,
                    onArchive,
                    onRestore,
                    onPin
                  }))
            ),
        h("div", { className: "dsc-foot" },
          "归档 = 移入 <root>/.archive/ 并写 manifest；DSH 只扫一层，因此归档后立刻退出 catalog，restore 一条命令恢复。" +
          " 0 次使用只代表在已扫描的会话里没被观测到，不等于无用 — 归档前请自行确认。"
        )
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "skill-curator",
        order: 320,
        label: () => "技能治理"
      }, SkillCuratorSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
