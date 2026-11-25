import { EmptyState } from '../../shared/ui.jsx'
import { PanelIcon } from '../../shell/PanelIcon.jsx'

// 实验工作台骨架：区域与接入位置已定型。
// 实验业务后端（任务、执行、事件、候选、认证）由马雨瑶在 UC04—UC11 中实现，
// 界面业务由胡语晨接入；骨架只提供结构，不展示任何虚构实验数据。

function Region({ icon, title, children, todo }) {
  return <section className="card exp-region" aria-label={title}>
    <header><strong><PanelIcon name={icon} />{title}</strong>{todo && <span className="tag" data-tone="neutral">待业务接入</span>}</header>
    {children}
  </section>
}

export function ExperimentWorkbench() {
  return <div className="exp">
    <Region icon="process" title="研究任务" todo>
      <EmptyState icon="process" title="还没有实验任务"
        description="任务列表与创建入口在此区域；任务表单（UC04）接入后可用。" />
    </Region>
    <div className="exp-grid">
      <Region icon="setup" title="任务配置" todo>
        <p className="muted">研究目标、数据集划分、模型与轮数上限（UC04）。</p>
      </Region>
      <Region icon="activity" title="实验进展" todo>
        <p className="muted">当前轮次、进度、暂停与终止入口（UC05/UC11）。</p>
      </Region>
      <Region icon="process" title="日志" todo>
        <p className="muted">实时日志与断线重放（UC06）。</p>
      </Region>
      <Region icon="metrics" title="指标" todo>
        <p className="muted">训练指标曲线与原始数据（UC06/UC08）。</p>
      </Region>
      <Region icon="alerts" title="异常" todo>
        <p className="muted">异常提示、用户响应与恢复状态（UC07）。</p>
      </Region>
      <Region icon="graph" title="候选与认证" todo>
        <p className="muted">候选方案比较、选择与测试集认证结果（UC09/UC10）。</p>
      </Region>
    </div>
    <Region icon="knowledge" title="实验报告" todo>
      <p className="muted">报告生成与回流知识库入口（UC12，邓玲）。</p>
    </Region>
  </div>
}
