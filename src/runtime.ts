import type { Context } from '@deepseek-ai/cordis';
import { openDatabase } from './infrastructure/database.js';
import { installKnowledge } from './knowledge/plugin.js';

/** Composition root. Dormant modules and SSH are deliberately not loaded. */
export function installRuntime(ctx: Context) {
  return ctx.inject(['connection', 'webServer', 'llm'], scope => {
    const store = openDatabase();
    let disposeKnowledge: () => Promise<void>;
    try { disposeKnowledge = installKnowledge(scope, store); }
    catch (error) { store.close(); throw error; }
    scope.effect(() => async () => {
      try { await disposeKnowledge(); } finally { store.close(); }
    });
  });
}
