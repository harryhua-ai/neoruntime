import { create } from 'zustand';
import { getItem, setItem, removeItem } from '@/utils/storage';

interface AuthState {
  isValidateToken: boolean;
}

interface AuthActions {
  setToken: (token: string) => void;
  clearToken: () => void;
}

type AuthStore = AuthState & AuthActions;

export const enableAuth = import.meta.env.VITE_ENABLE_AUTH === 'true';

export function hasValidAuthToken(): boolean {
  if (!enableAuth) return true;
  const token = getItem('token');
  if (!token) return false;
  const lastRequestTime = Number(getItem('lastRequestTime')) || 0;
  const timeout = Number(import.meta.env.VITE_LOGIN_TIMEOUT) || 3600000;
  return Date.now() - lastRequestTime < timeout;
}

export function isLoginPath(pathname: string): boolean {
  return pathname === '/login';
}

export function shouldRedirectToLogin(pathname: string): boolean {
  return enableAuth && !isLoginPath(pathname) && !hasValidAuthToken();
}

export function redirectToLoginBeforeRender(): void {
  if (typeof window === 'undefined') return;
  if (!shouldRedirectToLogin(window.location.pathname)) return;
  window.history.replaceState(null, '', '/login');
}
export async function validateAuthSession(): Promise<boolean> {
  if (!hasValidAuthToken()) return false;

  const token = getItem<string>('token');
  if (!token) return false;

  try {
    const response = await fetch('/api/v1/system/info', {
      headers: { Authorization: token },
      cache: 'no-store',
    });

    if (response.status === 401 || response.status === 403) {
      clearAuthToken();
      return false;
    }

    return true;
  } catch {
    return true;
  }
}

export const useAuthStore = create<AuthStore>(set => ({
  isValidateToken: hasValidAuthToken(),

  setToken: (token: string) => {
    setItem('token', token);
    setItem('lastRequestTime', Date.now());
    set({ isValidateToken: true });
  },

  clearToken: () => {
    removeItem('token');
    removeItem('lastRequestTime');
    removeItem('username');
    set({ isValidateToken: !enableAuth });
  },
}));

export const clearAuthToken = () => {
  removeItem('token');
  removeItem('lastRequestTime');
  useAuthStore.setState({ isValidateToken: !enableAuth });
};

export const authStore = useAuthStore.getState;
