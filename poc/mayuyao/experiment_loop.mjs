import assert from 'node:assert/strict'

function validateTask(task) {
  for (const field of ['hypothesis', 'metric', 'dataset', 'threshold', 'maxRounds']) {
    if (task[field] === undefined || task[field] === '') throw new Error(`missing ${field}`)
  }
  if (!Number.isFinite(task.threshold)) throw new Error('threshold must be finite')
  if (!Number.isInteger(task.maxRounds) || task.maxRounds < 1 || task.maxRounds > 10) {
    throw new Error('maxRounds must be 1..10')
  }
  const { train, validation, test } = task.dataset
  if (![train, validation, test].every(x => typeof x === 'string' && x.length)) {
    throw new Error('train, validation, test must be named')
  }
  if (new Set([train, validation, test]).size !== 3) throw new Error('splits must differ')
  return Object.freeze({
    hypothesis: task.hypothesis,
    metric: task.metric,
    threshold: task.threshold,
    maxRounds: task.maxRounds,
    train,
    validation,
    test,
  })
}

async function runExperiment(input, executeRound, certify) {
  const task = validateTask(input)
  const events = []
  let candidate = null
  for (let round = 1; round <= task.maxRounds; round++) {
    // The iterative executor receives no test-set handle.
    const visible = Object.freeze({
      hypothesis: task.hypothesis, metric: task.metric,
      train: task.train, validation: task.validation,
    })
    events.push({ round, type: 'round_started' })
    const result = await executeRound(visible, round)
    if (result.error) {
      events.push({ round, type: 'debug_needed', error: result.error })
      continue
    }
    assert.ok(Number.isFinite(result.validationMetric))
    events.push({ round, type: 'validation', value: result.validationMetric })
    if (!candidate || result.validationMetric > candidate.validationMetric) {
      candidate = { round, validationMetric: result.validationMetric }
    }
    if (result.validationMetric >= task.threshold) break
  }
  if (!candidate) return { status: 'no_candidate', events, testCalls: 0 }
  const testResult = await certify(Object.freeze({ ...candidate, test: task.test }))
  events.push({ type: 'final_test', value: testResult })
  return {
    status: candidate.validationMetric >= task.threshold ? 'threshold_reached' : 'max_rounds',
    candidate, events, testCalls: 1,
  }
}

const task = {
  hypothesis: 'Simple model improves validation accuracy', metric: 'accuracy',
  dataset: { train: 'train.csv', validation: 'val.csv', test: 'held-out.csv' },
  threshold: 0.8, maxRounds: 2,
}
let finalCalls = 0
const reached = await runExperiment(task,
  async (visible, round) => {
    assert.equal('test' in visible, false)
    assert.equal(visible.train, 'train.csv')
    return { validationMetric: round === 1 ? 0.72 : 0.84 }
  },
  async candidate => { finalCalls++; assert.equal(candidate.test, 'held-out.csv'); return 0.81 },
)
assert.equal(reached.status, 'threshold_reached')
assert.equal(reached.events.filter(e => e.type === 'final_test').length, 1)
assert.equal(finalCalls, 1)

const capped = await runExperiment({ ...task, threshold: 0.95 },
  async (_visible, round) => round === 1 ? { error: 'training failed' } : { validationMetric: 0.73 },
  async () => 0.71,
)
assert.equal(capped.status, 'max_rounds')
assert.equal(capped.events.filter(e => e.type === 'round_started').length, 2)
assert.equal(capped.events.filter(e => e.type === 'debug_needed').length, 1)
assert.throws(() => validateTask({ ...task, dataset: { train: 'x', validation: 'x', test: 'y' } }))
console.log(JSON.stringify({
  validation: 'pass', reached: reached.status, reachedRounds: 2,
  capped: capped.status, cappedRounds: 2, finalTestCalls: finalCalls,
  testHiddenDuringLoop: true, invalidSplitRejected: true,
}))
