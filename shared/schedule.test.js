import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, nextRun, describeRule, isOutbound, detectSwarm, occurrences } from './schedule.js';

test('weekday morning', () => {
  const p = parseSchedule('every weekday at 8am, sum up new support tickets');
  assert.deepEqual(p.rule, { kind: 'days', weekdays: [1, 2, 3, 4, 5], hour: 8, minute: 0 });
  assert.equal(p.task, 'sum up new support tickets');
  assert.equal(describeRule(p.rule), 'weekdays · 08:00');
});
test('named days with pm', () => {
  const p = parseSchedule('every monday and thursday at 5:30pm list overdue invoices');
  assert.deepEqual(p.rule.weekdays, [1, 4]);
  assert.equal(p.rule.hour, 17); assert.equal(p.rule.minute, 30);
});
test('turkish', () => {
  const p = parseSchedule('her gün saat 9 bülteni hazırla');
  assert.equal(p.rule.kind, 'days'); assert.equal(p.rule.hour, 9);
  assert.equal(p.task, 'bülteni hazırla');
  assert.equal(parseSchedule('her 15 dakikada stokları kontrol et').rule.every, 15);
});
test('intervals and none', () => {
  assert.deepEqual(parseSchedule('every 2 hours check uptime').rule, { kind: 'hours', every: 2 });
  assert.equal(parseSchedule('write a blog post about bees'), null);
});
test('nextRun daily', () => {
  const rule = { kind: 'days', weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 9, minute: 0 };
  const from = new Date(2026, 0, 5, 10, 0).getTime();
  assert.equal(nextRun(rule, from), new Date(2026, 0, 6, 9, 0).getTime());
  assert.equal(occurrences(rule, from, from + 3 * 86400e3).length, 3);
});
test('keeps content words', () => {
  assert.equal(parseSchedule('every monday at 10am write the weekly support summary').task, 'write the weekly support summary');
  assert.equal(parseSchedule('every friday write the daily recap digest').task, 'write the daily recap digest');
  assert.equal(parseSchedule('hafta içi her gün saat 8:30 destek kutusunu özetle').rule.hour, 8);
});
test('outbound + swarm', () => {
  assert.ok(isOutbound('send the weekly report to Ayşe'));
  assert.ok(!isOutbound('draft a weekly report'));
  assert.deepEqual(detectSwarm('as a team, plan the launch'), { swarm: true, task: 'plan the launch' });
});
