export const styles = `
.evo-app {
  color-scheme: inherit;
  --paper: light-dark(#fff,#1d1f24);
  --canvas: light-dark(#f6f7f9,#15161a);
  --field: light-dark(#f7f8fa,#25272e);
  --ink: light-dark(#20242e,#f0f1f5);
  --muted: light-dark(#555f71,#aeb7c9);
  --line: light-dark(#dfe3eb,#383c47);
  --control-line: light-dark(#bcc5d3,#666e7e);
  --accent: light-dark(#2556b8,#a4bfff);
  --soft: light-dark(#ebf2ff,#273652);
  --primary: light-dark(#2c58b7,#a5c0ff);
  --on-primary: light-dark(#fff,#142745);
  --success: light-dark(#22614a,#9bddbf);
  --success-bg: light-dark(#ebf7f1,#223830);
  --danger: light-dark(#9c2d34,#ffb9b8);
  --danger-bg: light-dark(#fff1f1,#3b282c);
  --warning: light-dark(#724b0f,#f5d08e);
  --warning-bg: light-dark(#fff7e8,#342d23);
  --radius-card: 16px;
  --radius-control: 10px;
  --body-size: var(--dsh-content-font-size, 14px);
  --gutter: clamp(12px, 2.8vw, 38px);
  --transition: 150ms ease-out;
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 0;
  block-size: 100%;
  overflow: auto;
  overscroll-behavior-block: contain;
  background: var(--canvas);
  color: var(--ink);
  font: var(--body-size)/1.55 var(--dsw-font-family, system-ui, sans-serif);
}
.evo-app[data-theme=light] { color-scheme: light; }
.evo-app[data-theme=dark] { color-scheme: dark; }
.evo-app[data-theme=dsh] {
  --paper: var(--dsw-alias-bg-layer-1, light-dark(#fff,#1d1f24));
  --ink: var(--dsw-alias-label-primary, light-dark(#20242e,#f0f1f5));
  --canvas: color-mix(in srgb, var(--dsw-alias-bg-base, var(--paper)) 96%, var(--ink));
  --field: color-mix(in srgb, var(--paper) 95%, var(--ink));
  --line: var(--dsw-alias-border-l2, light-dark(#dfe3eb,#383c47));
}
.evo-app * { box-sizing: border-box; }
.evo-app [hidden] { display: none !important; }
.evo-app .app-inner {
  max-width: 1376px;
  margin-inline: auto;
  padding: calc(16px + var(--dsh-frame-top-clearance,0px)) var(--gutter) 32px;
  container-type: inline-size;
}
html[data-windows-titlebar] .evo-app .app-inner { padding-top: 16px; }
.evo-app :is(h1,h2,h3,p) { margin-top: 0; }
.evo-app h1 { font-size: clamp(25px, 1.6rem + .4vw, 34px); letter-spacing: -.025em; line-height: 1.2; margin-bottom: 6px; }
.evo-app h2 { font-size: max(17px,1.13em); line-height: 1.4; margin-bottom: 12px; overflow-wrap: anywhere; }
.evo-app h3 { font-size: max(13px,.92em); margin-bottom: 8px; }
.evo-app .app-header {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 16px clamp(16px,2.2vw,28px) 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: linear-gradient(107deg,var(--paper) 40%,color-mix(in srgb,var(--soft) 68%,var(--paper)));
}
.evo-app .app-header::after {
  content: "";
  pointer-events: none;
  position: absolute;
  z-index: -1;
  inset: 0 0 0 56%;
  background-image: radial-gradient(color-mix(in srgb,var(--accent) 35%,transparent) 1px,transparent 1px);
  background-size: 14px 14px;
  mask-image: linear-gradient(90deg,transparent,black);
}
.evo-app .product { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; color: var(--ink); font-weight: 650; }
.evo-app .brand-icon { display: inline-grid; place-items: center; width: 27px; height: 27px; border-radius: 8px; background: var(--soft); color: var(--accent); }
.evo-app .brand-icon svg { width: 16px; height: 16px; }
.evo-app .brand-caption { border-inline-start: 1px solid var(--line); padding-inline-start: 8px; color: var(--muted); font-size: max(12px,.86em); font-weight: 500; }
.evo-app .panel-description { max-inline-size: 60ch; margin-bottom: 0; color: var(--muted); text-wrap: pretty; }
.evo-app .section-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.evo-app .section-head h2 { margin-bottom: 0; }
.evo-app .card { min-width: 0; margin: 0 0 14px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--paper); padding: 18px; }
.evo-app .two-columns { display: grid; grid-template-columns: minmax(0,5fr) minmax(0,7fr); gap: 14px; align-items: start; }
.evo-app :is(button,input,select,textarea) { font: inherit; color: inherit; border: 1px solid var(--control-line); border-radius: var(--radius-control); padding: 7px 11px; background: var(--paper); max-width: 100%; min-width: 0; }
.evo-app :is(button,select,input:not([type=checkbox])) { min-block-size: 36px; }
.evo-app :is(input:not([type=checkbox]),select,textarea) { background: var(--field); }
.evo-app :is(input,textarea)::placeholder { color: var(--muted); }
.evo-app select option { background: var(--paper); color: var(--ink); }
.evo-app input[type=checkbox] { flex: 0 0 auto; width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; margin: 0; }
.evo-app textarea { min-height: 90px; width: 100%; resize: vertical; }
.evo-app button { transition: background-color var(--transition), border-color var(--transition), color var(--transition); }
.evo-app button:not(:disabled) { cursor: pointer; }
.evo-app button:disabled { opacity: .5; }
.evo-app button:hover:not(:disabled) { background: var(--field); border-color: var(--accent); }
.evo-app button:active:not(:disabled) { background: var(--soft); }
.evo-app button.quiet { min-block-size: 34px; padding: 4px 9px; border-color: transparent; color: var(--muted); }
.evo-app button.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; font-weight: 600; }
.evo-app button.primary:hover:not(:disabled) { background: color-mix(in srgb,var(--primary) 87%,var(--ink)); border-color: transparent; }
.evo-app button.primary:active:not(:disabled) { background: color-mix(in srgb,var(--primary) 78%,var(--ink)); }
.evo-app button.danger:hover:not(:disabled) { background: var(--danger-bg); border-color: currentColor; }
.evo-app :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.evo-app:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.evo-app .tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.evo-app .main-tabs { display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); gap: 6px; margin-top: 12px; background: var(--paper); padding: 6px; border: 1px solid var(--line); border-radius: 14px; }
.evo-app .main-tabs button { display: flex; align-items: center; justify-content: center; gap: 7px; min-block-size: 40px; padding: 6px; border-color: transparent; font-weight: 600; color: var(--muted); text-wrap: balance; }
.evo-app :is(.main-tabs,.settings-toggle,.stream-status,.message,.debug-banner) svg { flex: none; width: 16px; height: 16px; }
.evo-app .tabs button[aria-current=page],.evo-app .tabs button[aria-pressed=true],.evo-app .entry[aria-pressed=true] {
  color: var(--accent);
  border-color: color-mix(in srgb,var(--accent) 30%,transparent);
  background: var(--soft);
}
.evo-app .workspace-tools { margin: 10px 0 16px; -webkit-app-region: no-drag; }
.evo-app :is(.settings-row,.settings-actions) { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.evo-app .settings-row { justify-content: space-between; }
.evo-app .settings-actions { margin-inline-start: auto; }
.evo-app :is(.theme-control,.settings-toggle,.source-pill) { display: inline-flex; align-items: center; gap: 8px; }
.evo-app .theme-control { color: var(--muted); }
.evo-app .theme-control select { color: var(--ink); }
.evo-app .source-pill { color: var(--muted); font-size: max(12px,.85em); padding: 4px 9px; border: 1px solid var(--line); border-radius: 99px; background: var(--paper); }
.evo-app .source-pill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.evo-app .settings-card { margin: 8px 0 0; }
.evo-app :is(.settings-card,.task-controls) .toolbar,.evo-app .toolbar:is(.task-controls,.metric-filters,.event-filters) { align-items: end; }
.evo-app .settings-card label:not(.inline) { flex: 1 1 180px; }
.evo-app .debug-control { min-block-size: 36px; padding: 6px 10px; border: 1px solid var(--control-line); border-radius: var(--radius-control); background: var(--paper); cursor: pointer; }
.evo-app .debug-control[data-tone=warning] { background: var(--warning-bg); color: var(--warning); }
.evo-app .debug-banner { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0 0; padding: 8px 12px; border-radius: var(--radius-control); color: var(--warning); background: var(--warning-bg); }
.evo-app .debug-banner svg { margin-top: 3px; }
.evo-app .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; min-width: 0; }
.evo-app .toolbar > label { min-width: 0; }
.evo-app .task-controls > label { flex: 1 1 220px; }
.evo-app .task-controls > form { flex: 1 1 225px; }
.evo-app .task-controls form label,.evo-app :is(.metric-filters,.event-filters) label { flex: 1 1 125px; }
.evo-app .event-filters .tabs { flex-basis: 100%; }
.evo-app .library-filters .search-field { flex: 2 1 136px; position: relative; }
.evo-app .search-field svg { position: absolute; top: 50%; left: 10px; transform: translateY(-50%); width: 15px; height: 15px; color: var(--muted); pointer-events: none; }
.evo-app .search-field input { padding-inline-start: 32px; }
.evo-app .selection-note { margin: 12px 0 0; overflow-wrap: anywhere; }
.evo-app .entry-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
.evo-app .entry-list:empty { display: none; }
.evo-app .entry-row { display: flex; align-items: center; gap: 4px; }
.evo-app .entry-row .entry-check { display: grid; place-items: center; width: 28px; min-height: 28px; flex: none; border-radius: 8px; cursor: pointer; }
.evo-app .entry-check:hover { background: var(--field); }
.evo-app .entry { display: flex; align-items: center; justify-content: space-between; flex: 1; gap: 8px; text-align: left; padding: 9px 11px; border-color: var(--line); overflow-wrap: anywhere; }
.evo-app .entry svg { flex: none; width: 14px; height: 14px; }
.evo-app .entry-copy { display: grid; gap: 3px; min-width: 0; }
.evo-app :is(.entry small,.muted,.empty) { color: var(--muted); }
.evo-app :is(.entry small,.muted) { font-size: max(12px,.85em); }
.evo-app .detail-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.evo-app .entry-title { margin-bottom: 6px; font-size: max(19px,1.3em); }
.evo-app .detail-source { overflow-wrap: anywhere; margin-bottom: 14px; }
.evo-app .detail-editor { padding-top: 14px; border-top: 1px solid var(--line); }
.evo-app :is(.empty-state,.module-placeholder) { display: grid; justify-items: center; place-content: center; gap: 8px; padding: 28px 14px; text-align: center; color: var(--muted); }
.evo-app .empty-state { min-height: 170px; }
.evo-app .module-placeholder { min-height: 240px; }
.evo-app :is(.empty-state,.module-placeholder) p,.evo-app .module-placeholder h2 { margin: 0; }
.evo-app :is(.empty-state strong,.module-placeholder h2) { color: var(--ink); }
.evo-app .empty-icon { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--line); border-radius: 12px; color: var(--accent); background: var(--soft); }
.evo-app .message { margin: 12px 0; padding: 8px 12px; border-radius: var(--radius-control); background: var(--field); overflow-wrap: anywhere; }
.evo-app .message:where(.loading,.error) { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.evo-app .message.error { justify-content: space-between; background: var(--danger-bg); }
.evo-app .message.error span { display: flex; flex: 1 1 130px; align-items: baseline; gap: 8px; min-width: 0; }
.evo-app .message.error svg { align-self: center; }
.evo-app :is(.error,.danger) { color: var(--danger); }
.evo-app .form { display: grid; gap: 12px; margin-top: 16px; }
.evo-app label { display: grid; gap: 6px; font-size: max(13px,.92em); }
.evo-app :is(.theme-control,.inline) { display: flex; align-items: center; gap: 8px; }
.evo-app .form-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(150px,100%),1fr)); gap: 12px; }
.evo-app .rule { border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 0; min-width: 0; }
.evo-app .rule legend { padding-inline: 5px; color: var(--muted); font-weight: 600; }
.evo-app .rule .toolbar { margin-top: 12px; }
.evo-app .pager { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-top: 14px; font-size: max(12px,.85em); }
.evo-app pre { padding: 12px; margin: 0; background: var(--field); border: 1px solid var(--line); border-radius: var(--radius-control); white-space: pre-wrap; overflow-wrap: anywhere; font: max(12px,var(--dsh-code-font-size,12px))/1.6 var(--ds-font-family-code,monospace); max-height: 420px; overflow: auto; }
.evo-app .prewrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.evo-app .table-scroll { width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-control); }
.evo-app table { border-collapse: collapse; width: 100%; font-size: max(13px,.93em); text-align: left; font-variant-numeric: tabular-nums; }
.evo-app :is(th,td) { padding: 9px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.evo-app tr:last-child td { border-bottom: 0; }
.evo-app th { font-weight: 600; color: var(--muted); background: var(--field); }
.evo-app tbody tr:hover { background: var(--field); }
.evo-app .table-scroll .empty { padding: 8px 12px; margin: 0; }
.evo-app details { padding-block: 2px; }
.evo-app summary { cursor: pointer; overflow-wrap: anywhere; padding: 7px 4px; }
.evo-app details[open] > summary { margin-bottom: 6px; }
.evo-app .timeline { list-style: none; padding: 0 0 0 12px; border-inline-start: 1px solid var(--line); margin: 14px 0 0 4px; }
.evo-app .timeline:empty { display: none; }
.evo-app .timeline li { position: relative; }
.evo-app .timeline li::before { content: ""; position: absolute; inset-inline-start: -16px; top: 16px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.evo-app .timeline small { color: var(--muted); margin-inline-start: 8px; font-size: max(12px,.85em); }
.evo-app :is(.tag,.status-badge) { display: inline-block; padding: 2px 8px; border-radius: 6px; background: var(--soft); color: var(--accent); font-size: max(12px,.85em); font-weight: 500; }
.evo-app [data-tone=neutral]:is(.tag,.status-badge) { background: var(--field); color: var(--muted); }
.evo-app [data-tone=success] { background: var(--success-bg); color: var(--success); }
.evo-app [data-tone=warning] { background: var(--warning-bg); color: var(--warning); }
.evo-app [data-tone=danger] { background: var(--danger-bg); color: var(--danger); }
.evo-app .stream-status { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 12px; padding: 1px 7px 1px 11px; color: var(--muted); font-size: max(12px,.9em); border-radius: var(--radius-control); }
.evo-app .stream-status > span { display: flex; align-items: center; gap: 8px; }
.evo-app .stream-status[data-tone=info] { background: var(--field); }
.evo-app .stream-status[data-tone=warning] { color: var(--warning); }
.evo-app .stream-status button { color: inherit; background: transparent; }
.evo-app .task-status { display: flex; align-items: center; gap: 8px; }
.evo-app .stats { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(104px,100%),1fr)); gap: 8px; margin: 0 0 12px; }
.evo-app .stats > div { padding: 9px 12px; background: var(--field); border: 1px solid var(--line); border-radius: var(--radius-control); }
.evo-app .stats dt { font-size: max(12px,.85em); color: var(--muted); }
.evo-app .stats dd { margin: 0; font-size: max(22px,1.5em); font-weight: 650; font-variant-numeric: tabular-nums; }
.evo-app .chart { margin: 14px 0 8px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--field); }
.evo-app .chart figcaption { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; font-weight: 650; overflow-wrap: anywhere; }
.evo-app .chart canvas { display: block; width: 100%; height: clamp(190px,24vh,270px); color: var(--muted); }
.evo-app .legend { display: flex; gap: 8px 14px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--line); font-size: max(12px,.85em); color: var(--muted); }
.evo-app .legend span { display: inline-flex; align-items: center; gap: 6px; }
@container (max-width: 760px) {
  .evo-app .main-tabs { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .evo-app .two-columns { grid-template-columns: minmax(0,1fr); }
}
@container (max-width: 410px) {
  .evo-app .main-tabs { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .evo-app .settings-actions { margin-inline-start: 0; }
  .evo-app .card { padding: 12px; }
  .evo-app .task-controls form { flex-basis: 100%; }
  .evo-app .timeline small { display: block; margin-inline-start: 0; }
}
@media (pointer: coarse) {
  .evo-app :is(button,select,input:not([type=checkbox]),summary,.entry-row .entry-check,.inline) { min-block-size: 44px; }
  .evo-app .entry-row .entry-check { width: 44px; }
}
@media (prefers-reduced-motion: reduce) { .evo-app button { transition: none; } }
`
