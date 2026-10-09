import { Request } from 'express';
import { env } from '../config/env.js';

export class SecurityUtil {
  /**
   * Asserts environment variables security compliance (ensures production is not using default dev secrets)
   */
  public static validateProductionSecrets(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (env.NODE_ENV === 'production') {
      if (
        !env.JWT_SECRET ||
        env.JWT_SECRET.includes('development') ||
        env.JWT_SECRET.length < 32
      ) {
        issues.push('JWT_SECRET must be at least 32 characters and cannot be a default development key in production');
      }

      if (
        !env.PARENT_TOKEN_SECRET ||
        env.PARENT_TOKEN_SECRET.includes('development') ||
        env.PARENT_TOKEN_SECRET.length < 32
      ) {
        issues.push('PARENT_TOKEN_SECRET must be at least 32 characters and cannot be a default development key in production');
      }

      if (env.DATABASE_URL.includes('postgrespassword@localhost')) {
        issues.push('DATABASE_URL must point to a production database, not local default credentials');
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Redacts sensitive credentials from strings (e.g. database connection strings or authorization headers)
   */
  public static redactConnectionString(connectionUrl: string): string {
    if (!connectionUrl) return connectionUrl;
    return connectionUrl.replace(
      /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@.+)/i,
      '$1[REDACTED]$3'
    );
  }

  /**
   * Safely extracts client IP address with proxy forwarding support
   */
  public static getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const parts = forwarded.split(',');
      return (parts[0] || '').trim();
    }
    return req.socket.remoteAddress || '127.0.0.1';
  }

  /**
   * Masks Indian mobile phone numbers for privacy in logs (e.g. +919876543210 -> +9198****3210)
   */
  public static maskPhoneNumber(phone: string): string {
    if (!phone || phone.length < 8) return phone;
    const clean = phone.trim();
    const prefix = clean.substring(0, 5); // e.g. +9198
    const suffix = clean.substring(clean.length - 4); // e.g. 3210
    return `${prefix}****${suffix}`;
  }
}
