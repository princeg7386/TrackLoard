import { Response } from 'express';
import { ApiResponse, PaginatedResult } from '@school-bus/shared';

/**
 * Sends a standardized successful JSON API response
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode: number = 200
): Response {
  const payload: ApiResponse<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  return res.status(statusCode).json(payload);
}

/**
 * Sends a 201 Created JSON API response
 */
export function sendCreated<T>(
  res: Response,
  data: T,
  message?: string
): Response {
  return sendSuccess(res, data, message, 201);
}

/**
 * Sends a standardized paginated JSON response
 */
export function sendPaginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  message?: string
): Response {
  const totalPages = Math.ceil(total / pageSize) || 1;
  const paginatedData: PaginatedResult<T> = {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
  return sendSuccess(res, paginatedData, message, 200);
}

