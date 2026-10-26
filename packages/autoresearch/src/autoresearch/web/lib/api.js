export class ResearchAPI {
  constructor({base = '/api', healthUrl = '/health', token = '', fetchImpl = globalThis.fetch} = {}) {
    this.base = base.replace(/\/$/, ''); this.healthUrl = healthUrl; this.token = token;
    // Browser fetch requires the Window receiver; test doubles keep the same contract.
    this.fetchImpl = fetchImpl.bind(globalThis);
  }
  async request(path, {method = 'GET', body, raw = false, health = false} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), raw ? 180000 : 15000);
    const headers = {Accept: raw ? '*/*' : 'application/json'};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await this.fetchImpl(health ? this.healthUrl : this.base + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, credentials: 'omit'});
      if (!response.ok) {
        let detail; try { detail = (await response.json()).detail; } catch { detail = response.statusText; }
        const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(d => `${d.loc?.join('.') || ''}：${d.msg}`).join('；') : '请求未成功';
        throw Object.assign(new Error(`${message}（HTTP ${response.status}）`), {status: response.status});
      }
      return raw ? response : await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(raw ? '导出三分钟内未响应，请稍后重试下载。' : '服务15秒内未响应，请检查连接后重试。当前数据未被替换成样例。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  health() { return this.request('', {health:true}); }
  templates() { return this.request('/templates'); }
  projects() { return this.request('/projects'); }
  project(id) { return this.request('/projects/' + encodeURIComponent(id)); }
  create(body) { return this.request('/projects', {method:'POST', body}); }
  start(id,confirmation={}) {
    const body={confirm_plan:true};
    for(const field of ['confirmer','opinion'])if(confirmation[field]?.trim())body[field]=confirmation[field].trim();
    return this.request(`/projects/${encodeURIComponent(id)}/runs`, {method:'POST', body});
  }
  run(id) { return this.request('/runs/' + encodeURIComponent(id)); }
  stop(id) { return this.request(`/runs/${encodeURIComponent(id)}/stop`, {method:'POST'}); }
  resume(id) { return this.request(`/runs/${encodeURIComponent(id)}/resume`, {method:'POST'}); }
  export(id) { return this.request(`/runs/${encodeURIComponent(id)}/export`, {raw:true}); }
  artifact(id) { return this.request('/artifacts/' + encodeURIComponent(id), {raw:true}); }
}
