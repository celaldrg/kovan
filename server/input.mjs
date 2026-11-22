// Allowlists for values that are stored and later shown or passed to a CLI.
import { EFFORTS, acceptModel, modelChoices } from './ai.mjs';
import { sanitizeRule } from '../shared/schedule.js';

export function checkModel(model, cfg) {
  const value = acceptModel(model ?? '', modelChoices(cfg));
  if (value == null) return { error: 'invalid model' };
  return { value };
}

export function checkEffort(effort) {
  const value = effort == null || effort === '' ? '' : String(effort);
  if (!EFFORTS.includes(value)) return { error: 'invalid effort' };
  return { value };
}

export function checkDept(dept, crew) {
  const value = String(dept || '');
  if (value && !(crew.depts || []).some(d => d.id === value)) return { error: 'invalid department' };
  return { value };
}

export function checkRule(rule) {
  const value = sanitizeRule(rule);
  if (!value) return { error: 'invalid rule' };
  return { value };
}
