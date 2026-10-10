import {
  StudentWithDetails,
  CreateStudentRequest,
  UpdateStudentRequest,
  UpsertParentGuardianRequest,
  ParentGuardianRecord,
  RouteWithStopsOption,
  AssignStudentTransportPayload,
  StudentTransportHistoryResponse,
  ParentRecordWithStudent,
  ParentAssignmentDetails,
  ParentCommunicationItem,
  SendParentNoticeRequest,
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

/**
 * Retrieves parent/guardian records linked to a student
 */
export async function fetchStudentParents(
  schoolId: string,
  studentId: string
): Promise<ParentGuardianRecord[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/${studentId}/parents`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('UNAUTHORIZED');
      }
      return [];
    }

    const json = await res.json();
    return json.data || [];
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') throw error;
    return [];
  }
}

/**
 * Adds or updates parent/guardian details and emergency contact for a student
 */
export async function upsertStudentParent(
  schoolId: string,
  studentId: string,
  payload: UpsertParentGuardianRequest
): Promise<StudentWithDetails> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/${studentId}/parents`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    const errorMsg = json.error?.message || json.message || 'Failed to update parent details.';
    throw new Error(errorMsg);
  }

  return json.data;
}

/**
 * Removes a parent/guardian record from a student
 */
export async function deleteStudentParent(
  schoolId: string,
  studentId: string,
  parentId: string
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/${studentId}/parents/${parentId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    const errorMsg = json.error?.message || json.message || 'Failed to remove parent record.';
    throw new Error(errorMsg);
  }
}

/**
 * Fetches available transport options (routes and their ordered pickup/drop stops)
 */
export async function fetchTransportOptions(
  schoolId: string
): Promise<RouteWithStopsOption[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/transport-options`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('UNAUTHORIZED');
      }
      return [];
    }

    const json = await res.json();
    return json.data || [];
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') throw error;
    return [];
  }
}

/**
 * Assigns or updates transport/bus/stop for a student (or unassigns if stops are null)
 */
export async function assignStudentTransport(
  schoolId: string,
  studentId: string,
  payload: AssignStudentTransportPayload
): Promise<StudentWithDetails> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/${studentId}/transport`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    const errorMsg = json.error?.message || json.message || 'Failed to update transport assignment.';
    throw new Error(errorMsg);
  }

  return json.data;
}

/**
 * Updates student demographic and academic profile
 */
export async function updateStudent(
  schoolId: string,
  studentId: string,
  payload: UpdateStudentRequest
): Promise<StudentWithDetails> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/${studentId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    const errorMsg = json.error?.message || json.message || 'Failed to update student.';
    throw new Error(errorMsg);
  }

  return json.data;
}

/**
 * Removes / soft-deletes a student from the directory
 */
export async function deleteStudent(
  schoolId: string,
  studentId: string
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/students/${studentId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    const errorMsg = json.error?.message || json.message || 'Failed to remove student.';
    throw new Error(errorMsg);
  }
}

/**
 * Fetches student boarding and drop-off transport attendance history
 */
export async function fetchStudentTransportHistory(
  schoolId: string,
  studentId: string,
  limit = 50
): Promise<StudentTransportHistoryResponse | null> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/schools/${schoolId}/students/${studentId}/transport-history?limit=${limit}`,
      {
        method: 'GET',
        headers: getAuthHeaders(),
      }
    );

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
 * Fetches all registered parents for a school with linked student and WhatsApp tracking status
 */
export async function fetchSchoolParents(
  schoolId: string,
  filters?: {
    search?: string;
    relationship?: string;
    whatsAppStatus?: string;
  }
): Promise<ParentRecordWithStudent[]> {
  try {
    const url = new URL(`${API_BASE_URL}/schools/${schoolId}/parents`);
    if (filters?.search) url.searchParams.append('search', filters.search);
    if (filters?.relationship) url.searchParams.append('relationship', filters.relationship);
    if (filters?.whatsAppStatus) url.searchParams.append('whatsAppStatus', filters.whatsAppStatus);

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
 * Fetches full assignment details for a parent (authorized student, transport allocations, live token)
 */
export async function fetchParentAssignmentDetails(
  schoolId: string,
  parentId: string
): Promise<ParentAssignmentDetails | null> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/schools/${schoolId}/parents/${parentId}/assignment`,
      {
        method: 'GET',
        headers: getAuthHeaders(),
      }
    );

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
 * Re-links a parent to another authorized student in the school
 */
export async function relinkParentStudent(
  schoolId: string,
  parentId: string,
  studentId: string
): Promise<ParentAssignmentDetails> {
  const res = await fetch(
    `${API_BASE_URL}/schools/${schoolId}/parents/${parentId}/relink`,
    {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ studentId }),
    }
  );

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `Failed to re-link student (${res.status})`);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Fetches unified communication history for a parent (WhatsApp notices + live token events)
 */
export async function fetchParentCommunicationHistory(
  schoolId: string,
  parentId: string
): Promise<ParentCommunicationItem[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/schools/${schoolId}/parents/${parentId}/communications`,
      {
        method: 'GET',
        headers: getAuthHeaders(),
      }
    );

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('UNAUTHORIZED');
      }
      return [];
    }

    const json = await res.json();
    return json.data || [];
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') throw error;
    return [];
  }
}

/**
 * Dispatches an outbound WhatsApp/SMS notice or invite to parent's registered mobile
 */
export async function sendParentNotice(
  schoolId: string,
  parentId: string,
  payload: SendParentNoticeRequest
): Promise<ParentCommunicationItem> {
  const res = await fetch(
    `${API_BASE_URL}/schools/${schoolId}/parents/${parentId}/communications`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `Failed to dispatch notice (${res.status})`);
  }

  const json = await res.json();
  return json.data;
}




