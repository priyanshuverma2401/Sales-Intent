import { create } from 'zustand';

export interface UserProfile {
  vertical?: string;
  verticalCapabilities?: string[];
  keywords?: string[];
  targetDepartments?: string[];
  targetRoles?: string[];
  region?: string;
  completedOnboarding?: boolean;
}

export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  jobTitle?: string;
  role: 'owner' | 'admin' | 'member';
  organizationId?: string;
  profile?: UserProfile;
  watchlist?: any[];
}

export interface Organization {
  _id: string;
  name: string;
  domains: string[];
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
  subscription?: {
    plan: string;
    seats: number;
    status: string;
    renewsAt?: string;
  };
  seatsUsed?: number;
  seatsRemaining?: number;
}

interface AuthState {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  // True until the stored token has been checked against the API. Without this
  // the app treated "not loaded yet" as "not logged in" and bounced every
  // refresh to the login page.
  isBootstrapping: boolean;
  error: string | null;
  setSession: (payload: { token?: string; user: User; organization?: Organization | null }) => void;
  setUser: (user: User | null) => void;
  setOrganization: (organization: Organization | null) => void;
  setToken: (token: string | null) => void;
  setBootstrapping: (value: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
}

const storedToken = localStorage.getItem('token');

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  organization: null,
  token: storedToken,
  isBootstrapping: Boolean(storedToken),
  error: null,

  setSession: ({ token, user, organization }) => {
    if (token) localStorage.setItem('token', token);
    set((state) => ({
      token: token ?? state.token,
      user,
      organization: organization !== undefined ? organization : state.organization,
      error: null,
    }));
  },

  setUser: (user) => set({ user }),
  setOrganization: (organization) => set({ organization }),

  setToken: (token) => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    set({ token });
  },

  setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
  setError: (error) => set({ error }),

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, organization: null, token: null, isBootstrapping: false });
  },
}));

/** True when the rep has not yet told us enough for reports to be targeted. */
export function needsOnboarding(user: User | null) {
  if (!user) return false;
  const p = user.profile;
  return !(p?.vertical && p?.verticalCapabilities?.length && p?.keywords?.length);
}
