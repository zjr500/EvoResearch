/**
 * 离线课程项目编译用的极小接口声明：避免在没有 DSH 宿主的机器上下载其运行时包。
 * 在真实宿主内，请以 0.2.1-rc.2 的实际类型声明为准重新类型检查。
 * 这里不模拟 DSH 的 Session 内部 API，避免把会话历史造假。
 */
declare module '@deepseek-ai/cordis' {
  export interface Context {
    tools: { register(definition: unknown): () => void }
    systemPrompt: {
      section(section: {name: string; order: number; text: string}): () => void
    }
  }
}
declare module '@deepseek-ai/dsh-tools' {
  export interface SimpleToolDefinition<A, O> {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: { type: 'string' }
      render: (args: A, value: O) => { type: 'text'; text: string }[]
    }
    execute: (args: A, execution?: unknown) => Promise<O>
  }
  export function defineTool(definition: {
    name: string; description: string; parameters: Record<string, unknown>
    output: { schema: {type: 'string'}, render: (args: unknown, value: string) => {type: 'text'; text: string}[] }
    execute(args: any): Promise<string>
  }): unknown
}
declare module '@deepseek-ai/schemastery' {
  interface Schema<T=unknown> {
    default(value: T): Schema<T>
  }
  const Schema: {
    object(fields: Record<string, Schema>): Schema
    string(): Schema<string>
    number(): Schema<number>
  }
  export default Schema
}
