import { PanelIcon } from './shell/PanelIcon.jsx'

// 最小挂载骨架：仅证明 DSH 右侧工作台已挂载，不含任何业务界面。
// 业务页面由界面负责人依据 docs/设计示意图/ 三张示意图重新实现，
// 样式优先沿用 DSH 原生 UI。
export function Workbench() {
  return (
    <div style={{ padding: '16px', display: 'grid', gap: '8px' }}>
      <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <PanelIcon name="brand" />EvoResearch 工作台
      </strong>
      <p style={{ margin: 0, opacity: 0.7 }}>业务界面待按设计示意图重建。</p>
    </div>
  )
}
