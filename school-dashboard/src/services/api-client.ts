import { ApiResponse } from '@school-bus/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export class ApiClientError extends Error {
  public statusCode: number;
  public details?: any;
  public code?: string;

  constructor(message: string, statusCode: number, details?: any, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sb_auth_token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data: ApiResponse<T> = await response.json().catch(() => ({
      success: false,
      timestamp: new Date().toISOString(),
      error: {
        code: 'PARSE_ERROR',
        message: 'Failed to parse JSON response from server',
      },
    }));

    if (!response.ok || !data.success) {
      throw new ApiClientError(
        data.error?.message || `Request failed with status ${response.status}`,
        response.status,
        data.error?.details,
        data.error?.code
      );
    }

    return data.data as T;
  } catch (error: any) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    // Network or connectivity failure
    throw new ApiClientError(
      error.message || 'Unable to connect to server. Please check your network connection.',
      0,
      undefined,
      'NETWORK_ERROR'
    );
  }
}

