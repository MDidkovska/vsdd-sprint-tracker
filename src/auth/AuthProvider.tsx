/**
 * Auth context + provider (Phase 8).
 *
 * Loads the current principal on mount (`getMe`) and exposes the auth phase and
 * actions to the screens. The phase drives which screen the {@link AuthGate}
 * renders: loading, anonymous (login/register), authenticated (with an account
 * status), or expired (session lost mid-use).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CurrentUser } from '../api/repository';
import type {
  AuthClient,
  LoginInput,
  RegisterInput,
  RegistrationAccepted,
} from './authClient';

export type AuthPhase = 'loading' | 'anonymous' | 'authenticated' | 'expired' | 'error';

export interface AuthContextValue {
  phase: AuthPhase;
  user: CurrentUser | null;
  client: AuthClient;
  /** Set when the backend could not be reached (phase === 'error'). */
  connectionError: string | null;
  login: (input: LoginInput) => Promise<CurrentUser>;
  register: (input: RegisterInput) => Promise<RegistrationAccepted>;
  logout: () => Promise<void>;
  /** Re-read /me; marks the session expired if it was lost. */
  refresh: () => Promise<void>;
  /** Return from the expired screen to the sign-in screen. */
  resetToSignIn: () => void;
  /** Retry the initial connection after a backend error. */
  retryConnection: () => void;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  client,
  children,
}: {
  client: AuthClient;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const hadUser = useRef(false);
  const [attempt, setAttempt] = useState(0);

  const applyUser = useCallback((next: CurrentUser | null) => {
    if (next) {
      hadUser.current = true;
      setUser(next);
      setPhase('authenticated');
    } else if (hadUser.current) {
      setUser(null);
      setPhase('expired');
    } else {
      setUser(null);
      setPhase('anonymous');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setConnectionError(null);
    // getMe resolves to null on 401 (anonymous) and REJECTS on a connection /
    // server error — we surface the latter as an explicit error state rather
    // than silently falling back to an anonymous or mock experience.
    client
      .getMe()
      .then((me) => {
        if (!cancelled) applyUser(me);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setUser(null);
        setConnectionError(
          err instanceof Error ? err.message : 'Could not reach the server.',
        );
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client, applyUser, attempt]);

  const login = useCallback(
    async (input: LoginInput) => {
      const principal = await client.login(input);
      applyUser(principal);
      return principal;
    },
    [client, applyUser],
  );

  const register = useCallback((input: RegisterInput) => client.register(input), [client]);

  const logout = useCallback(async () => {
    await client.logout();
    hadUser.current = false;
    setUser(null);
    setPhase('anonymous');
  }, [client]);

  const refresh = useCallback(async () => {
    const me = await client.getMe().catch(() => null);
    applyUser(me);
  }, [client, applyUser]);

  const resetToSignIn = useCallback(() => {
    hadUser.current = false;
    setUser(null);
    setPhase('anonymous');
  }, []);

  const retryConnection = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      phase,
      user,
      client,
      connectionError,
      login,
      register,
      logout,
      refresh,
      resetToSignIn,
      retryConnection,
    }),
    [
      phase,
      user,
      client,
      connectionError,
      login,
      register,
      logout,
      refresh,
      resetToSignIn,
      retryConnection,
    ],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
