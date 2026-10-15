import crypto from 'crypto';

export class IdUtil {
  /**
   * Generates a standard RFC 4122 v4 UUID
   */
  static generateUuid(): string {
    return crypto.randomUUID();
  }

  /**
   * Generates a cryptographically secure random URL-safe hex/base64 token
   */
  static generateSecureToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Generates a human-friendly short code (e.g. for Route or Bus IDs: "RTE-9A4B")
   */
  static generateShortCode(prefix?: string, length: number = 6): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 without ambiguous characters (0,1,I,O)
    let code = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      code += chars[bytes[i]! % chars.length];
    }
    return prefix ? `${prefix}-${code}` : code;
  }
}

