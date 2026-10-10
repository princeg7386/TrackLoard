import {
  StudentWithDetails,
  CreateStudentRequest,
  UpdateStudentRequest,
} from '@school-bus/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sb_admin_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Fetches all registered students for a school with joined stop, route, and parent details
 */
export async function fetchStudents(
  schoolId: string,
  filters?: {
    search?: string;
    classGrade?: string;
    section?: string;
  }
): Promise<StudentWithDetails[]> {
  try {
    const url = new URL(`${API_BASE_URL}/schools/${schoolId}/students`);
    if (filters?.search) url.searchParams.append('search', filters.search);
    if (filters?.classGrade) url.searchParams.append('classGrade', filters.classGrade);
    if (filters?.section) url.searchParams.append('section', filters.section);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('UNAUTHORIZED');
      }
      throw new Error(`API Error: ${res.status}`);
    }

    const json = await res.json();
    return json.data || [];
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') throw error;
    return [];
  }
}

/**
 * Retrieves single student details
 */
export async function fetchStudentDetail(
  schoolId: string,
  studentId: string
): Promise<StudentWithDetails | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/${studentId}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('UNAUTHORIZED');
      }
      return null;
    }

    const json = await res.json();
    return json.data || null;
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') throw error;
    return null;
  }
}

/**
 * Registers a new student in the school directory
 */
export async function createStudent(
  schoolId: string,
  payload: CreateStudentRequest
): Promise<StudentWithDetails> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    const errorMsg = json.error?.message || json.message || 'Failed to register student.';
    throw new Error(errorMsg);
  }

  return json.data;
}
