import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDepartment, guessDepartment } from './departments.js';

const depts = [
  { id: 'research', code: 'RES', name: 'Research', tr: 'Araştırma', mission: 'Markets, rivals and trends.' },
  { id: 'design', code: 'DSN', name: 'Design', tr: 'Tasarım', mission: 'Art direction, UI flows and key art.' },
  { id: 'finance', code: 'FIN', name: 'Finance', tr: 'Finans', mission: 'Budget, invoices and pricing.' },
];

test('department prefix by id, code or Turkish name', () => {
  assert.deepEqual(pickDepartment('@design new pricing page brief', depts), { dept: 'design', task: 'new pricing page brief' });
  assert.deepEqual(pickDepartment('fin: list overdue invoices', depts), { dept: 'finance', task: 'list overdue invoices' });
  assert.deepEqual(pickDepartment('@Araştırma rakip fiyatları', depts), { dept: 'research', task: 'rakip fiyatları' });
  assert.equal(pickDepartment('@nobody do it', depts), null);
  assert.equal(pickDepartment('note: this is not a department', depts), null);
});

test('guess a department from the words', () => {
  assert.equal(guessDepartment('check our budget before the sale', depts), 'finance');
  assert.equal(guessDepartment('watch rivals and new trends', depts), 'research');
  assert.equal(guessDepartment('hello there', depts), '');
});
