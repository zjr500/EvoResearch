import { useState } from 'react'
import { EmptyState } from '../../shared/ui.jsx'
import { PanelIcon } from '../../shell/PanelIcon.jsx'

// 实验工作台：区域布局与真实数据接入位置已定型。
// 实验业务后端尚未通过 HTTP 开放，各区域只呈现真实状态——没有任务时显示空状态，
// 不展示任何虚构的任务、日志或指标。

function Region({ icon, title, children, actions }) {
  return <section className="card exp-region" aria-label={title}>
    <header><strong><PanelIcon name={icon} />{title}</strong>{actions}</header>
    {children}
  </section>
}

const monitorTabs = [
  { id: 'logs', title: '日志', icon: 'process', empty: '任务运行后，实时日志与断线重放内容显示在这里。' },
  { id: 'metrics', title: '指标', icon: 'metrics', empty: '任务运行后，训练指标曲线与原始数据显示在这里。' },
  { id: 'artifacts', title: '产物', icon: 'knowledge', empty: '任务结束后，模型、图表等实验产物显示在这里。' },
]

export function ExperimentWorkbench() {
  const [tab, setTab] = useState('logs')
  const active = monitorTabs.find((item) => item.id === tab) ?? monitorTabs[0]

  return <div className="exp">
    <div className="exp-columns">
      <Region icon="process" title="研究任务">
        <EmptyState icon="process" title="还没有研究任务"
          description="创建实验任务后，任务列表与运行状态会显示在这里。" />
      </Region>
      <div className="exp-main">
        <Region icon="setup" title="任务配置">
          <EmptyState icon="setup" title="未选择任务"
            description="选择研究任务后，研究目标、数据集与训练配置显示在这里。" />
        </Region>
        <Region icon="activity" title="实验进展">
          <EmptyState icon="activity" title="暂无运行中的实验"
            description="任务启动后，训练进度、已运行时间与暂停、终止入口显示在这里。" />
        </Region>
        <Region icon={active.icon} title="运行监控"
          actions={<nav className="exp-tabs" aria-label="运行监控">
            {monitorTabs.map((item) => (
              <button type="button" key={item.id} aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => setTab(item.id)}>{item.title}</button>
            ))}
          </nav>}>
          <EmptyState icon={active.icon} title={`暂无${active.title}`} description={active.empty} />
        </Region>
        <Region icon="alerts" title="异常提示">
          <EmptyState icon="alerts" title="暂无异常"
            description="任务运行中的异常提示与处理入口会显示在这里。" />
        </Region>
        <Region icon="graph" title="候选结果">
          <EmptyState icon="graph" title="暂无候选方案"
            description="实验产生的候选方案比较与认证结果会显示在这里。" />
        </Region>
        <Region icon="knowledge" title="实验报告">
          <EmptyState icon="knowledge" title="暂无实验报告"
            description="任务完成后可在此生成实验报告，并回流到知识库。" />
        </Region>
      </div>
    </div>
  </div>
}
