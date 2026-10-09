import fs from 'fs';
import path from 'path';

export interface UploadOptions {
  mimeType?: string;
  isPublic?: boolean;
}

export interface IStorageAdapter {
  uploadFile(filePath: string, data: Buffer, options?: UploadOptions): Promise<string>;
  getFileBuffer(filePath: string): Promise<Buffer>;
  deleteFile(filePath: string): Promise<boolean>;
  fileExists(filePath: string): Promise<boolean>;
}

/**
 * Local Disk File Storage Adapter (Default Free/OSS implementation)
 */
export class LocalStorageAdapter implements IStorageAdapter {
  private baseDir: string;

  constructor(baseDir: string = './storage') {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async uploadFile(
    filePath: string,
    data: Buffer,
    _options?: UploadOptions
  ): Promise<string> {
    const fullPath = path.join(this.baseDir, filePath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
    return `/storage/${filePath}`;
  }

  async getFileBuffer(filePath: string): Promise<Buffer> {
    const fullPath = path.join(this.baseDir, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(fullPath);
  }

  async deleteFile(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
    return false;
  }

  async fileExists(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, filePath);
    return fs.existsSync(fullPath);
  }
}

/**
 * In-Memory Mock Storage Adapter for Unit Testing
 */
export class MockStorageAdapter implements IStorageAdapter {
  private store = new Map<string, Buffer>();

  async uploadFile(filePath: string, data: Buffer): Promise<string> {
    this.store.set(filePath, data);
    return `mock://storage/${filePath}`;
  }

  async getFileBuffer(filePath: string): Promise<Buffer> {
    const data = this.store.get(filePath);
    if (!data) throw new Error(`File not found: ${filePath}`);
    return data;
  }

  async deleteFile(filePath: string): Promise<boolean> {
    return this.store.delete(filePath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.store.has(filePath);
  }
}
