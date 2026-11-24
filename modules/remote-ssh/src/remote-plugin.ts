import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { Config as SshConfig } from '@deepseek-ai/dsh-ssh'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import Database from 'better-sqlite3'
import { HostService } from './f7/host-service.js'
import { DshSshProbe } from './f7/ssh-probe.js'

export const name = 'evoresearch-remote'
export const inject = ['tools']

export interface Config {
  dbPath: string
  profilesPath: string
}

export const Config: Schema<Config> = Schema.object({
  dbPath: Schema.string().required(),
  profilesPath: Schema.string().required(),
})

export function apply(ctx: Context, config: Config): void {
  const profiles = JSON.parse(readFileSync(config.profilesPath, 'utf8')) as Record<string, SshConfig>
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles))
    throw new Error('SSH profiles must be a JSON object keyed by host alias')
  const db = new Database(config.dbPath)
  const hosts = new HostService(db, new DshSshProbe(profiles))
  ctx.effect(() => async () => { await hosts.dispose(); db.close() })

  ctx.tools.register(defineTool({
    name: 'evoresearch_register_host',
    description: 'Register a preconfigured SSH host alias and start its environment check.',
    parameters: {
      host_alias: { type: 'string', required: true, description: 'OpenSSH host alias configured for DSH SSH.' },
      idempotency_key: { type: 'string', required: true, description: 'Unique retry key for this registration.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return JSON.stringify(hosts.registerHost(args.host_alias, args.idempotency_key)) },
  }))

  ctx.tools.register(defineTool({
    name: 'evoresearch_host_check_status',
    description: 'Read the status and redacted result of a host environment check.',
    parameters: {
      operation_id: { type: 'number', required: true, description: 'Operation ID returned by host registration.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const operation = hosts.getOperation(args.operation_id)
      if (!operation) throw new Error('操作记录不存在')
      return JSON.stringify(operation)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evoresearch_host_check_report',
    description: 'Read a registered host and its structured GPU, driver and framework check result.',
    parameters: {
      host_id: { type: 'number', required: true, description: 'Host ID returned by host registration.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const host = hosts.getHost(args.host_id)
      if (!host) throw new Error('远程主机不存在')
      return JSON.stringify(host)
    },
  }))
}
