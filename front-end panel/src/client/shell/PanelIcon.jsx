const paths = {
  brand: 'M4 16v4h16v-4M7 14l4-4 3 2 5-7M15 5h4v4',
  knowledge: 'M12 6C9 4 6 4 3 5v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v13',
  setup: 'M7 3h7l4 4v14H6V3h1Zm7 0v5h4M9 12h6m-6 4h6',
  process: 'M4 5h6v4H4zM14 15h6v4h-6zM7 9v8h7',
  metrics: 'M4 4v16h16M7 15l4-5 4 2 4-6',
  alerts: 'M12 3 2.5 20h19L12 3Zm0 6v4m0 3h.01',
  graph: 'M10 11 7 8m7 3 3-3m-5 6v3M12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4ZM6 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4Zm12 0a2 2 0 1 0 0 4 2 2 0 1 0 0-4Zm-6 13a2 2 0 1 0 0 4 2 2 0 1 0 0-4Z',
  settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
  activity: 'M3 12h4l3-6 4 12 3-6h4',
  search: 'M15.5 15.5 21 21M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  info: 'M12 11v5m0-8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  chevron: 'm9 5 7 7-7 7',
}

export function PanelIcon({ name }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
