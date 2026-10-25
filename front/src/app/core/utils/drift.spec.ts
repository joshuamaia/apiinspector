import type { ContractField } from '../models/drift.model';
import { checkContract, inferContract, notJsonReport, parentPath, suggestRequirements } from './drift';

const baseline = {
  id: 1,
  name: 'Keyboard',
  price: 129.9,
  inStock: true,
  discount: null,
  tags: ['a', 'b'],
  supplier: { id: 7, country: 'DE' },
  variants: [
    { sku: 'A', color: 'black' },
    { sku: 'B' },
  ],
};

function contract(requirements: Record<string, ContractField['requirement']> = {}): ContractField[] {
  return inferContract(baseline).map((f) => ({ ...f, requirement: requirements[f.path] ?? f.requirement }));
}

describe('inferContract', () => {
  it('infers paths, types and nullability', () => {
    const fields = inferContract(baseline);
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
    expect(byPath['$'].requirement).toBe('required');
    expect(byPath['$.price'].types).toEqual(['number']);
    expect(byPath['$.discount']).toMatchObject({ types: [], nullable: true });
    expect(byPath['$.tags[]'].types).toEqual(['string']);
    expect(byPath['$.variants[].sku'].types).toEqual(['string']);
    expect(byPath['$.supplier.country'].requirement).toBe('unspecified');
  });

  it('suggests requirements from presence', () => {
    const fields = suggestRequirements(baseline, inferContract(baseline));
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f.requirement]));
    expect(byPath['$.variants[].sku']).toBe('required');
    expect(byPath['$.variants[].color']).toBe('optional');
    expect(byPath['$.discount']).toBe('optional');
  });

  it('computes parent paths', () => {
    expect(parentPath('$.a.b')).toBe('$.a');
    expect(parentPath('$.a[]')).toBe('$.a');
    expect(parentPath('$.a[].b')).toBe('$.a[]');
    expect(parentPath("$['x y'].z")).toBe("$['x y']");
    expect(parentPath('$.a')).toBe('$');
  });
});

describe('checkContract', () => {
  it('is compatible with an identical response', () => {
    const report = checkContract(contract(), baseline, { strictAdditions: false });
    expect(report.verdict).toBe('compatible');
    expect(report.findings).toEqual([]);
  });

  it('classifies missing fields according to requirements', () => {
    const { name, supplier, ...rest } = baseline;
    void name;
    void supplier;
    const report = checkContract(contract({ '$.name': 'required', '$.supplier': 'optional' }), rest, { strictAdditions: false });
    const byPath = Object.fromEntries(report.findings.map((f) => [f.path, f]));
    expect(byPath['$.name']).toMatchObject({ kind: 'missing', severity: 'breaking' });
    expect(byPath['$.supplier']).toMatchObject({ kind: 'missing', severity: 'info' });
    // children of a missing object are not reported again
    expect(byPath['$.supplier.id']).toBeUndefined();
    expect(report.verdict).toBe('incompatible');
  });

  it('flags missing fields without rules as insufficient information', () => {
    const { inStock, ...rest } = baseline;
    void inStock;
    const report = checkContract(contract(), rest, { strictAdditions: false });
    expect(report.findings[0]).toMatchObject({ path: '$.inStock', severity: 'unknown' });
    expect(report.verdict).toBe('inconclusive');
  });

  it('detects type changes and unexpected nulls', () => {
    const actual = { ...baseline, price: { amount: 1 }, inStock: null, id: '1' };
    const report = checkContract(contract({ '$.price': 'required', '$.inStock': 'optional' }), actual, { strictAdditions: false });
    const byPath = Object.fromEntries(report.findings.map((f) => [f.path, f]));
    expect(byPath['$.price']).toMatchObject({ kind: 'type-changed', severity: 'breaking', expected: 'number', actual: 'object' });
    expect(byPath['$.inStock']).toMatchObject({ kind: 'unexpected-null', severity: 'risk' });
    expect(byPath['$.id']).toMatchObject({ kind: 'type-changed', severity: 'risk' });
    // no "added" findings below a type-changed field
    expect(byPath['$.price.amount']).toBeUndefined();
  });

  it('reports new fields as additive unless strict', () => {
    const actual = { ...baseline, rating: 4.5, supplier: { ...baseline.supplier, address: { city: 'Berlin' } } };
    const lenient = checkContract(contract(), actual, { strictAdditions: false });
    expect(lenient.findings.map((f) => [f.path, f.severity])).toEqual([
      ['$.rating', 'info'],
      ['$.supplier.address', 'info'],
    ]);
    expect(lenient.verdict).toBe('compatible');
    const strict = checkContract(contract(), actual, { strictAdditions: true });
    expect(strict.verdict).toBe('potentially-incompatible');
  });

  it('checks nested array items and reports partial absence', () => {
    const actual = { ...baseline, variants: [{ sku: 'A' }, { color: 'red' }, { sku: 1 }] };
    const report = checkContract(contract({ '$.variants[].sku': 'required' }), actual, { strictAdditions: false });
    const sku = report.findings.filter((f) => f.path === '$.variants[].sku');
    expect(sku.map((f) => f.kind).sort()).toEqual(['missing', 'type-changed']);
    expect(sku.find((f) => f.kind === 'missing')!.occurrences).toBe(1);
  });

  it('marks empty arrays as unverifiable', () => {
    const report = checkContract(contract(), { ...baseline, variants: [] }, { strictAdditions: false });
    expect(report.findings).toEqual([expect.objectContaining({ path: '$.variants[]', kind: 'empty-array', severity: 'unknown' })]);
  });

  it('detects a root structure change', () => {
    const report = checkContract(contract(), [baseline], { strictAdditions: false });
    expect(report.findings[0]).toMatchObject({ path: '$', kind: 'type-changed', severity: 'breaking' });
  });

  it('produces a report for non-JSON responses', () => {
    expect(notJsonReport(contract(), 'Unexpected token <').verdict).toBe('incompatible');
  });
});
