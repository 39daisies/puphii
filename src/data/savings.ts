/**
 * Savings calculator: pure, locally computed spending estimates from what the user
 * says they buy and use. Logged puffs are never converted into money here, because a
 * puff is not a fixed amount of product.
 */

import { withUnknownFields } from './preserve';

export type ProductType = 'cigarettes' | 'vapePods' | 'disposables' | 'other';
export const PRODUCT_TYPES: readonly ProductType[] = ['cigarettes', 'vapePods', 'disposables', 'other'];

/** `rate`: how many units are used per day/week. `lasts`: how many days one purchase lasts. */
export type UsageBasis = 'rate' | 'lasts';

export type ProductInputs = {
  /** Price of one purchase (a pack, a pack of pods, one disposable, or one item). */
  price: number | null;
  /** Units in one purchase, for products sold in packs. */
  unitsPerPurchase: number | null;
  basis: UsageBasis;
  /** Units used per `ratePeriod` of the product. */
  rate: number | null;
  /** Days one purchase typically lasts. */
  lastsDays: number | null;
};

export type SavingsSettings = {
  productType: ProductType;
  currency: string;
  /** Kept per product so switching type never mixes a pack price with a disposable's. */
  products: Record<ProductType, ProductInputs>;
  /** Reduction scenario the user is looking at, in whole percent. */
  reductionPercent: number;
  goalName: string;
  goalAmount: number | null;
};

type ProductInfo = {
  label: string;
  /** What one purchase is, as used in "Price of one …". */
  purchase: string;
  unitPlural: string;
  /** Units per purchase is asked for only when the product comes in packs. */
  packSize: boolean;
  ratePeriod: 'day' | 'week' | null;
  bases: readonly UsageBasis[];
};

export const PRODUCTS: Record<ProductType, ProductInfo> = {
  cigarettes: { label: 'Cigarettes', purchase: 'pack', unitPlural: 'cigarettes', packSize: true, ratePeriod: 'day', bases: ['rate', 'lasts'] },
  vapePods: { label: 'Vape pods', purchase: 'pack', unitPlural: 'pods', packSize: true, ratePeriod: 'week', bases: ['rate', 'lasts'] },
  disposables: {
    label: 'Disposable vapes',
    purchase: 'disposable vape',
    unitPlural: 'disposables',
    packSize: false,
    ratePeriod: 'week',
    bases: ['rate', 'lasts'],
  },
  other: { label: 'Other', purchase: 'purchase', unitPlural: 'items', packSize: false, ratePeriod: null, bases: ['lasts'] },
};

/** Average calendar lengths, so a month and a year include their share of long months and leap days. */
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30.4375;
export const DAYS_PER_YEAR = 365.25;

export const REDUCTION_SCENARIOS = [25, 50, 75] as const;
export const REDUCTION_STEP = 5;

export type InputField = 'price' | 'unitsPerPurchase' | 'rate' | 'lastsDays' | 'goalAmount';

type Limit = { min: number; minExclusive?: boolean; max: number; integer?: boolean };

export const FIELD_LIMITS: Record<InputField, Limit> = {
  price: { min: 0, max: 1_000_000_000 },
  unitsPerPurchase: { min: 1, max: 1000, integer: true },
  rate: { min: 0, max: 1000 },
  lastsDays: { min: 0, minExclusive: true, max: 3650 },
  goalAmount: { min: 0, minExclusive: true, max: 1_000_000_000_000 },
};

export function isValidValue(field: InputField, value: unknown): value is number {
  const limit = FIELD_LIMITS[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (limit.integer && !Number.isInteger(value)) return false;
  if (limit.minExclusive ? value <= limit.min : value < limit.min) return false;
  return value <= limit.max;
}

/** Why a value was rejected, in words a person can act on. */
export function fieldError(field: InputField, value: number): string | null {
  if (isValidValue(field, value)) return null;
  const limit = FIELD_LIMITS[field];
  if (value < 0) return 'Enter a number that isn’t negative.';
  if (limit.integer && !Number.isInteger(value)) return 'Enter a whole number.';
  if (limit.minExclusive && value <= limit.min) return `Enter a number above ${limit.min}.`;
  if (value < limit.min) return `Enter ${limit.min} or more.`;
  return `Enter ${limit.max.toLocaleString()} or less.`;
}

export type ParsedNumber = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'invalid' };

/**
 * Reads what was typed into a number field. Accepts "1234.5", "1,234.5", "1.234,5",
 * "12,50" and spaces as thousands separators. Anything else is invalid, never guessed.
 */
export function parseNumberInput(text: string): ParsedNumber {
  const trimmed = text.replace(/[\s\u00a0\u202f']/g, '');
  if (!trimmed) return { kind: 'empty' };
  if (trimmed.startsWith('-')) {
    if (trimmed.startsWith('--')) return { kind: 'invalid' };
    const rest = parseNumberInput(trimmed.slice(1));
    return rest.kind === 'number' ? { kind: 'number', value: -rest.value } : { kind: 'invalid' };
  }
  if (!/^[\d.,]+$/.test(trimmed) || !/\d/.test(trimmed)) return { kind: 'invalid' };

  const lastDot = trimmed.lastIndexOf('.');
  const lastComma = trimmed.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = trimmed.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    const parts = trimmed.split(',');
    // "1,234" or "1,234,567" are thousands; a single comma followed by 1–2 digits is a decimal.
    const thousandsOnly = parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    if (thousandsOnly && !(parts.length === 2 && parts[0] === '0')) normalized = parts.join('');
    else if (parts.length === 2) normalized = `${parts[0]}.${parts[1]}`;
    else return { kind: 'invalid' };
  } else {
    const parts = trimmed.split('.');
    if (parts.length > 2 && parts.slice(1).every((part) => part.length === 3)) normalized = parts.join('');
    else if (parts.length <= 2) normalized = trimmed;
    else return { kind: 'invalid' };
  }
  if ((normalized.match(/\./g) ?? []).length > 1) return { kind: 'invalid' };
  const value = Number(normalized.startsWith('.') ? `0${normalized}` : normalized);
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
}

export const effectiveBasis = (type: ProductType, basis: UsageBasis): UsageBasis =>
  PRODUCTS[type].bases.includes(basis) ? basis : PRODUCTS[type].bases[0];

/** Inputs the chosen product and basis need, in the order they're asked for. */
export function requiredFields(type: ProductType, basis: UsageBasis): InputField[] {
  if (effectiveBasis(type, basis) === 'lasts') return ['price', 'lastsDays'];
  return PRODUCTS[type].packSize ? ['price', 'unitsPerPurchase', 'rate'] : ['price', 'rate'];
}

export type SpendingEstimate =
  | { status: 'incomplete'; missing: InputField[] }
  /** Inputs are complete but describe no spending (a price or usage of zero). */
  | { status: 'zero' }
  | { status: 'ok'; daily: number; weekly: number; monthly: number; annual: number };

/**
 * One basis is used at a time, so the same consumption is never counted twice:
 * - lasts: daily = price ÷ days one purchase lasts
 * - rate:  daily = (price ÷ units per purchase) × units used per day
 */
export function estimateSpending(type: ProductType, inputs: ProductInputs): SpendingEstimate {
  const basis = effectiveBasis(type, inputs.basis);
  const missing = requiredFields(type, basis).filter((field) => !isValidValue(field, inputs[field as keyof ProductInputs]));
  if (missing.length) return { status: 'incomplete', missing };

  const product = PRODUCTS[type];
  let daily: number;
  if (basis === 'lasts') {
    daily = inputs.price! / inputs.lastsDays!;
  } else {
    const unitPrice = inputs.price! / (product.packSize ? inputs.unitsPerPurchase! : 1);
    const unitsPerDay = inputs.rate! / (product.ratePeriod === 'week' ? DAYS_PER_WEEK : 1);
    daily = unitPrice * unitsPerDay;
  }
  if (!Number.isFinite(daily) || daily <= 0) return { status: 'zero' };
  return { status: 'ok', daily, weekly: daily * DAYS_PER_WEEK, monthly: daily * DAYS_PER_MONTH, annual: daily * DAYS_PER_YEAR };
}

export const clampReduction = (percent: unknown): number =>
  typeof percent === 'number' && Number.isFinite(percent) ? Math.min(100, Math.max(REDUCTION_STEP, Math.round(percent))) : 50;

export type SavingsScenario = { percent: number; daily: number; weekly: number; monthly: number; annual: number };

/** Estimated spending × reduction. Assumes spending falls in step with the amount of product bought. */
export function savingsScenario(estimate: SpendingEstimate, percent: number): SavingsScenario | null {
  if (estimate.status !== 'ok') return null;
  const share = clampReduction(percent) / 100;
  return {
    percent: clampReduction(percent),
    daily: estimate.daily * share,
    weekly: estimate.weekly * share,
    monthly: estimate.monthly * share,
    annual: estimate.annual * share,
  };
}

export const MAX_GOAL_YEARS = 50;

export type GoalProjection =
  | { status: 'needsEstimate' }
  | { status: 'needsAmount' }
  | { status: 'beyondRange' }
  | { status: 'ok'; days: number };

export function projectGoal(estimate: SpendingEstimate, percent: number, goalAmount: number | null): GoalProjection {
  const scenario = savingsScenario(estimate, percent);
  if (!scenario) return { status: 'needsEstimate' };
  if (!isValidValue('goalAmount', goalAmount)) return { status: 'needsAmount' };
  const days = Math.ceil(goalAmount / scenario.daily);
  if (!Number.isFinite(days) || days > MAX_GOAL_YEARS * DAYS_PER_YEAR) return { status: 'beyondRange' };
  return { status: 'ok', days: Math.max(1, days) };
}

/** "about 3 weeks", "about 7 months", "about 2.5 years". */
export function formatDuration(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '';
  if (days <= 13) return days <= 1 ? 'about 1 day' : `about ${Math.ceil(days)} days`;
  if (days <= 8 * 7) return `about ${Math.ceil(days / DAYS_PER_WEEK)} weeks`;
  const months = Math.ceil(days / DAYS_PER_MONTH);
  if (months < 24) return `about ${months} months`;
  const years = Math.round((days / DAYS_PER_YEAR) * 10) / 10;
  return `about ${Number.isInteger(years) ? years : years.toFixed(1)} years`;
}

/** How the daily figure is worked out for the current product and basis. */
export function assumptionText(type: ProductType, basis: UsageBasis): string {
  const product = PRODUCTS[type];
  const scaling = 'Weekly = daily × 7, monthly = daily × 30.4375 (an average month), yearly = daily × 365.25.';
  if (effectiveBasis(type, basis) === 'lasts') {
    return `Daily cost = price of one ${product.purchase} ÷ days it lasts. ${scaling}`;
  }
  const per = product.ratePeriod === 'week' ? ' ÷ 7' : '';
  const unitPrice = product.packSize ? `(price of one ${product.purchase} ÷ ${product.unitPlural} in it)` : `price of one ${product.purchase}`;
  return `Daily cost = ${unitPrice} × ${product.unitPlural} per ${product.ratePeriod}${per}. ${scaling}`;
}

export function fieldLabel(type: ProductType, field: InputField): string {
  const product = PRODUCTS[type];
  switch (field) {
    case 'price':
      return `Price of one ${product.purchase}`;
    case 'unitsPerPurchase':
      return `${capitalize(product.unitPlural)} per ${product.purchase}`;
    case 'rate':
      return `${capitalize(product.unitPlural)} you use per ${product.ratePeriod ?? 'day'}`;
    case 'lastsDays':
      return `Days one ${product.purchase} lasts`;
    case 'goalAmount':
      return 'Target amount';
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------------------------------------------------------------- currency

export const CURRENCIES: readonly { code: string; name: string }[] = [
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'TWD', name: 'New Taiwan dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'VND', name: 'Vietnamese dong' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'ILS', name: 'Israeli new shekel' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'MXN', name: 'Mexican peso' },
];

const CURRENCY_CODES = new Set(CURRENCIES.map((currency) => currency.code));

const EURO_REGIONS = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', JP: 'JPY', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', KR: 'KRW', CN: 'CNY', HK: 'HKD', TW: 'TWD', SG: 'SGD', MY: 'MYR', TH: 'THB',
  PH: 'PHP', ID: 'IDR', VN: 'VND', IN: 'INR', AE: 'AED', SA: 'SAR', IL: 'ILS', TR: 'TRY', ZA: 'ZAR', BR: 'BRL', MX: 'MXN',
  ...Object.fromEntries(EURO_REGIONS.map((region) => [region, 'EUR'])),
};

export const isSupportedCurrency = (code: unknown): code is string => typeof code === 'string' && CURRENCY_CODES.has(code);

/** A starting suggestion from the device region; the user can change it. */
export function currencyForLocale(locale: string | undefined): string {
  const region = locale
    ?.split(/[-_]/)
    .slice(1)
    .find((part) => /^[A-Z]{2}$/.test(part));
  return (region && REGION_CURRENCY[region]) || 'USD';
}

export function deviceCurrency(): string {
  try {
    return currencyForLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'USD';
  }
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Locale-aware currency text; never "NaN" — invalid amounts read as an em dash. */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  if (!Number.isFinite(amount)) return '—';
  const key = `${locale ?? ''}|${currency}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
    moneyFormatters.set(key, formatter);
  }
  return formatter.format(amount);
}

// ---------------------------------------------------------------- persistence

const EMPTY_PRODUCT = (type: ProductType): ProductInputs => ({
  price: null,
  unitsPerPurchase: null,
  basis: PRODUCTS[type].bases[0],
  rate: null,
  lastsDays: null,
});

export function defaultSavings(currency = 'USD'): SavingsSettings {
  return {
    productType: 'cigarettes',
    currency,
    products: {
      cigarettes: EMPTY_PRODUCT('cigarettes'),
      vapePods: EMPTY_PRODUCT('vapePods'),
      disposables: EMPTY_PRODUCT('disposables'),
      other: EMPTY_PRODUCT('other'),
    },
    reductionPercent: 50,
    goalName: '',
    goalAmount: null,
  };
}

export const MAX_GOAL_NAME = 40;

const validOrNull = (field: InputField, value: unknown) => (isValidValue(field, value) ? value : null);

function sanitizeProduct(type: ProductType, raw: unknown): ProductInputs {
  if (!raw || typeof raw !== 'object') return EMPTY_PRODUCT(type);
  const value = raw as Record<string, unknown>;
  const basis = value.basis === 'rate' || value.basis === 'lasts' ? value.basis : PRODUCTS[type].bases[0];
  return withUnknownFields(raw, {
    price: validOrNull('price', value.price),
    unitsPerPurchase: validOrNull('unitsPerPurchase', value.unitsPerPurchase),
    basis: effectiveBasis(type, basis),
    rate: validOrNull('rate', value.rate),
    lastsDays: validOrNull('lastsDays', value.lastsDays),
  });
}

/** Restores saved calculator settings, replacing anything missing or invalid with an empty value. */
export function sanitizeSavings(raw: unknown, fallbackCurrency = 'USD'): SavingsSettings {
  const defaults = defaultSavings(isSupportedCurrency(fallbackCurrency) ? fallbackCurrency : 'USD');
  if (!raw || typeof raw !== 'object') return defaults;
  const value = raw as Record<string, unknown>;
  const products = (value.products && typeof value.products === 'object' ? value.products : {}) as Record<string, unknown>;
  return withUnknownFields(raw, {
    productType: (PRODUCT_TYPES as readonly unknown[]).includes(value.productType) ? (value.productType as ProductType) : defaults.productType,
    currency: isSupportedCurrency(value.currency) ? value.currency : defaults.currency,
    products: withUnknownFields(products, {
      cigarettes: sanitizeProduct('cigarettes', products.cigarettes),
      vapePods: sanitizeProduct('vapePods', products.vapePods),
      disposables: sanitizeProduct('disposables', products.disposables),
      other: sanitizeProduct('other', products.other),
    }),
    reductionPercent: clampReduction(value.reductionPercent),
    goalName: typeof value.goalName === 'string' ? value.goalName.slice(0, MAX_GOAL_NAME) : '',
    goalAmount: validOrNull('goalAmount', value.goalAmount),
  });
}
