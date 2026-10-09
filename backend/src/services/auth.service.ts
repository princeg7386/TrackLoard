import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { env } from '../config/env.js';
import { IdUtil } from '../utils/id.util.js';
import {
  AuthUserPayload,
  LoginResponseData,
  UserRole,
} from '@school-bus/shared';
import {
  UnauthorizedError,
  NotFoundError,
  AppError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';

export class AuthService {
  private static readonly SALT_ROUNDS = 10;

  /**
   * Hashes a plaintext password using bcrypt
   */
  static async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Compares plaintext password with stored bcrypt hash
   */
  static async verifyPassword(
    plainText: string,
    hash: string
  ): Promise<boolean> {
    return await bcrypt.compare(plainText, hash);
  }

  /**
   * Generates a signed JWT for authenticated admin sessions
   */
  static generateToken(
    user: AuthUserPayload,
    expiresIn: string = env.JWT_EXPIRES_IN
  ): string {
    return jwt.sign(
      {
        id: user.id,
        schoolId: user.schoolId,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
      },
      env.JWT_SECRET,
      { expiresIn: expiresIn as any }
    );
  }

  /**
   * Verifies and decodes a JWT token
   */
  static verifyToken(token: string): AuthUserPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET) as AuthUserPayload;
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }
  }

  /**
   * Authenticates an admin user with email and password
   */
  static async login(
    email: string,
    password: string
  ): Promise<LoginResponseData> {
    const cleanEmail = email.trim().toLowerCase();
    const rows = await query<{
      id: string;
      school_id: string | null;
      email: string;
      password_hash: string;
      full_name: string;
      phone: string | null;
      role: string;
      deleted_at: string | null;
    }>(
      `SELECT id, school_id, email, password_hash, full_name, phone, role, deleted_at 
       FROM admins 
       WHERE LOWER(email) = $1 AND deleted_at IS NULL LIMIT 1;`,
      [cleanEmail]
    );

    const admin = rows[0];
    if (!admin) {
      logger.warn('Login attempt with non-existent admin email', { email: cleanEmail });
      throw new UnauthorizedError('Invalid email or password');
    }

    const isMatch = await this.verifyPassword(password, admin.password_hash);
    if (!isMatch) {
      logger.warn('Login failed due to invalid password', { email: cleanEmail, adminId: admin.id });
      throw new UnauthorizedError('Invalid email or password');
    }

    const userPayload: AuthUserPayload = {
      id: admin.id,
      schoolId: admin.school_id,
      email: admin.email,
      fullName: admin.full_name,
      role: admin.role as UserRole,
      phone: admin.phone || undefined,
    };

    const token = this.generateToken(userPayload);

    logger.info('Admin user logged in successfully', {
      adminId: admin.id,
      schoolId: admin.school_id || undefined,
      role: admin.role,
    });

    return {
      token,
      user: userPayload,
      expiresIn: env.JWT_EXPIRES_IN,
    };
  }

  /**
   * Generates a password reset token and stores it in the database
   */
  static async forgotPassword(email: string): Promise<{ success: boolean; resetToken?: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const rows = await query<{ id: string }>(
      'SELECT id FROM admins WHERE LOWER(email) = $1 AND deleted_at IS NULL LIMIT 1;',
      [cleanEmail]
    );

    const admin = rows[0];
    if (!admin) {
      // Don't leak whether an email exists for security
      return { success: true };
    }

    const resetToken = IdUtil.generateSecureToken(32);
    // Token valid for 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await query(
      `UPDATE admins 
       SET password_reset_token = $1, password_reset_expires_at = $2 
       WHERE id = $3;`,
      [resetToken, expiresAt, admin.id]
    );

    logger.info('Password reset token generated', { adminId: admin.id });
    return { success: true, resetToken };
  }

  /**
   * Resets password using a valid reset token
   */
  static async resetPassword(
    token: string,
    newPassword: string
  ): Promise<{ success: boolean }> {
    const rows = await query<{ id: string; password_reset_expires_at: string }>(
      `SELECT id, password_reset_expires_at 
       FROM admins 
       WHERE password_reset_token = $1 AND deleted_at IS NULL LIMIT 1;`,
      [token]
    );

    const admin = rows[0];
    if (!admin) {
      throw new AppError('Invalid or expired password reset token', 400);
    }

    const now = new Date();
    const expiresAt = new Date(admin.password_reset_expires_at);
    if (now > expiresAt) {
      throw new AppError('Password reset token has expired. Please request a new one.', 400);
    }

    const newHash = await this.hashPassword(newPassword);

    await query(
      `UPDATE admins 
       SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL 
       WHERE id = $2;`,
      [newHash, admin.id]
    );

    logger.info('Password reset successfully completed', { adminId: admin.id });
    return { success: true };
  }

  /**
   * Changes password when authenticated with current password
   */
  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean }> {
    const rows = await query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM admins WHERE id = $1 AND deleted_at IS NULL LIMIT 1;',
      [userId]
    );

    const admin = rows[0];
    if (!admin) {
      throw new NotFoundError('Admin user not found');
    }

    const isMatch = await this.verifyPassword(currentPassword, admin.password_hash);
    if (!isMatch) {
      throw new AppError('Current password does not match', 400);
    }

    const newHash = await this.hashPassword(newPassword);
    await query('UPDATE admins SET password_hash = $1 WHERE id = $2;', [
      newHash,
      userId,
    ]);

    logger.info('Admin user changed password successfully', { adminId: userId });
    return { success: true };
  }

  /**
   * Fetches user profile for authenticated session
   */
  static async getMe(userId: string): Promise<AuthUserPayload> {
    const rows = await query<{
      id: string;
      school_id: string | null;
      email: string;
      full_name: string;
      phone: string | null;
      role: string;
    }>(
      `SELECT id, school_id, email, full_name, phone, role 
       FROM admins 
       WHERE id = $1 AND deleted_at IS NULL LIMIT 1;`,
      [userId]
    );

    const admin = rows[0];
    if (!admin) {
      throw new NotFoundError('User not found');
    }

    return {
      id: admin.id,
      schoolId: admin.school_id,
      email: admin.email,
      fullName: admin.full_name,
      role: admin.role as UserRole,
      phone: admin.phone || undefined,
    };
  }
}
