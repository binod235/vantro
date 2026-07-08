import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

class UpdateRatesDto {
  @IsOptional() @IsInt() @Min(0) standard_rate_pence?: number;
  @IsOptional() @IsInt() @Min(0) overtime_rate_pence?: number;
  @IsOptional() @IsInt() @Min(0) double_time_rate_pence?: number;
}

class UpdateSlugDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug may only contain lowercase letters, numbers, and hyphens' })
  slug: string;
}

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: CurrentUserType) {
    return this.companiesService.create(dto, user.id);
  }

  @Get('me')
  getMyCompany(@CurrentUser() user: CurrentUserType) {
    return this.companiesService.findForUser(user.id);
  }

  @Get('me/onboarding')
  @Roles('OWNER')
  getOnboarding(@CurrentUser() user: CurrentUserType) {
    return this.companiesService.getOnboardingStatus(user.companyId!);
  }

  @Get('public/:slug')
  @Public()
  getPublic(@Param('slug') slug: string) {
    return this.companiesService.findPublicBySlug(slug);
  }

  @Patch('me/slug')
  @Roles('OWNER')
  updateSlug(@Body() dto: UpdateSlugDto, @CurrentUser() user: CurrentUserType) {
    return this.companiesService.updateSlug(dto.slug, user.id);
  }

  @Patch('me/rates')
  @Roles('OWNER')
  updateRates(@Body() dto: UpdateRatesDto, @CurrentUser() user: CurrentUserType) {
    return this.companiesService.updateRates(user.companyId!, dto);
  }

  @Patch('me/settings')
  @Roles('OWNER')
  updateSettings(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.companiesService.updateSettings(user.companyId!, dto);
  }

  @Post('me/logo')
  @Roles('OWNER')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: memoryStorage(),
      // Hard cap at the multer/stream level so an oversized upload is
      // rejected before it's fully buffered into memory — the 2MB business
      // rule is enforced separately in CompaniesService.uploadLogo.
      limits: { fileSize: 3 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Logo must be PNG, JPG, or WebP'), false);
        }
      },
    }),
  )
  uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.companiesService.uploadLogo(user.companyId!, file);
  }

  @Delete('me/logo')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  deleteLogo(@CurrentUser() user: CurrentUserType) {
    return this.companiesService.deleteLogo(user.companyId!);
  }

  @Patch('me')
  @Roles('OWNER')
  update(@Body() dto: UpdateCompanyDto, @CurrentUser() user: CurrentUserType) {
    return this.companiesService.update(dto, user.id);
  }
}
