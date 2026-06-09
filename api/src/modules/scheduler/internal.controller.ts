import { Controller, ForbiddenException, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { TrialService } from './trial.service';

@Controller('internal')
export class InternalController {
  constructor(private readonly trialService: TrialService) {}

  @Post('trials/expire-now')
  @Public()
  async expireNow() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Not available in production.');
    }
    const count = await this.trialService.lockExpiredTrials();
    return { locked: count };
  }
}
