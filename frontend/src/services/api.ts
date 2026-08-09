import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Configurable so the app is not pinned to a hardcoded localhost backend
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Where API-key holders call. Exported so the settings screen can show the real
// URL for this deployment rather than a hardcoded example.
export const PUBLIC_API_URL = `${API_BASE_URL.replace(/\/+$/, '')}/v1`;

const API = axios.create({
  baseURL: API_BASE_URL,
});

API.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// A rejected token means the session is over - clear it so the app redirects
// to login instead of looping on failed requests.
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const { token, logout } = useAuthStore.getState();
      if (token) logout();
    }
    return Promise.reject(error);
  }
);

// Pulls the human-readable message out of an axios error, whatever shape it has
export function apiError(err: any, fallback = 'Something went wrong') {
  return err?.response?.data?.error || err?.message || fallback;
}

export interface OrgRegistrationPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  jobTitle?: string;
  companyName: string;
  website?: string;
  industry?: string;
  headquarters?: string;
  description?: string;
  capabilities: string[];
  capabilityNotes?: string;
  valuePropositions?: string[];
  differentiators?: string[];
  proofPoints?: string[];
  targetIndustries?: string[];
  targetDepartments?: string[];
  targetRoles?: string[];
  domains?: string[];
}

export interface EmployeeSignupPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  jobTitle?: string;
}

/** The employee profile. Report targeting lives on the company profile. */
export interface ProfileUpdatePayload {
  firstName?: string;
  lastName?: string;
}

export interface DemoRequestPayload {
  email: string;
  phone: string;
  fullName?: string;
  companyName?: string;
  notes?: string;
}

export const authAPI = {
  registerOrganization: (data: OrgRegistrationPayload) =>
    API.post('/auth/register-organization', data),
  register: (data: EmployeeSignupPayload) => API.post('/auth/register', data),
  lookupDomain: (email: string) =>
    API.get('/auth/organization-by-domain', { params: { email } }),
  // Which of the three login-screen doors this address gets: 'ready',
  // 'no_account' or 'not_registered'
  checkEmail: (email: string) => API.get('/auth/check-email', { params: { email } }),
  login: (email: string, password: string) => API.post('/auth/login', { email, password }),
  requestDemo: (data: DemoRequestPayload) => API.post('/auth/demo-request', data),
  getMe: () => API.get('/auth/me'),
  updateProfile: (data: ProfileUpdatePayload) => API.patch('/auth/profile', data),
  changePassword: (currentPassword: string, newPassword: string) =>
    API.post('/auth/change-password', { currentPassword, newPassword }),
};

export interface NewMemberPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  jobTitle?: string;
  role?: 'admin' | 'member';
}

export interface MemberUpdatePayload {
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  role?: 'admin' | 'member';
  emailAlerts?: boolean;
  password?: string;
}

export const organizationsAPI = {
  get: () => API.get('/organizations/me'),
  update: (data: any) => API.patch('/organizations/me', data),
  members: (params?: { q?: string }) => API.get('/organizations/members', { params }),
  addMember: (data: NewMemberPayload) => API.post('/organizations/members', data),
  updateMember: (id: string, data: MemberUpdatePayload) =>
    API.patch(`/organizations/members/${id}`, data),
  removeMember: (id: string) => API.delete(`/organizations/members/${id}`),
  setRole: (id: string, role: string) => API.patch(`/organizations/members/${id}/role`, { role }),
};

export interface CrmCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginUrl?: string;    // salesforce
  accountsUrl?: string; // zoho
}

export const integrationsAPI = {
  get: () => API.get('/integrations'),
  connect: (provider: string, credentials: CrmCredentials) =>
    API.post(`/integrations/${provider}/connect`, credentials),
  test: (provider: string) => API.post(`/integrations/${provider}/test`),
  // Kicks off a background sync of every watched account
  sync: (provider: string) => API.post(`/integrations/${provider}/sync`),
  syncCompany: (provider: string, companyId: string) =>
    API.post(`/integrations/${provider}/sync/${companyId}`),
  update: (
    provider: string,
    data: { usage?: { reports?: boolean; signals?: boolean; score?: boolean }; freshnessHours?: number }
  ) => API.patch(`/integrations/${provider}`, data),
  disconnect: (provider: string) => API.delete(`/integrations/${provider}`),
  record: (companyId: string) => API.get(`/integrations/records/${companyId}`),
};

export const apiKeysAPI = {
  list: () => API.get('/api-keys'),
  // The plaintext key is in this response and nowhere else
  create: (name: string) => API.post('/api-keys', { name }),
  rename: (id: string, name: string) => API.patch(`/api-keys/${id}`, { name }),
  revoke: (id: string) => API.delete(`/api-keys/${id}`),
};

export const companiesAPI = {
  search: (q: string) => API.get('/companies/search', { params: { q } }),
  getWatchlist: () => API.get('/companies'),
  addCompany: (payload: {
    name: string;
    ticker?: string;
    notes?: string;
    // The Wikidata entity and homepage behind the picked suggestion, so the
    // server enriches that exact company instead of searching its name again
    wikidataId?: string;
    website?: string;
    generateReport?: boolean;
  }) => API.post('/companies', payload),
  getCompany: (id: string) => API.get(`/companies/${id}`),
  removeCompany: (id: string) => API.delete(`/companies/${id}`),
  refreshData: (id: string) => API.post(`/companies/${id}/refresh`),
};

// The pages a crawl reads directly. Each is optional and none is ever guessed:
// a wrong careers URL yields another company's headcount.
export interface AccountPages {
  careersUrl?: string;
  investorRelationsUrl?: string;
  pressUrl?: string;
  blogRssUrl?: string;
  linkedInPeopleUrl?: string;
  indeedUrl?: string;
}

// Which of the vertical, regulator, patent and contract crawls run for this
// account. Guessed from the industry on add, corrected here.
export interface AccountTags {
  vertical?: string;
  regulated?: boolean;
  governmentFacing?: boolean;
  rndHeavy?: boolean;
  autoTagged?: boolean;
}

export const accountsAPI = {
  // Search runs server-side, like every other list in the API
  getAccounts: (params?: { q?: string }) => API.get('/accounts', { params }),
  update: (
    companyId: string,
    data: { notes?: string; pages?: AccountPages; tags?: AccountTags }
  ) => API.patch(`/accounts/${companyId}`, data),
  // Served by the API so the client never hard-codes a vertical list that can
  // drift from the one the crawler actually understands
  getVerticals: () => API.get('/accounts/meta/verticals'),
};

export const signalsAPI = {
  getSignals: (days?: number, type?: string) => API.get('/signals', { params: { days, type } }),
  getSignalsByCategory: (category: string, days?: number) =>
    API.get(`/signals/categories/${category}`, { params: { days } }),
  markAsRead: (id: string) => API.patch(`/signals/${id}/read`),
  getStats: () => API.get('/signals/stats/by-category'),
};

/** One replayed turn of an "ask anything" thread. */
export interface AskTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskAnswer {
  answer: string;
  /** Source numbers the answer cited, in first-mention order. */
  citations: number[];
  model?: string;
}

export const reportsAPI = {
  generate: (companyId: string) => API.post(`/reports/${companyId}`),
  // Filtering happens server-side so it covers the whole history, not just the
  // page the browser happens to be holding. Blank/`all` values are omitted.
  getReports: (params?: { q?: string; author?: string; industry?: string }) =>
    API.get('/reports', { params }),
  getReportFilters: () => API.get('/reports/filters'),
  getReport: (id: string) => API.get(`/reports/${id}`),
  // "Ask anything" — answered from the stored report alone. The thread is not
  // persisted server-side, so the prior turns are replayed with each question.
  ask: (id: string, question: string, history?: AskTurn[]) =>
    API.post<AskAnswer>(`/reports/${id}/ask`, { question, history }),
  remove: (id: string) => API.delete(`/reports/${id}`),
  // The response is a PDF, so it must be read as a blob rather than parsed
  download: (id: string) => API.get(`/reports/${id}/download`, { responseType: 'blob' }),
};

export const alertsAPI = {
  getAlerts: () => API.get('/alerts'),
  createAlert: (data: any) => API.post('/alerts', data),
  toggleAlert: (id: string) => API.patch(`/alerts/${id}/toggle`),
  deleteAlert: (id: string) => API.delete(`/alerts/${id}`),
};

export const inboxAPI = {
  getMessages: (archived?: boolean) => API.get('/inbox', { params: { archived } }),
  markAsRead: (id: string) => API.patch(`/inbox/${id}/read`),
  archive: (id: string) => API.patch(`/inbox/${id}/archive`),
  unreadCount: () => API.get('/inbox/unread-count'),
};

/** Triggers a browser download for a generated PDF. */
export async function downloadReportPdf(reportId: string, fileName: string) {
  const res = await reportsAPI.download(reportId);
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default API;
