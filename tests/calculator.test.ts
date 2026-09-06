/**
 * tests/calculator.test.ts
 *
 * The VM calculator's expression evaluator. Written by hand rather than with
 * eval(): the input is trusted here, but it keeps precedence, division by zero
 * and malformed input as explicit, testable cases instead of whatever the JS
 * engine happens to do.
 */
import { describe, it, expect } from 'vitest';
import { evaluateExpression } from '@/util/calculator';

/** Convenience: the numeric value, or throw so a bad case fails loudly. */
function val(expr: string): number {
  const r = evaluateExpression(expr);
  if (!r.ok) throw new Error(`expected ${expr} to evaluate, got: ${r.error}`);
  return r.value;
}

describe('evaluateExpression', () => {
  it('does the four operations', () => {
    expect(val('2+3')).toBe(5);
    expect(val('9-4')).toBe(5);
    expect(val('6*7')).toBe(42);
    expect(val('8/2')).toBe(4);
  });

  it('respects operator precedence', () => {
    expect(val('2+3*4')).toBe(14);
    expect(val('2*3+4')).toBe(10);
    expect(val('10-6/2')).toBe(7);
  });

  it('evaluates left to right within the same precedence', () => {
    expect(val('10-3-2')).toBe(5);
    expect(val('100/10/2')).toBe(5);
  });

  it('handles decimals', () => {
    expect(val('0.1+0.2')).toBeCloseTo(0.3, 10);
    expect(val('2.5*4')).toBe(10);
  });

  it('handles a leading negative', () => {
    expect(val('-5+8')).toBe(3);
    expect(val('-5*-4')).toBe(20);
  });

  it('rounds away binary floating-point dust', () => {
    // 0.1+0.2 must read as 0.3 on a calculator display, not 0.30000000000000004.
    const r = evaluateExpression('0.1+0.2');
    expect(r.ok && String(r.value)).toBe('0.3');
  });

  it('reports division by zero rather than returning Infinity', () => {
    const r = evaluateExpression('5/0');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/divide by zero/i);
  });

  it('reports a malformed expression', () => {
    for (const bad of ['2+', '+', '2++3', '', '   ']) {
      expect(evaluateExpression(bad).ok).toBe(false);
    }
  });

  it('rejects anything that is not a number or operator', () => {
    for (const bad of ['2+a', 'alert(1)', '2**3', '(2+3)']) {
      expect(evaluateExpression(bad).ok).toBe(false);
    }
  });

  it('handles a realistic IAM sum', () => {
    // 23 flagged accounts of 145 reviewed, as a percentage.
    expect(val('23/145*100')).toBeCloseTo(15.86, 2);
  });
});
