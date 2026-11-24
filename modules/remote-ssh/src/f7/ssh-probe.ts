import { Context } from '@deepseek-ai/cordis'
import SshConnection, { type Config as SshConfig } from '@deepseek-ai/dsh-ssh'
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh'
import type { CheckResult, RemoteProbe } from './host-service.js'

const frameworkScript = `import importlib.metadata as m, json
found = {}
for name in ('torch', 'tensorflow', 'jax'):
    try:
        found[name] = m.version(name)
    except m.PackageNotFoundError:
        pass
print(json.dumps(found))`

function failed(hostAlias: string, code: string, reason: string, workDir: string | null = null): CheckResult {
  return { host_alias: hostAlias, status: '不可用', gpu_info: null, driver: null,
    framework: null, work_dir: workDir, checked_at: new Date().toISOString(),
    error_code: code, error_reason: reason }
}

function classify(error: unknown): { code: string; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (/host key|known.host|identification has changed/.test(message))
    return { code: 'HOST_KEY_REJECTED', reason: 'SSH 主机密钥校验失败' }
  if (/permission denied|authentication|publickey/.test(message))
    return { code: 'SSH_AUTH_FAILED', reason: 'SSH 密钥认证失败' }
  if (/timed out|timeout|unreachable|connection refused|could not resolve/.test(message))
    return { code: 'HOST_UNREACHABLE', reason: '远程主机不可达或连接超时' }
  if (/nvidia-smi/.test(message))
    return { code: 'GPU_CHECK_FAILED', reason: '未检测到可用 NVIDIA GPU 或驱动' }
  if (/python3/.test(message))
    return { code: 'FRAMEWORK_CHECK_FAILED', reason: '远端 Python 及框架检查失败' }
  return { code: 'REMOTE_CHECK_FAILED', reason: 'DSH SSH 连接或环境检查失败' }
}

/** Runs all remote commands through the official DSH SSH connection and subprocess providers. */
export class DshSshProbe implements RemoteProbe {
  constructor(private readonly profiles: Record<string, SshConfig>) {}

  async check(hostAlias: string): Promise<CheckResult> {
    const profile = this.profiles[hostAlias]
    if (!profile || profile.host !== hostAlias)
      return failed(hostAlias, 'HOST_NOT_CONFIGURED', '主机别名未在 DSH SSH profiles 中配置')

    const ctx = new Context()
    const connection = ctx.plugin(SshConnection, profile)
    const subprocess = ctx.plugin(SshSubprocessRuntime)
    try {
      await Promise.all([connection, subprocess])
      await ctx.ssh.ready
      const gpuOutput = await this.run(ctx, profile.workspace, 'nvidia-smi',
        ['--query-gpu=name,driver_version', '--format=csv,noheader'])
      const gpuRows = gpuOutput.trim().split(/\r?\n/).filter(Boolean)
      const first = gpuRows[0]?.split(',').map(value => value.trim())
      if (!first || first.length < 2 || !first[0] || !first[1])
        return failed(hostAlias, 'GPU_CHECK_FAILED', 'nvidia-smi 未返回 GPU 和驱动信息', profile.workspace)
      const pythonOutput = await this.run(ctx, profile.workspace, 'python3', ['-c', frameworkScript])
      const versions = JSON.parse(pythonOutput) as Record<string, string>
      const framework = Object.entries(versions).map(([name, version]) => `${name} ${version}`).join('; ')
      if (!framework) return failed(hostAlias, 'FRAMEWORK_MISSING', '未检测到 torch、tensorflow 或 jax', profile.workspace)
      return { host_alias: hostAlias, status: '就绪',
        gpu_info: gpuRows.map(row => row.split(',')[0]?.trim()).join('; '),
        driver: first[1], framework, work_dir: profile.workspace,
        checked_at: new Date().toISOString(), error_code: null, error_reason: null }
    } catch (error) {
      const { code, reason } = classify(error)
      return failed(hostAlias, code, reason, profile.workspace)
    } finally {
      await Promise.allSettled([subprocess.dispose(), connection.dispose()])
    }
  }

  private async run(ctx: Context, cwd: string, command: string, args: string[]): Promise<string> {
    const executable = await ctx.subprocess.resolveExecutable(command)
    const handle = ctx.subprocess.spawn({
      argv: [executable, ...args], cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 4096 } },
      graceMs: 1000, signal: AbortSignal.timeout(20_000),
    })
    const outcome = await handle.done
    const settled = await handle.waitForExit(AbortSignal.timeout(5000))
    const stdout = handle.collected.stdout?.readFrom(0)
    if (!settled || stdout?.lossy || outcome.exitCode !== 0)
      throw new Error(`${command} failed (exit ${outcome.exitCode ?? 'unknown'})`)
    return stdout?.text ?? ''
  }
}
