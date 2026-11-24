import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

export interface CheckResult {
  host_alias: string
  status: '就绪' | '不可用'
  gpu_info: string | null
  driver: string | null
  framework: string | null
  work_dir: string | null
  checked_at: string
  error_code: string | null
  error_reason: string | null
}

export interface RemoteProbe {
  check(hostAlias: string): Promise<CheckResult>
}

export interface AcceptedHost {
  host_id: number
  operation_id: number
  status: '自检中' | '就绪' | '不可用'
}

type HostRow = { host_id: number; host_alias: string; status: AcceptedHost['status'];
  gpu_info: string | null; driver: string | null; framework: string | null;
  work_dir: string | null; checked_at: string | null; error_code: string | null; error_reason: string | null }
type OperationRow = { id: number; operation_type: string; target_id: string; status: string;
  result_ref: string | null; updated_at: string }

const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9_.@-]*$/

/** F7 database facade. A shared operation_records migration must already be installed. */
export class HostService {
  private readonly inFlight = new Set<number>()
  private readonly pending = new Set<Promise<void>>()
  private closed = false

  constructor(private readonly db: Database.Database, private readonly probe: RemoteProbe) {}

  registerHost(hostAlias: string, idempotencyKey: string): AcceptedHost {
    if (this.closed) throw new Error('主机服务已关闭')
    if (!aliasPattern.test(hostAlias)) throw new Error('主机别名只能包含字母、数字、点、下划线、@ 和连字符')
    if (!idempotencyKey || idempotencyKey.length > 128) throw new Error('idempotency_key 必须为 1–128 个字符')
    const digest = createHash('sha256').update(JSON.stringify({ host_alias: hostAlias })).digest('hex')
    const accepted = this.db.transaction(() => {
      const previous = this.db.prepare('SELECT id, target_id, request_digest FROM operation_records WHERE idempotency_key = ?')
        .get(idempotencyKey) as { id: number; target_id: string; request_digest: string } | undefined
      if (previous) {
        if (previous.request_digest !== digest) throw new Error('4020: 幂等键对应的请求内容不同')
        const host = this.getHost(Number(previous.target_id))
        if (!host) throw new Error('幂等操作对应的主机不存在')
        return { host_id: host.host_id, operation_id: previous.id, status: host.status }
      }
      let host = this.db.prepare('SELECT host_id FROM remote_hosts WHERE host_alias = ?')
        .get(hostAlias) as { host_id: number } | undefined
      if (host) {
        const active = this.db.prepare(`SELECT id FROM operation_records
          WHERE operation_type = '远程环境自检' AND target_id = ? AND status IN ('受理', '执行中')
          ORDER BY id DESC LIMIT 1`).get(String(host.host_id)) as { id: number } | undefined
        if (active) return { host_id: host.host_id, operation_id: active.id, status: '自检中' as const }
        this.db.prepare("UPDATE remote_hosts SET status = '自检中', checked_at = NULL, error_code = NULL, error_reason = NULL WHERE host_id = ?")
          .run(host.host_id)
      } else {
        const result = this.db.prepare("INSERT INTO remote_hosts (host_alias, status) VALUES (?, '自检中')").run(hostAlias)
        host = { host_id: Number(result.lastInsertRowid) }
      }
      const now = new Date().toISOString()
      const result = this.db.prepare(`INSERT INTO operation_records
        (idempotency_key, operation_type, target_id, status, request_digest, result_ref, created_at, updated_at)
        VALUES (?, '远程环境自检', ?, '受理', ?, NULL, ?, ?)`)
        .run(idempotencyKey, String(host.host_id), digest, now, now)
      return { host_id: host.host_id, operation_id: Number(result.lastInsertRowid), status: '自检中' as const }
    })()
    if (accepted.status === '自检中' && !this.inFlight.has(accepted.operation_id)) {
      const task = this.performCheck(accepted.host_id, accepted.operation_id, hostAlias)
      this.pending.add(task)
      void task.finally(() => { this.pending.delete(task) }).catch(() => {})
    }
    return accepted
  }

  async dispose(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.pending])
  }

  getHost(hostId: number): HostRow | undefined {
    return this.db.prepare(`SELECT host_id, host_alias, status, gpu_info, driver, framework,
      work_dir, checked_at, error_code, error_reason FROM remote_hosts WHERE host_id = ?`)
      .get(hostId) as HostRow | undefined
  }

  getOperation(operationId: number): { operation_id: number; operation_type: string; status: string;
    result_ref: string | null; error: string | null; updated_at: string } | undefined {
    const op = this.db.prepare('SELECT id, operation_type, target_id, status, result_ref, updated_at FROM operation_records WHERE id = ?')
      .get(operationId) as OperationRow | undefined
    if (!op) return undefined
    const host = this.getHost(Number(op.target_id))
    return { operation_id: op.id, operation_type: op.operation_type, status: op.status,
      result_ref: op.result_ref, error: op.status === '失败' ? host?.error_reason ?? '自检失败' : null,
      updated_at: op.updated_at }
  }

  private async performCheck(hostId: number, operationId: number, hostAlias: string): Promise<void> {
    if (this.inFlight.has(operationId)) return
    this.inFlight.add(operationId)
    try {
      this.db.prepare("UPDATE operation_records SET status = '执行中', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), operationId)
      let result: CheckResult
      try {
        result = await this.probe.check(hostAlias)
      } catch {
        result = { host_alias: hostAlias, status: '不可用', gpu_info: null, driver: null,
          framework: null, work_dir: null, checked_at: new Date().toISOString(),
          error_code: 'CHECK_FAILED', error_reason: '环境自检执行失败；请核对 DSH SSH 配置和远端环境' }
      }
      if (result.host_alias !== hostAlias || !['就绪', '不可用'].includes(result.status))
        throw new Error('自检返回了不匹配的主机或状态')
      this.db.transaction(() => {
        this.db.prepare(`UPDATE remote_hosts SET status = ?, gpu_info = ?, driver = ?, framework = ?,
          work_dir = ?, checked_at = ?, error_code = ?, error_reason = ? WHERE host_id = ?`)
          .run(result.status, result.gpu_info, result.driver, result.framework, result.work_dir,
            result.checked_at, result.error_code, result.error_reason, hostId)
        this.db.prepare('UPDATE operation_records SET status = ?, result_ref = ?, updated_at = ? WHERE id = ?')
          .run(result.status === '就绪' ? '成功' : '失败', result.status === '就绪' ? String(hostId) : null,
            new Date().toISOString(), operationId)
      })()
    } catch {
      this.db.transaction(() => {
        this.db.prepare("UPDATE remote_hosts SET status = '不可用', checked_at = ?, error_code = 'CHECK_FAILED', error_reason = '环境自检记录失败' WHERE host_id = ?")
          .run(new Date().toISOString(), hostId)
        this.db.prepare("UPDATE operation_records SET status = '失败', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), operationId)
      })()
    } finally {
      this.inFlight.delete(operationId)
    }
  }
}
