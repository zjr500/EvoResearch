import type { Context } from '@deepseek-ai/cordis';
import type { DockerExecution } from './docker-execution.js';
import { registerExperimentTools } from './agent-tools.js';

export const name = 'evoresearch-experiment-tools';

/**
 * Experiment tool surface, loaded ONLY inside the `evoresearch-experiment`
 * agent preset subtree (see cordis.patch.yml). Ordinary chat sessions never
 * load this module, so the restricted experiment tools cannot leak into
 * general conversations.
 *
 * The controlled Docker execution service lives in the root runtime; this
 * scope waits until that provider activates, then registers the tools into
 * this agent scope only. If the root plugin is absent the preset row stays
 * pending instead of exposing a half-wired tool.
 */
export function apply(ctx: Context): void {
  (ctx.inject as (deps: string[], cb: (scope: Context) => void) => void)(['evoresearchExperimentExecution'], (scope) => {
    const execution = scope.get('evoresearchExperimentExecution') as DockerExecution | undefined;
    if (!execution) return;
    scope.inject(['tools', 'systemPrompt'], (inner) => {
      // Owner 1 is the local DSH host owner (see infrastructure/http.ts); the
      // experiment agent always acts as the host user, never across owners.
      inner.effect(() => registerExperimentTools(inner as unknown as Context, execution, 1));
    });
  });
}
