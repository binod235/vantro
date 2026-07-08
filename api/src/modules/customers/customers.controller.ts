import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CustomersService, type ImportMapping } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /** Preview CSV headers and first 5 rows (owner only). */
  @Post('import/preview')
  @Roles('OWNER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(csv|txt)$/i)) {
          return cb(new BadRequestException('Only CSV files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  importPreview(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    void user; // owner check via @Roles
    return this.customersService.parseImportPreview(file.buffer);
  }

  /** Run CSV import with the user-supplied column mapping (owner only). */
  @Post('import')
  @Roles('OWNER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(csv|txt)$/i)) {
          return cb(new BadRequestException('Only CSV files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  importRun(
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingJson: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!mappingJson) throw new BadRequestException('Column mapping is required');

    let mapping: ImportMapping;
    try {
      mapping = JSON.parse(mappingJson) as ImportMapping;
    } catch {
      throw new BadRequestException('Invalid mapping JSON');
    }
    if (mapping.name === undefined || mapping.name === null) {
      throw new BadRequestException('Mapping must include the "name" column');
    }

    return this.customersService.importFromCsv(file.buffer, mapping, user.companyId!);
  }

  /** Owner creates a new customer in the company. */
  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.create(dto, user.companyId!);
  }

  /** List all customers in the company. Both roles. */
  @Get()
  findAll(@CurrentUser() user: CurrentUserType) {
    if (!user.companyId) return [];
    return this.customersService.findAll(user.companyId);
  }

  /** Get a single customer by ID. Both roles. */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    if (!user.companyId) throw new NotFoundException('Customer not found');
    return this.customersService.findOne(id, user.companyId);
  }

  /** Update a customer. Owner only. */
  @Patch(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.customersService.update(id, dto, user.companyId!);
  }

  /**
   * Delete a customer. Owner only.
   * Returns 409 if the customer has existing jobs.
   */
  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.remove(id, user.companyId!);
  }
}
