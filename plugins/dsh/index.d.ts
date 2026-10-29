import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

export interface Config {
  baseUrl?: string
  tokenEnv?: string
}
export const name: string
export const inject: string[]
export function apply(ctx: Context, config?: Config): void
