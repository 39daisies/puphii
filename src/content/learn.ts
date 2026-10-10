export type Source = { label: string; url: string };

export type LearnTopic = {
  id: string;
  title: string;
  summary: string;
  points: string[];
  sources: Source[];
};

const CDC_VAPING: Source = {
  label: 'CDC: Health Effects of Vaping',
  url: 'https://www.cdc.gov/tobacco/e-cigarettes/health-effects.html',
};
const CDC_SMOKING: Source = {
  label: 'CDC: Cigarette Smoking',
  url: 'https://www.cdc.gov/tobacco/about/index.html',
};
const CDC_QUITTING: Source = {
  label: 'CDC: Benefits of Quitting Smoking',
  url: 'https://www.cdc.gov/tobacco/about/benefits-of-quitting.html',
};
const SMOKEFREE_CRAVINGS: Source = {
  label: 'Smokefree.gov: Cravings & Triggers',
  url: 'https://smokefree.gov/challenges-when-quitting/cravings-triggers',
};
const NHS_QUIT: Source = {
  label: 'NHS Better Health: Quit smoking',
  url: 'https://www.nhs.uk/better-health/quit-smoking/',
};

/**
 * Every statement paraphrases the linked public-health source. Keep content
 * general: no personal risk estimates, diagnoses, or outcome predictions.
 */
export const LEARN_TOPICS: LearnTopic[] = [
  {
    id: 'aerosol',
    title: "What's in vape aerosol?",
    summary: 'Vape aerosol is not just water vapor.',
    points: [
      'Most e-cigarettes contain nicotine, which is highly addictive.',
      'Aerosol can also contain cancer-causing chemicals, heavy metals such as nickel, tin and lead, volatile organic compounds, and tiny particles that can be inhaled deep into the lungs.',
      'Some flavorings, such as diacetyl, are linked to serious lung disease. A flavoring that is safe to eat is not necessarily safe to inhale.',
      'Vape aerosol generally contains fewer harmful chemicals than cigarette smoke, but that does not make it safe.',
    ],
    sources: [CDC_VAPING],
  },
  {
    id: 'nicotine',
    title: 'Nicotine and your brain',
    summary: 'Why nicotine is hard to put down.',
    points: [
      'With repeated use, the brain gets used to nicotine. This can make someone feel they need it just to feel okay.',
      'Signs of nicotine addiction include cravings, being unable to stop, and needing more to feel the same.',
      'The brain keeps developing until about age 25. Nicotine during adolescence can affect attention, learning, mood and impulse control.',
      'Withdrawal can bring irritability, low mood, poor sleep and cravings. These symptoms are temporary and fade as the brain adjusts.',
    ],
    sources: [CDC_VAPING],
  },
  {
    id: 'smoking',
    title: 'How smoking affects the body',
    summary: 'Smoking harms nearly every organ of the body.',
    points: [
      'Cigarette smoking causes cancer, heart disease, stroke, lung diseases such as COPD, and type 2 diabetes.',
      'It is the leading preventable cause of disease, death and disability in the United States.',
      'Secondhand smoke is also harmful to the people around you, including children.',
    ],
    sources: [CDC_SMOKING],
  },
  {
    id: 'quitting',
    title: 'What changes when you quit',
    summary: 'Quitting helps at any age, no matter how long you have smoked.',
    points: [
      'Soon after quitting, heart rate drops. Within 24 hours, the nicotine level in the blood drops to zero.',
      'Within 1 to 12 months, coughing and shortness of breath decrease.',
      'Within 1 to 2 years, the risk of heart attack drops sharply. Risks of many cancers keep falling over the following years.',
      'Quitting can add as much as 10 years to life expectancy.',
      'These are general findings about people who stop smoking cigarettes. They are not a prediction for any one person.',
    ],
    sources: [CDC_QUITTING],
  },
  {
    id: 'cravings',
    title: 'Cravings and triggers',
    summary: 'Cravings are normal, and they pass.',
    points: [
      'Triggers such as stress, coffee or alcohol can bring on a craving, even long after quitting.',
      'Knowing your own triggers lets you make a plan for getting past them.',
      'Exercise or other distractions can keep you busy until a craving passes.',
      'Logging in Puphii can help you notice when and where your puffs happen.',
    ],
    sources: [SMOKEFREE_CRAVINGS],
  },
  {
    id: 'support',
    title: 'Getting support',
    summary: "You don't have to do it alone.",
    points: [
      'Treatments, including counseling and medication, can help people quit smoking.',
      'Free support services are available in many countries. A doctor, pharmacist or local stop-smoking service can help you choose an approach.',
      'The NHS notes that people who reach 28 days smoke-free are 5 times more likely to quit for good.',
    ],
    sources: [CDC_SMOKING, NHS_QUIT],
  },
];
