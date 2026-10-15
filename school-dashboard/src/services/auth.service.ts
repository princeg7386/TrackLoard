import {
  AuthUserPayload,
  LoginRequest,
  LoginResponseData,
  ChangePasswordRequest,
  UpdateAdminProfileRequest,
} from '@school-bus/shared';
import { apiRequest } from './api-client';

export class AuthService {
  /**
   * Log in admin user with email and password
   */
  public static async login(credentials: LoginRequest): Promise<LoginResponseData> {
    const data = await apiRequest<LoginResponseData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });

    if (typeof window !== 'undefined') {
      localStorage.setItem('sb_auth_token', data.token);
      localStorage.setItem('sb_user_id', data.user.id);
      localStorage.setItem('sb_user_email', data.user.email);
      localStorage.setItem('sb_user_name', data.user.fullName);
      localStorage.setItem('sb_user_role', data.user.role);
      if (data.user.schoolId) {
        localStorage.setItem('sb_school_id', data.user.schoolId);
      }
    }

    return data;
  }

  /**
   * Log out current user and clear local session
   */
  public static async logout(): Promise<void> {
    try {
      await apiRequest<{ loggedOut: boolean }>('/auth/logout', {
        method: 'POST',
      });
    } catch {
      // Proceed with client side cleanup regardless of network status
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('sb_auth_token');
        localStorage.removeItem('sb_user_id');
        localStorage.removeItem('sb_user_email');
        localStorage.removeItem('sb_user_name');
        localStorage.removeItem('sb_user_role');
        window.location.href = '/login';
      }
    }
  }

  /**
   * Get current authenticated user profile
   */
  public static async getMe(): Promise<AuthUserPayload> {
    return await apiRequest<AuthUserPayload>('/auth/me', {
      method: 'GET',
    });
  }

  /**
   * Update administrator personal profile (full name, mobile phone)
   */
  public static async updateProfile(
    data: UpdateAdminProfileRequest
  ): Promise<AuthUserPayload> {
    const updated = await apiRequest<AuthUserPayload>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });

    if (typeof window !== 'undefined') {
      localStorage.setItem('sb_user_name', updated.fullName);
    }

    return updated;
  }

  /**
   * Change current admin password
   */
  public static async changePassword(
    data: ChangePasswordRequest
  ): Promise<{ success: boolean }> {
    return await apiRequest<{ success: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

