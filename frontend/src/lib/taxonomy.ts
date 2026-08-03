// Suggestion lists used across signup, onboarding and settings. These are only
// prompts - every field accepts free text, because no fixed taxonomy survives
// contact with real sellers.

export const VERTICALS = [
  'Banking & Financial Services',
  'Insurance',
  'Healthcare & Life Sciences',
  'Retail & Consumer Goods',
  'Manufacturing & Industrial',
  'Travel, Transport & Logistics',
  'Telecom, Media & Entertainment',
  'Energy & Utilities',
  'Technology & Software',
  'Professional Services',
  'Public Sector',
];

export const COMPANY_CAPABILITY_SUGGESTIONS = [
  'Business process management',
  'Intelligent automation',
  'Data & analytics',
  'AI/ML engineering',
  'Cloud modernisation',
  'Customer experience',
  'Finance & accounting',
  'Risk & compliance',
  'Digital transformation consulting',
  'Managed services',
];

// Vertical-specific capability prompts: what a rep actually sells INTO an
// account, which is narrower than what the company as a whole can deliver.
export const VERTICAL_CAPABILITY_SUGGESTIONS: Record<string, string[]> = {
  'Banking & Financial Services': [
    'KYC/AML automation',
    'Trade finance operations',
    'Credit risk analytics',
    'Regulatory reporting',
    'Wealth & client onboarding',
    'Payments reconciliation',
    'Core banking modernisation',
  ],
  Insurance: [
    'Claims processing automation',
    'Underwriting support',
    'Policy administration',
    'Actuarial & finance data',
    'Post-merger integration',
    'Fraud analytics',
  ],
  'Healthcare & Life Sciences': [
    'Revenue cycle management',
    'Clinical data management',
    'Pharmacovigilance',
    'Regulatory submissions',
    'Patient engagement',
  ],
  'Retail & Consumer Goods': [
    'Demand forecasting',
    'Supply chain analytics',
    'Merchandising operations',
    'Customer service automation',
    'Pricing optimisation',
  ],
  'Technology & Software': [
    'Engineering productivity',
    'Platform reliability',
    'Developer tooling',
    'Product analytics',
    'Technical support operations',
  ],
  'Manufacturing & Industrial': [
    'Procurement operations',
    'Supply chain planning',
    'Quality analytics',
    'Aftermarket service',
  ],
};

// The pitch themes a rep leads with. This is the primary lens the report is
// written through, so the examples deliberately look like real pitches.
export const KEYWORD_SUGGESTIONS = [
  'GenAI solutions',
  'Copilot solutions',
  'Agentic AI',
  'Intelligent document processing',
  'Data modernisation',
  'Cloud migration',
  'Process automation',
  'Cost optimisation',
  'Customer experience transformation',
  'Compliance automation',
];

export const DEPARTMENT_SUGGESTIONS = [
  'Technology / IT',
  'Data & Analytics',
  'Operations',
  'Finance',
  'Risk & Compliance',
  'Customer Service',
  'Procurement',
  'Human Resources',
  'Marketing',
];

export const ROLE_SUGGESTIONS = [
  'CIO',
  'CTO',
  'CDO',
  'COO',
  'CFO',
  'Head of Transformation',
  'Head of Data',
  'VP Engineering',
  'Head of Operations',
];

export function capabilitySuggestionsFor(vertical?: string) {
  if (vertical && VERTICAL_CAPABILITY_SUGGESTIONS[vertical]) {
    return VERTICAL_CAPABILITY_SUGGESTIONS[vertical];
  }
  return COMPANY_CAPABILITY_SUGGESTIONS;
}
