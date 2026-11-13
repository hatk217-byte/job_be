import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private s3Client: S3Client | null = null;
  private bucketName: string;
  private publicUrl: string;
  private isLocalStorage: boolean = false;
  private uploadDir: string;
  private localBaseUrl: string;

  constructor(private configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'R2_SECRET_ACCESS_KEY',
    );
    this.bucketName = this.configService.get<string>('R2_BUCKET_NAME') || '';
    this.publicUrl = this.configService.get<string>('R2_PUBLIC_URL') || '';

    const port = this.configService.get<string>('PORT') || '8080';
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.localBaseUrl = `http://localhost:${port}/uploads`;

    const isDummyR2 =
      !accountId ||
      accountId === 'dummy' ||
      accountId.includes('your-account-id') ||
      !accessKeyId ||
      accessKeyId === 'dummy' ||
      !secretAccessKey ||
      secretAccessKey === 'dummy' ||
      !this.bucketName ||
      this.bucketName === 'dummy' ||
      this.configService.get<string>('USE_LOCAL_STORAGE') === 'true';

    if (isDummyR2) {
      this.isLocalStorage = true;
      this.logger.warn(
        `Using LOCAL DISK STORAGE fallback (R2 dummy credentials detected). Uploads folder: ${this.uploadDir}`,
      );
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }
    } else {
      try {
        this.s3Client = new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        });
        this.logger.log('Cloudflare R2 client initialized successfully');
      } catch (err) {
        this.logger.error(
          'Failed to initialize R2 client, falling back to local storage',
          err,
        );
        this.isLocalStorage = true;
      }
    }
  }

  private async saveFileLocally(
    file: Express.Multer.File,
    fileName: string,
  ): Promise<string> {
    const targetPath = path.join(this.uploadDir, fileName);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, file.buffer);
    this.logger.log(`File saved locally: ${targetPath}`);
    return `${this.localBaseUrl}/${fileName}`;
  }

  /**
   * Upload file lên Cloudflare R2 hoặc lưu local fallback
   * @param file File từ multer
   * @param folder Thư mục lưu trữ (cv, avatar, cover-letter, etc.)
   * @returns URL public của file
   */
  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${timestamp}-${randomString}.${fileExtension}`;

    if (this.isLocalStorage || !this.s3Client) {
      return this.saveFileLocally(file, fileName);
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      const fileUrl = `${this.publicUrl}/${fileName}`;
      return fileUrl;
    } catch (error) {
      this.logger.error('Error uploading file to R2:', error);
      // In non-production, fallback to local storage
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          'R2 upload failed in dev mode, saving locally as fallback',
        );
        return this.saveFileLocally(file, fileName);
      }
      throw new BadRequestException('Tải tệp lên thất bại');
    }
  }

  /**
   * Trích xuất key từ URL file (hỗ trợ cả R2 URL và local uploads URL)
   */
  private extractKeyFromFileUrl(fileUrl: string): string {
    if (!fileUrl) {
      throw new BadRequestException('URL ảnh không hợp lệ');
    }

    const sanitized = fileUrl.split('?')[0].split('#')[0];

    // Check if it's a local upload URL (/uploads/...)
    if (sanitized.includes('/uploads/')) {
      const parts = sanitized.split('/uploads/');
      let key = parts[1] || '';
      if (key.startsWith('/')) key = key.substring(1);
      if (!key || key.includes('..')) {
        throw new BadRequestException('Đường dẫn ảnh không hợp lệ');
      }
      return key;
    }

    const publicBase = this.publicUrl ? this.publicUrl.replace(/\/$/, '') : '';

    if (publicBase && sanitized.startsWith(`${publicBase}/`)) {
      return sanitized.slice(publicBase.length + 1);
    }

    let pathname: string;
    try {
      pathname = new URL(sanitized).pathname;
    } catch {
      throw new BadRequestException('URL ảnh không hợp lệ');
    }

    const key = pathname.startsWith('/') ? pathname.substring(1) : pathname;

    if (!key || key.includes('..')) {
      throw new BadRequestException('Đường dẫn ảnh không hợp lệ');
    }

    return key;
  }

  private assertAllowedImageKey(key: string): void {
    const allowedPrefixes = ['logo/', 'banner/', 'company-images/', 'avatar/'];

    if (!allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
      throw new BadRequestException('Đường dẫn ảnh không được phép');
    }
  }

  /**
   * Đọc ảnh từ disk (local) hoặc R2 và trả về data URL (phục vụ crop ảnh trên FE, tránh CORS)
   */
  async getImageDataUrl(fileUrl: string): Promise<{ dataUrl: string }> {
    const key = this.extractKeyFromFileUrl(fileUrl);
    this.assertAllowedImageKey(key);

    // 1. Kiểm tra trên ổ đĩa cục bộ trước
    const localFilePath = path.join(this.uploadDir, key);
    if (fs.existsSync(localFilePath)) {
      try {
        const body = await fs.promises.readFile(localFilePath);
        const ext = path.extname(localFilePath).toLowerCase().replace('.', '');
        const mimeType =
          ext === 'png'
            ? 'image/png'
            : ext === 'svg'
            ? 'image/svg+xml'
            : ext === 'webp'
            ? 'image/webp'
            : 'image/jpeg';
        const base64 = body.toString('base64');
        return {
          dataUrl: `data:${mimeType};base64,${base64}`,
        };
      } catch (err) {
        this.logger.error('Error reading local image:', err);
        throw new BadRequestException('Không tải được ảnh');
      }
    }

    // 2. Nếu không có ở local và có s3Client, đọc từ R2
    if (!this.s3Client) {
      throw new BadRequestException('Không tìm thấy ảnh');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      const body = await response.Body?.transformToByteArray();

      if (!body?.length) {
        throw new BadRequestException('Không tìm thấy ảnh');
      }

      const mimeType = response.ContentType || 'image/png';
      const base64 = Buffer.from(body).toString('base64');

      return {
        dataUrl: `data:${mimeType};base64,${base64}`,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error reading image from R2:', error);
      throw new BadRequestException('Không tải được ảnh');
    }
  }

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      if (!fileUrl) return;

      const key = this.extractKeyFromFileUrl(fileUrl);

      if (!key) {
        this.logger.warn(`Cannot extract key from URL: ${fileUrl}`);
        return;
      }

      // Xóa file local nếu có
      const localFilePath = path.join(this.uploadDir, key);
      if (fs.existsSync(localFilePath)) {
        await fs.promises.unlink(localFilePath).catch(() => {});
        this.logger.log(`Deleted local file: ${localFilePath}`);
        return;
      }

      // Xóa file R2 nếu có client
      if (this.s3Client) {
        const command = new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        });

        await this.s3Client.send(command);
        this.logger.log(`Deleted file from R2: ${key}`);
      }
    } catch (error) {
      this.logger.error('Error deleting file:', error);
    }
  }

  /**
   * Tạo presigned URL để upload trực tiếp từ client
   */
  async getPresignedUploadUrl(
    fileName: string,
    folder: string,
    contentType: string,
    expiresIn: number = 3600,
  ): Promise<{ uploadUrl: string; fileUrl: string; key: string }> {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExtension = fileName.split('.').pop();
    const key = `${folder}/${timestamp}-${randomString}.${fileExtension}`;

    if (this.isLocalStorage || !this.s3Client) {
      const fileUrl = `${this.localBaseUrl}/${key}`;
      return {
        uploadUrl: fileUrl,
        fileUrl,
        key,
      };
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn,
      });

      const fileUrl = `${this.publicUrl}/${key}`;

      return {
        uploadUrl,
        fileUrl,
        key,
      };
    } catch (error) {
      this.logger.error('Error generating presigned URL:', error);
      throw new BadRequestException('Tạo URL tải lên thất bại');
    }
  }

  /**
   * Validate file CV/Cover Letter
   */
  validateCvFile(file: Express.Multer.File): void {
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Định dạng tệp không hợp lệ. Chỉ cho phép PDF, DOC và DOCX.',
      );
    }

    if (file.size > maxSize) {
      throw new BadRequestException('Kích thước tệp phải nhỏ hơn 5MB.');
    }
  }

  /**
   * Validate image file
   */
  validateImageFile(file: Express.Multer.File): void {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'image/webp',
    ];

    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Định dạng tệp không hợp lệ. Chỉ cho phép JPEG, PNG và WebP.',
      );
    }

    if (file.size > maxSize) {
      throw new BadRequestException('Kích thước tệp phải nhỏ hơn 5MB.');
    }
  }

  /**
   * Delete multiple files from R2/local (batch operation)
   */
  async deleteBatch(urls: string[]): Promise<void> {
    this.logger.log(`Starting batch delete of ${urls.length} files`);

    const deletePromises = urls.map(async (url) => {
      try {
        await this.deleteFile(url);
        return { url, success: true };
      } catch (error) {
        this.logger.error(`Failed to delete ${url}:`, error);
        return { url, success: false, error };
      }
    });

    const results = await Promise.allSettled(deletePromises);
    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success,
    ).length;
    const failCount = results.length - successCount;

    this.logger.log(
      `Batch delete completed: ${successCount} succeeded, ${failCount} failed`,
    );
  }
}
