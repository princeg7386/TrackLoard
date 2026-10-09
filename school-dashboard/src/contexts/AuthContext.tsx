'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthUserPayload } from '@school-bus/shared';
import { AuthService } from '../services/auth.service';

interface AuthContextType {
  user: AuthUserPayload | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserPayload | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadSession = async () => {
    if (typeof window === 'undefined') return;

    const storedToken = localStorage.getItem('sb_auth_token');
    if (!storedToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    setToken(storedToken);

    try {
      const profile = await AuthService.getMe();
      setUser(profile);
    } catch {
      // Token invalid or expired
      localStorage.removeItem('sb_auth_token');
      localStorage.removeItem('sb_user_id');
      localStorage.removeItem('sb_user_name');
      localStorage.removeItem('sb_user_email');
      localStorage.removeItem('sb_user_role');
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSession();
  }, []);

  const logout = () => {
    AuthService.logout();
    setUser(null);
    setToken(null);
  };

  const refreshUser = async () => {
    await loadSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: Boolean(token && user),
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
