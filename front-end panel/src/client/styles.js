export const styles = `
.evo-app {
  color-scheme: inherit;
  --paper: light-dark(#fff,#101c2e);
  --canvas: light-dark(#f2f6fc,#0b1422);
  --ink: light-dark(#152a46,#edf4ff);
  --muted: light-dark(#536983,#a7bbd7);
  --line: light-dark(#dce6f2,#293c56);
  --accent: light-dark(#1858ac,#a3caff);
  --soft: light-dark(#eaf3ff,#1a3151);
  --field: light-dark(#f8fbff,#132137);
  --danger: light-dark(#aa352d,#ffb6aa);
  --warning: light-dark(#725109,#ffe0a1);
  --warning-bg: light-dark(#fffae9,#332713);
  --hero: linear-gradient(118deg,light-dark(#fff,#14243c) 26%,light-dark(#e8f4ff,#19365d) 100%);
  --shadow: 0 5px 22px light-dark(#15365f0a,#0003);
  min-inline-size: 0;
  min-block-size: 100%;
  background: linear-gradient(180deg,var(--paper) 0,var(--canvas) 25rem);
  color: var(--ink);
  font: 14px/1.6 system-ui,sans-serif;
}
.evo-app[data-theme=light] { color-scheme: light; }
.evo-app[data-theme=dark] { color-scheme: dark; }
.evo-app * { box-sizing: border-box; }
.evo-app .app-inner { max-width: 1400px; margin: auto; padding: calc(18px + var(--dsh-frame-top-clearance,0px)) clamp(12px,3vw,44px) 32px; container-type: inline-size; }
html[data-windows-titlebar] .evo-app .app-inner { padding-top: 18px; }
.evo-app h1,.evo-app h2,.evo-app p { margin-top: 0; }
.evo-app h1 { font-size: clamp(25px,3vw,38px); letter-spacing: -.025em; line-height: 1.2; margin-bottom: 7px; }
.evo-app h2 { font-size: 18px; line-height: 1.45; margin-bottom: 14px; }
.evo-app .app-header { padding: 20px clamp(16px,3vw,32px); border: 1px solid var(--line); border-radius: 18px; background: var(--hero); }
.evo-app .product { display: flex; align-items: center; gap: 9px; margin-bottom: 13px; color: var(--accent); font-weight: 700; }
.evo-app .brand-icon { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg,#448bdf,#2157a7); color: #fff; }
.evo-app .brand-caption { color: var(--muted); font-size: 12px; font-weight: 500; }
.evo-app .panel-description { margin-bottom: 0; color: var(--muted); }
.evo-app .section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.evo-app .section-head h2 { margin-bottom: 0; }
.evo-app .card { border: 1px solid var(--line); background: var(--paper); box-shadow: var(--shadow); padding: 20px; border-radius: 15px; min-width: 0; margin: 0 0 14px; }
.evo-app .two-columns { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,3fr); gap: 14px; align-items: start; }
.evo-app button,.evo-app input,.evo-app select,.evo-app textarea { font: inherit; color: inherit; border: 1px solid var(--line); border-radius: 9px; padding: 7px 11px; background: var(--paper); max-width: 100%; }
.evo-app input:not([type=checkbox]),.evo-app select,.evo-app textarea { min-width: 0; background: var(--field); }
.evo-app input::placeholder,.evo-app textarea::placeholder { color: var(--muted); }
.evo-app select option { background: var(--paper); color: var(--ink); }
.evo-app input[type=checkbox] { flex: 0 0 auto; width: 16px; height: 16px; accent-color: #286ac0; }
.evo-app textarea { min-height: 90px; width: 100%; resize: vertical; }
.evo-app button:not(:disabled) { cursor: pointer; }
.evo-app button:disabled { opacity: .52; }
.evo-app button:hover:not(:disabled) { background: var(--soft); border-color: var(--accent); }
.evo-app button.primary,.evo-app button.primary:hover:not(:disabled) { background: #215eb1; color: #fff; border-color: transparent; }
.evo-app button.primary:hover:not(:disabled) { background: #164b92; }
.evo-app :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.evo-app .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.evo-app .main-tabs { gap: 7px; margin-top: 13px; background: var(--paper); padding: 7px; border: 1px solid var(--line); border-radius: 13px; }
.evo-app .main-tabs button { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 12px; border-color: transparent; font-weight: 600; color: var(--muted); }
.evo-app .main-tabs svg,.evo-app .settings-toggle svg { flex: none; }
.evo-app .tabs button[aria-current=page],.evo-app .tabs button[aria-pressed=true],.evo-app .entry[aria-pressed=true] { color: var(--accent); border-color: light-dark(#bfd8f8,#456a98); background: var(--soft); }
.evo-app .workspace-tools { margin: 12px 0 15px; -webkit-app-region: no-drag; }
.evo-app .settings-row,.evo-app .settings-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
.evo-app .settings-row { justify-content: space-between; }
.evo-app .settings-actions { margin-inline-start: auto; }
.evo-app .theme-control,.evo-app .settings-toggle,.evo-app .source-pill { display: inline-flex; align-items: center; gap: 7px; }
.evo-app .source-pill { color: var(--muted); font-size: 12px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 99px; background: var(--paper); }
.evo-app .source-pill i { display: block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.evo-app .settings-card { margin: 10px 0 0; }
.evo-app .settings-card .toolbar { align-items: end; }
.evo-app .settings-card label:not(.inline) { flex: 1 1 180px; }
.evo-app .debug-control { width: fit-content; margin-top: 12px; }
.evo-app .debug-banner { margin: 10px 0 0; padding: 9px 13px; border-radius: 9px; color: var(--warning); background: var(--warning-bg); }
.evo-app .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.evo-app .toolbar input { flex: 1 1 130px; }
.evo-app .entry-list { list-style: none; margin: 15px 0 0; padding: 0; display: grid; gap: 8px; }
.evo-app .entry-row { display: flex; align-items: center; gap: 7px; }
.evo-app .entry { min-width: 0; display: grid; gap: 3px; width: 100%; text-align: left; padding: 10px 13px; overflow-wrap: anywhere; }
.evo-app .entry small,.evo-app .muted { color: var(--muted); font-size: 12px; }
.evo-app .empty,.evo-app .module-placeholder { color: var(--muted); }
.evo-app .module-placeholder { min-height: 165px; }
.evo-app .module-placeholder h2 { color: var(--ink); margin: 10px 0 4px; }
.evo-app .module-placeholder p { margin-bottom: 0; }
.evo-app .message { margin: 12px 0; overflow-wrap: anywhere; }
.evo-app .error,.evo-app .danger { color: var(--danger); }
.evo-app .form { display: grid; gap: 13px; margin-top: 16px; }
.evo-app label { display: grid; gap: 5px; font-size: 13px; }
.evo-app .theme-control,.evo-app .inline { display: flex; align-items: center; gap: 6px; }
.evo-app .form-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(150px,100%),1fr)); gap: 12px; }
.evo-app .rule { border: 1px solid var(--line); border-radius: 10px; padding: 14px; min-width: 0; }
.evo-app .rule .toolbar { margin-top: 12px; }
.evo-app .pager { display: flex; justify-content: space-between; gap: 7px; align-items: center; margin-top: 14px; font-size: 12px; }
.evo-app pre { padding: 13px; background: var(--field); border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; max-height: 420px; overflow: auto; }
.evo-app .prewrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.evo-app .table-scroll { width: 100%; overflow: auto; }
.evo-app table { border-collapse: collapse; width: 100%; font-size: 13px; text-align: left; }
.evo-app th,.evo-app td { padding: 9px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.evo-app th { font-weight: 600; color: var(--muted); background: var(--field); }
.evo-app details { padding: 8px 0; }
.evo-app summary { cursor: pointer; overflow-wrap: anywhere; }
.evo-app .timeline { list-style: none; padding-left: 12px; border-left: 2px solid var(--line); margin: 14px 0; }
.evo-app .timeline small { color: var(--muted); margin-left: 7px; }
.evo-app .tag { display: inline-block; padding: 2px 8px; border-radius: 6px; background: var(--soft); color: var(--accent); font-size: 12px; }
.evo-app .stream-status { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 13px; color: var(--muted); font-size: 12px; }
.evo-app .stats { display: flex; flex-wrap: wrap; gap: 9px; }
.evo-app .stats > div { min-width: 75px; padding: 8px 12px; background: var(--soft); border-radius: 9px; }
.evo-app .stats dt { font-size: 12px; color: var(--muted); }
.evo-app .stats dd { margin: 0; font-size: 23px; font-weight: 600; }
.evo-app .chart { margin: 18px 0; padding: 13px; border-radius: 11px; background: var(--field); }
.evo-app .chart figcaption { margin-bottom: 10px; font-weight: 600; }
.evo-app .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; }
@container (max-width: 720px) { .evo-app .two-columns { grid-template-columns: minmax(0,1fr); } }
@container (max-width: 480px) {
  .evo-app .main-tabs { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
  .evo-app .main-tabs button { padding-inline: 4px; }
  .evo-app .settings-actions { margin-inline-start: 0; }
  .evo-app .card { padding: 13px; }
  .evo-app .task-selector label,.evo-app .task-selector select { width: 100%; }
}
`
