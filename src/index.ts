import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'evoresearch'
export const inject = ['tools']

/** Minimal DSH entry point shared with other team modules. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'evoresearch_status',
    description: 'Show whether the EvoResearch plugin is available.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return 'EvoResearch plugin is ready (week 4 skeleton).'
    },
  }))
}
