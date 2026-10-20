import test from 'node:test';
import assert from 'node:assert/strict';
import { periodicTask } from '../src/maintenance.js';

test('maintenance does not overlap and drains an active operation before stopping', async () => {
  let finish, started = 0;
  const work = new Promise(resolve => { finish = resolve; });
  const task = periodicTask(() => { started++; return work; }, error => { throw error; });
  const first = task.run();
  assert.equal(task.run(), first);
  let drained = false;
  const stopping = task.stop().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(started, 1);
  assert.equal(drained, false);
  finish();
  await stopping;
  await task.run();
  assert.equal(started, 1);
});

test('a failed maintenance run reports once and permits the next scheduled run', async () => {
  let started = 0;
  const errors = [];
  const failure = new Error('fixture');
  const task = periodicTask(() => { if (++started === 1) throw failure; }, error => errors.push(error));
  try {
    await task.run();
    await task.run();
    assert.deepEqual(errors, [failure]);
    assert.equal(started, 2);
  } finally {
    await task.stop();
  }
});
