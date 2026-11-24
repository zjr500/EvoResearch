import { App } from './App.jsx'
import { styles } from './styles.js'

export const inject = ['slots']
const panelId = 'evoresearch-front-end-panel'

export function apply(ctx) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, Panel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, label: 'EvoResearch', order: 20,
  }, Icon))
}

function Panel() { return <><style>{styles}</style><App /></> }
function Icon({ size = 18 }) { return <span aria-hidden="true" style={{ fontSize: size }}>▤</span> }
