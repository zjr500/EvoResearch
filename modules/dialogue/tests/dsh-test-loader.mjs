/** 单元测试专用 import 映射：只用于检验 Cordis 插件的注册/卸载路径，不代表真实 DSH。 */
const STUBS = {
  '@deepseek-ai/dsh-tools': 'export function defineTool(value) { return value }',
  '@deepseek-ai/schemastery': `
    function field() { return { default() { return this } } }
    export default { object: field, string: field, number: field }
  `,
}
export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(STUBS, specifier)) {
    return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
