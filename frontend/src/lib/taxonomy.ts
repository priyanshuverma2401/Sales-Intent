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

// --- Company profile monitoring rules --------------------------------------

// The seniority buckets an admin tracks. Keywords narrow each one, so "Director"
// only matters when it is a Director of something the company sells to.
export const CONTACT_TITLE_SUGGESTIONS = [
  'C-Suite',
  'Vice President',
  'Head',
  'Director',
  'Senior Director',
  'Manager',
];

export const TITLE_KEYWORD_SUGGESTIONS = [
  'AI',
  'Automation',
  'Compliance',
  'Corporate Development',
  'Digital',
  'Finance',
  'HR',
  'IT',
  'Marketing',
  'Operations',
  'Procurement',
  'Product',
  'Sourcing',
  'Strategy',
  'Technology',
  'Transformation',
];

export const TOPIC_SUGGESTIONS = [
  'AI',
  'AI transformation',
  'AI investments',
  'Automation',
  'Cost reduction',
  'Digital transformation',
  'ESG',
  'Layoffs',
  'Mergers & acquisitions',
  'Outsourcing',
  'Regulatory change',
  'Shared services',
];

// Catalogue behind the technology search box. Free text is still accepted, so
// this is a shortcut, not a whitelist.
export const TECHNOLOGY_CATALOG: { name: string; description: string }[] = [
  { name: 'Salesforce Platform', description: 'CRM and application platform for sales, service and marketing teams.' },
  { name: 'SAP S/4HANA Cloud', description: 'SAP’s in-memory ERP suite for finance, supply chain and manufacturing.' },
  { name: 'Oracle Cloud ERP', description: 'Oracle’s cloud suite for financials, procurement and project management.' },
  { name: 'Microsoft Dynamics 365', description: 'Microsoft’s CRM and ERP applications built on Power Platform.' },
  { name: 'Microsoft Azure', description: 'Microsoft’s public cloud for compute, data and AI services.' },
  { name: 'Amazon Web Services', description: 'AWS public cloud for compute, storage, data and machine learning.' },
  { name: 'Google Cloud Platform', description: 'Google’s cloud for infrastructure, data warehousing and AI.' },
  { name: 'Snowflake', description: 'Cloud data platform for warehousing, sharing and analytics workloads.' },
  { name: 'Databricks', description: 'Lakehouse platform for data engineering, analytics and ML.' },
  { name: 'Google BigQuery', description: 'Serverless data warehouse for large-scale SQL analytics.' },
  { name: 'ServiceNow', description: 'Workflow platform for IT, HR and customer service operations.' },
  { name: 'Pega Platform', description: 'Low-code platform for case management and process automation.' },
  { name: 'Appian', description: 'Low-code process automation and case management platform.' },
  { name: 'UiPath', description: 'Robotic process automation platform for back-office workflows.' },
  { name: 'Automation Anywhere', description: 'Cloud-native RPA and intelligent automation platform.' },
  { name: 'Blue Prism', description: 'Enterprise RPA platform for rules-based process execution.' },
  { name: 'Workday', description: 'Cloud HCM and financial management suite.' },
  { name: 'Kafka', description: 'Distributed event streaming platform for real-time data pipelines.' },
  { name: 'Tableau', description: 'Visual analytics and business intelligence platform.' },
  { name: 'Power BI', description: 'Microsoft’s business intelligence and reporting service.' },
  { name: 'Google Analytics', description: 'Web and product analytics for traffic and conversion reporting.' },
  { name: 'Genesys Cloud', description: 'Cloud contact centre platform for omnichannel customer service.' },
  { name: 'NICE CXone', description: 'Cloud contact centre and workforce optimisation suite.' },
  { name: 'Twilio', description: 'APIs for programmable messaging, voice and customer engagement.' },
  { name: 'Zendesk', description: 'Customer service ticketing and support platform.' },
  { name: 'HubSpot', description: 'CRM with marketing, sales and service automation.' },
  { name: 'Adobe Experience Cloud', description: 'Marketing, analytics and content management applications.' },
  { name: 'Guidewire', description: 'Core insurance platform for policy, billing and claims.' },
  { name: 'Duck Creek', description: 'Insurance core systems for policy administration and claims.' },
  { name: 'Temenos', description: 'Core banking and digital banking software.' },
  { name: 'FIS', description: 'Banking, payments and capital markets technology.' },
  { name: 'Coupa', description: 'Business spend management for procurement and invoicing.' },
  { name: 'Ariba', description: 'SAP’s procurement network for sourcing and supplier management.' },
  { name: 'Epic Systems', description: 'Electronic health record platform for hospitals and health systems.' },
  { name: 'Kubernetes', description: 'Container orchestration for deploying and scaling services.' },
  { name: 'Terraform', description: 'Infrastructure-as-code tool for provisioning cloud resources.' },
  { name: 'Python', description: 'General-purpose language widely used for data and ML work.' },
  { name: 'OpenAI', description: 'Foundation models and APIs used for generative AI applications.' },
  { name: 'Anthropic Claude', description: 'Frontier models and APIs used for generative AI applications.' },
];

export function capabilitySuggestionsFor(vertical?: string) {
  if (vertical && VERTICAL_CAPABILITY_SUGGESTIONS[vertical]) {
    return VERTICAL_CAPABILITY_SUGGESTIONS[vertical];
  }
  return COMPANY_CAPABILITY_SUGGESTIONS;
}
