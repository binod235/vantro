import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class JobPhotosService {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(companyId: string, jobId: string) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!job) throw new NotFoundException('Job not found');

    return this.prisma.client.jobPhoto.findMany({
      where: { job_id: jobId, company_id: companyId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { created_at: 'asc' },
    });
  }

  async upload(
    companyId: string,
    jobId:     string,
    userId:    string,
    file:      Express.Multer.File,
    caption?:  string,
    phase?:    string,
  ) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!job) throw new NotFoundException('Job not found');

    const key = `photos/${jobId}/${randomUUID()}.jpg`;
    const url = await this.storage.uploadImage(file.buffer, key, file.mimetype);

    return this.prisma.client.jobPhoto.create({
      data: {
        company_id: companyId,
        job_id:     jobId,
        user_id:    userId,
        key,
        url,
        caption:   caption ?? null,
        phase:     phase   ?? null,
        file_size: file.size,
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async remove(
    companyId: string,
    photoId:   string,
    userId:    string,
    role:      string,
  ) {
    const photo = await this.prisma.client.jobPhoto.findFirst({
      where: { id: photoId, company_id: companyId },
    });
    if (!photo) throw new NotFoundException('Photo not found');

    if (role === 'ENGINEER' && photo.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own photos');
    }

    await this.storage.deleteImage(photo.key);
    await this.prisma.client.jobPhoto.delete({ where: { id: photoId } });
  }
}
