const created_at = '2026-11-20T09:30:00+08:00'
const recorded_at = '2026-11-20T10:15:00+08:00'
const title = '比较学习率对验证损失的影响'
const metric = 'loss'

export function makeFixtures() {
  const entries = [
    { document_id: 101, type: 'paper_summary', title: '学习率预热与模型收敛',
      source_type: 'paper', source_id: 11, created_at, user_note: '',
      content: { 摘要: '这条本地样例用于检查论文摘要的展示。', 研究问题: '预热时长是否会影响收敛稳定性？', 关键词: ['学习率', '训练稳定性'] } },
    { document_id: 102, type: 'experiment_report', title: '学习率对照实验记录',
      source_type: 'experiment_report', source_id: 21, created_at, user_note: '本地调试备注',
      content: { 摘要: '两组训练配置的验证损失曲线样例。', 验证结果: { 初始配置: 0.51, 对照配置: 0.38 } } },
  ]
  const tasks = [
    { taskId: 21, title, status: '运行中', rounds_done: 1, max_rounds: 3, created_at },
    { taskId: 22, title: '评估配置复现', status: '已完成', rounds_done: 1, max_rounds: 1, created_at },
  ]
  const runs = [
    { run_id: 211, round_no: 1, status: '成功', debug_depth: 0, created_at },
    { run_id: 212, round_no: 2, status: '运行中', debug_depth: 1, created_at },
  ]
  const event = (seq, type, step, payload, runId = 211, split = null) => ({ taskId: 21, seq, type, step, payload, runId, split })
  const events = [
    event(1, 'run_status', '启动训练', { status: '运行中' }),
    event(2, 'log', '训练日志', { level: 'info', message: '已载入本地样例配置' }),
    event(3, 'metric', '验证评估', { name: metric, value: 0.51, epoch: 6 }, 211, 'val'),
    event(4, 'decision', '生成对照配置', { reason: '验证损失仍高于目标', action: '调整学习率' }),
    event(5, 'alert', '验证损失告警', { metric, value: 0.51, threshold: 0.5 }, 211, 'val'),
  ]
  const series = [
    [211, 301, [0.88, 0.77, 0.72, 0.63, 0.56, 0.51]],
    [212, 302, [0.82, 0.71, 0.62, 0.49, 0.43, 0.38]],
  ].map(([runId, candidateId, values]) => ({
    runId, candidateId, split: 'val', name: metric,
    points: values.map((value, index) => ({ epoch: index + 1, global_step: null, seed: null, value, recorded_at })),
  }))
  const candidates = [
    { candidate_id: 301, run_id: 211, config: { learning_rate: 0.001 }, val_metric: 0.51, cert_status: '未认证', test_metric: null },
    { candidate_id: 302, run_id: 212, config: { learning_rate: 0.0005 }, val_metric: 0.38, cert_status: '未认证', test_metric: null },
  ]
  const rules = [{ rule_id: 41, metric, threshold: 0.5, direction: 'above', split: 'val', repeat_policy: 'once', channel: '界面弹窗', enabled: true }]
  return { entries, tasks, runs, events, series, candidates, rules }
}
