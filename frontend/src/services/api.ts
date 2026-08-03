import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Configurable so the app is not pinned to a hardcoded localhost backend
const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
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
  vertical: string;
  verticalCapabilities: string[];
  keywords: string[];
  targetDepartments?: string[];
  targetRoles?: string[];
  region?: string;
}

export const authAPI = {
  registerOrganization: (data: OrgRegistrationPayload) =>
    API.post('/auth/register-organization', data),
  register: (data: EmployeeSignupPayload) => API.post('/auth/register', data),
  lookupDomain: (email: string) =>
    API.get('/auth/organization-by-domain', { params: { email } }),
  login: (email: string, password: string) => API.post('/auth/login', { email, password }),
  getMe: () => API.get('/auth/me'),
  updateProfile: (data: Partial<EmployeeSignupPayload>) => API.patch('/auth/profile', data),
};

export const organizationsAPI = {
  get: () => API.get('/organizations/me'),
  update: (data: any) => API.patch('/organizations/me', data),
  members: () => API.get('/organizations/members'),
  setRole: (id: string, role: string) => API.patch(`/organizations/members/${id}/role`, { role }),
};

export const companiesAPI = {
  search: (q: string) => API.get('/companies/search', { params: { q } }),
  getWatchlist: () => API.get('/companies'),
  addCompany: (payload: {
    name: string;
    ticker?: string;
    keywords?: string[];
    notes?: string;
    generateReport?: boolean;
  }) => API.post('/companies', payload),
  getCompany: (id: string) => API.get(`/companies/${id}`),
  removeCompany: (id: string) => API.delete(`/companies/${id}`),
  refreshData: (id: string) => API.post(`/companies/${id}/refresh`),
};

export const accountsAPI = {
  getAccounts: () => API.get('/accounts'),
  update: (companyId: string, data: { keywords?: string[]; notes?: string }) =>
    API.patch(`/accounts/${companyId}`, data),
};

export const signalsAPI = {
  getSignals: (days?: number, type?: string) => API.get('/signals', { params: { days, type } }),
  getSignalsByCategory: (category: string, days?: number) =>
    API.get(`/signals/categories/${category}`, { params: { days } }),
  markAsRead: (id: string) => API.patch(`/signals/${id}/read`),
  getStats: () => API.get('/signals/stats/by-category'),
};

export const reportsAPI = {
  generate: (companyId: string) => API.post(`/reports/${companyId}`),
  getReports: () => API.get('/reports'),
  getReport: (id: string) => API.get(`/reports/${id}`),
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
