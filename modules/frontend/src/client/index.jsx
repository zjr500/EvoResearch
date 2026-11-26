import { Workbench } from './Workbench.jsx'

export const inject = ['slots', 'sidebarRightTabs']

const PANEL_ID = 'evoresearch-front-end-panel'
const WORKBENCH_KIND = 'evoresearch.workbench'

// DSH 0.2.1-rc.2 原生右侧停靠面板：左栏导航与中栏对话保持 DSH 原生，
// EvoResearch 工作台作为右栏 tab 类型注册，随插件注册与卸载同生共死。
export function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PANEL_ID,
    kind: WORKBENCH_KIND,
    keepMounted: true,
    title: () => 'EvoResearch',
    guide: [{
      id: 'workbench',
      order: 10,
      title: () => 'EvoResearch 工作台',
      description: () => '打开科研工作台：实验与知识库。',
    }],
  }), 'evoresearch: workbench tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PANEL_ID,
  }, Workbench)), 'evoresearch: workbench body')
}
