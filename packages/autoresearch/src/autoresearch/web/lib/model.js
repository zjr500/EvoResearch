export const ACTIVE = new Set(['queued', 'running', 'cancelling']);
export const RESUMABLE = new Set(['cancelled', 'interrupted']);
export const statusNames = {draft: '待确认计划', queued: '排队中', running: '运行中', cancelling: '正在停止', cancelled: '已停止', interrupted: '运行中断', completed: '已完成', failed: '运行失败', budget_exhausted: '预算已耗尽', valid: '有效', timeout: '实验超时', model_failed: '提案失败', execution_failed: '执行失败', invalid_output: '无效输出', missing_output: '缺少输出', check_failed: '检查失败'};
export const phaseNames = {queued: '等待执行', prepare: '准备数据', baseline: '固定基线', proposing: '提出修改', experiment: '训练评测', confirmation: '重复验证', final_evaluation: '最终测试', completed: '研究完成', termination_failed: '进程终止失败'};
export const metricLabels = {accuracy: '准确率', macro_f1: 'Macro-F1', mse: 'MSE', mae: 'MAE'};
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char])); }
export function metricMeta(template, run = {}, project = {}) {
  const block=run?.metric||project?.metric||template?.metric||template||{};
  const key = block.primary_metric || run?.primary_metric || Object.keys(run?.baseline || {})[0];
  const secondary=block.secondary_metrics||[block.secondary_metric].filter(Boolean);
  return {key,label:block.primary_label||metricLabels[key]||key||'指标待提供',direction:block.direction||null,
    secondary,secondaryLabel:block.secondary_label||null,unit:block.unit||null,runnable:block.runnable};
}
export function runStatusLabel(run){return run?.status_label||statusNames[run?.status]||run?.status||'状态待查询';}
export function roundsCompleted(run){return run?.progress?.rounds_completed??run?.snapshot?.rounds_completed??(run?.trials||[]).filter(t=>t.terminal||t.status==='valid').length;}
export function stageLabel(run){return run?.progress?.stage_label||phaseNames[run?.progress?.stage||run?.stage]||run?.stage||'等待开始';}
export function elapsedSeconds(run){return run?.progress?.elapsed_seconds??run?.snapshot?.consumed_budget?.elapsed??run?.elapsed??0;}
export function proposalCount(run){return run?.proposal_calls?.count??run?.llm_calls??run?.snapshot?.consumed_budget?.llm_calls??0;}
export function failureReason(run){return run?.status==='completed'?null:run?.snapshot?.failure_reason||run?.error||run?.stop_reason||null;}
export function formatMetric(value, key) { return finite(value) ? (key === 'accuracy' || key === 'macro_f1' ? (value * 100).toFixed(2) + '%' : value.toFixed(6)) : '—'; }
export function improvement(candidate, baseline, direction) {
  if (!finite(candidate) || !finite(baseline) || !['maximize', 'minimize'].includes(direction)) return null;
  return direction === 'minimize' ? candidate < baseline : candidate > baseline;
}
export function bestTrial(run, meta) {
  if (!meta.key || !['maximize','minimize'].includes(meta.direction)) return null;
  return (run?.trials || []).filter(t => t.status === 'valid' && improvement(t.metrics?.[meta.key], run.baseline?.[meta.key], meta.direction))
    .reduce((best, trial) => !best || improvement(trial.metrics[meta.key], best.metrics[meta.key], meta.direction) ? trial : best, null);
}
export function formatDelta(delta, key) { return finite(delta) ? (delta > 0 ? '+' : '') + (key === 'accuracy' || key === 'macro_f1' ? (delta * 100).toFixed(2) + ' 个百分点' : delta.toFixed(6)) : '—'; }
export function projectStatus(project) { return project.runs?.[0]?.status || (Array.isArray(project.runs) ? 'draft' : 'unknown'); }
export function progress(run, rounds) {
  if (!run) return 0;
  if(finite(run.progress?.fraction))return Math.round(Math.max(0,Math.min(1,run.progress.fraction))*100);
  if (run.status === 'completed') return 100;
  const count = (run.trials || []).filter(t => t.terminal).length;
  return Math.min(94, Math.round(8 + count / Math.max(1, rounds) * 65 + ({confirmation: 10, final_evaluation: 18}[run.stage] || 0)));
}
export function createPayload(template, goal, budget){
  if(!template||template.runnable===false)throw new Error(template?.unavailable_reason||'该任务当前不可创建，请等待研究框架接入。');
  if(typeof goal!=='string'||goal.trim().length<3||goal.trim().length>2000)throw new Error('研究目标请填写3—2000个非空字符。');
  return {template_id:template.id,goal:goal.trim(),editable_paths:[...(template.editable_paths||['model.py'])],budget:validateBudget(budget)};
}
export function duration(seconds) { const s = Math.max(0, Math.round(seconds || 0)); return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`; }
export function dateLabel(timestamp) { return timestamp ? new Date(timestamp * 1000).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—'; }
export function validateBudget(budget) {
  for (const [key, low, high] of [['rounds',2,10], ['total_seconds',10,3600], ['experiment_seconds',1,120], ['max_llm_calls',1,40]]) {
    if (!Number.isInteger(budget[key]) || budget[key] < low || budget[key] > high) throw new Error(`预算 ${key} 必须在 ${low}—${high} 范围内。`);
  }
  return budget;
}
