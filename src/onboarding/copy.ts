import { ConsumptionProduct } from './model';

export const ONBOARDING_PRODUCT_TITLE = 'What do you usually use?';
export const ONBOARDING_PRODUCT_HINT = 'This only personalizes your plan. It is not a medical assessment.';

export const PRODUCT_LABEL: Record<ConsumptionProduct, string> = {
  cigarettes: 'Cigarettes',
  vape: 'Vape / pods',
  disposable: 'Disposable vapes',
  other: 'Something else',
};

export const ONBOARDING_ESTIMATE_TITLE = 'About how many per day?';
export const ONBOARDING_ESTIMATE_HINT = 'Your best estimate is fine. You can change this later in Your Plan.';

export const ONBOARDING_GOAL_TITLE = 'What would you like to work toward?';
export const ONBOARDING_REDUCE_LABEL = 'Cut down';
export const ONBOARDING_REDUCE_DESC = 'Lower your daily target week by week.';
export const ONBOARDING_QUIT_LABEL = 'Work toward quitting';
export const ONBOARDING_QUIT_DESC = 'Step the target down until it reaches zero.';

export const ONBOARDING_PACE_TITLE = 'How quickly should the target change?';

export const ONBOARDING_DEMO_TITLE = 'Here’s how logging feels';
export const ONBOARDING_DEMO_HINT = 'An example only — nothing is saved yet.';
export const ONBOARDING_DEMO_SKIP = 'Skip example';
export const ONBOARDING_DEMO_CONTINUE = 'Continue';

export const ONBOARDING_PREVIEW_TITLE = 'Your personalized plan';
export const ONBOARDING_PREVIEW_CAVEAT = 'Targets are examples you can adjust anytime. Not medical advice.';
export const ONBOARDING_PREVIEW_CTA = 'Continue to Puphii Pro';

export const ONBOARDING_BACK = 'Back';
