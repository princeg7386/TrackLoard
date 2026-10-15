import { School, UpdateSchoolProfileRequest } from '@school-bus/shared';
import { apiRequest } from './api-client';

export class SchoolService {
  /**
   * Fetch school profile by school ID
   */
  public static async getProfile(schoolId: string): Promise<School> {
    return await apiRequest<School>(`/schools/${schoolId}/profile`, {
      method: 'GET',
    });
  }

  /**
   * Update school profile
   */
  public static async updateProfile(
    schoolId: string,
    data: UpdateSchoolProfileRequest
  ): Promise<School> {
    return await apiRequest<School>(`/schools/${schoolId}/profile`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
}

