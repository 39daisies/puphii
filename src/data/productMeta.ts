import { ProductType } from './savings';
import { PuffProduct, PuffUnit } from './types';

/** How a savings product type maps onto a newly logged puff. Legacy logs are never rewritten. */
export function productMetaFor(type: ProductType): { product: PuffProduct; unit: PuffUnit } {
  if (type === 'cigarettes') return { product: 'cigarette', unit: 'cigarette' };
  if (type === 'vapePods' || type === 'disposables') return { product: 'vape', unit: 'puff' };
  return { product: 'unknown', unit: 'unknown' };
}

export function isPuffProduct(value: unknown): value is PuffProduct {
  return value === 'vape' || value === 'cigarette' || value === 'unknown';
}

export function isPuffUnit(value: unknown): value is PuffUnit {
  return value === 'puff' || value === 'cigarette' || value === 'unknown';
}

/** Read-time view: missing fields on older logs stay unknown rather than being guessed. */
export function resolvedProduct(log: { product?: PuffProduct }): PuffProduct {
  return log.product ?? 'unknown';
}

export function resolvedUnit(log: { unit?: PuffUnit }): PuffUnit {
  return log.unit ?? 'unknown';
}
