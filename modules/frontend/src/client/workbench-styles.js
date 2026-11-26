// 工作台骨架样式：尽量沿用 DSH 宿主字体与配色，只提供紧凑布局与中性分隔。
// 亮/暗由 data-theme 与宿主变量决定；不引入渐变、阴影堆砌或装饰性卡片。
export const workbenchStyles = `
.evo-wb {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  color: inherit; font: inherit; font-size: 13px; line-height: 1.55;
  --wb-line: color-mix(in srgb, currentColor 14%, transparent);
  --wb-soft: color-mix(in srgb, currentColor 6%, transparent);
  --wb-accent: #4d6bfe;
}
.evo-wb[data-theme="light"] { color-scheme: light; background: #ffffff; color: #1f2329; }
.evo-wb[data-theme="dark"] { color-scheme: dark; background: #17181c; color: #e6e6e6; }
.evo-wb button { font: inherit; color: inherit; background: none; border: 1px solid transparent; border-radius: 6px; cursor: pointer; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px; }
.evo-wb button:hover { background: var(--wb-soft); }
.evo-wb button:disabled { opacity: .45; cursor: default; }
.evo-wb button.primary { background: var(--wb-accent); border-color: var(--wb-accent); color: #fff; }
.evo-wb button.quiet { border-color: var(--wb-line); }
.evo-wb input, .evo-wb select { font: inherit; color: inherit; background: transparent; border: 1px solid var(--wb-line); border-radius: 6px; padding: 4px 8px; }
.evo-wb input:focus-visible, .evo-wb button:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: 1px; }

.wb-header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--wb-line); flex-wrap: wrap; }
.wb-brand { display: inline-flex; align-items: center; gap: 6px; margin-right: 4px; }
.wb-entries { display: inline-flex; gap: 2px; background: var(--wb-soft); border-radius: 8px; padding: 2px; }
.wb-entries button[aria-current="page"] { background: var(--wb-accent); color: #fff; }
.wb-header .workspace-tools { margin-left: auto; }
.wb-body { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px; }

.debug-banner { display: flex; gap: 6px; align-items: center; margin: 6px 12px 0; padding: 6px 10px; border: 1px solid #b8860b; border-radius: 6px; color: #b8860b; }
.muted { color: color-mix(in srgb, currentColor 55%, transparent); }
.tag { font-size: 11px; padding: 1px 6px; border: 1px solid var(--wb-line); border-radius: 999px; color: color-mix(in srgb, currentColor 60%, transparent); }

.card { border: 1px solid var(--wb-line); border-radius: 8px; padding: 10px 12px; background: transparent; }
.card > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.card > header strong { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }

.kb { display: flex; flex-direction: column; gap: 10px; }
.kb-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kb-search { display: flex; gap: 4px; margin-left: auto; }
.kb-search input { min-width: 180px; }
.reflow-badge { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--wb-line); border-radius: 999px; padding: 2px 8px; }
.kb-columns { display: grid; grid-template-columns: minmax(200px, 5fr) minmax(240px, 7fr); gap: 10px; align-items: start; }
@media (max-width: 640px) { .kb-columns { grid-template-columns: 1fr; } }
.kb-list ul, .imports ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.kb-entry { width: 100%; text-align: left; display: flex; align-items: center; gap: 8px; border-radius: 6px; }
.kb-entry[aria-current="true"] { background: var(--wb-soft); }
.kb-entry .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-detail .meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0 0 8px; }
.kb-detail .meta div { display: contents; }
.kb-detail dt { color: color-mix(in srgb, currentColor 55%, transparent); }
.kb-detail dd { margin: 0; }
.kb-detail .summary { white-space: pre-wrap; margin: 6px 0; }
.kb-actions { display: flex; gap: 8px; margin-top: 8px; }
.imports header { display: flex; justify-content: space-between; align-items: center; }
.imports li { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
.imports .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.exp { display: flex; flex-direction: column; gap: 10px; }
.exp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.exp-region p { margin: 4px 0; }

.empty-state { text-align: center; padding: 18px 8px; color: color-mix(in srgb, currentColor 60%, transparent); }
.empty-state p { margin: 4px 0; }
.empty-icon svg { width: 22px; height: 22px; }
.message { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.error { color: #c5392f; }
.status-badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--wb-line); }
.status-badge[data-tone="success"] { color: #1a7f37; border-color: #1a7f37; }
.status-badge[data-tone="info"] { color: var(--wb-accent); border-color: var(--wb-accent); }
.status-badge[data-tone="warning"] { color: #b8860b; border-color: #b8860b; }
.status-badge[data-tone="danger"] { color: #c5392f; border-color: #c5392f; }
.settings-row { display: flex; align-items: center; gap: 8px; }
.settings-actions { display: inline-flex; align-items: center; gap: 8px; }
.debug-control { display: inline-flex; align-items: center; gap: 4px; }
.settings-card { margin-top: 6px; }
.source-pill { font-size: 11px; color: color-mix(in srgb, currentColor 55%, transparent); }

/* UC01 workbench: pending papers, semantic hits, citation bar, PDF preview */
.kb-hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.pending-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pending-list > li { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; border: 1px solid var(--wb-line); border-radius: 8px; padding: 8px 10px; }
.pending-check { padding-top: 2px; }
.pending-main { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 2px; }
.pending-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.paper-editor { flex-basis: 100%; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--wb-line); padding-top: 8px; margin-top: 4px; }
.paper-editor label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: color-mix(in srgb, currentColor 65%, transparent); }
.paper-editor .settings-row label { flex: 1; }
.paper-editor textarea { font: inherit; color: inherit; background: transparent; border: 1px solid var(--wb-line); border-radius: 6px; padding: 6px 8px; resize: vertical; }
.pdf-block { display: flex; flex-direction: column; gap: 6px; }
.pdf-frame { width: 100%; height: 420px; border: 1px solid var(--wb-line); border-radius: 8px; background: #fff; }
.link-button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--wb-line); border-radius: 6px; padding: 4px 10px; color: inherit; text-decoration: none; }
.citation-bar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 1px solid var(--wb-line); border-radius: 8px; padding: 8px 12px; background: inherit; backdrop-filter: blur(6px); }
.citation-text { flex: 1; min-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`
