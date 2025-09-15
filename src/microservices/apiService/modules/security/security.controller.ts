import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { PATTERNS } from 'src/utils/constants';
import { EncryptedData } from 'src/types';

import { SecurityService } from './security.service';

@Controller()
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @MessagePattern(PATTERNS.Security.IsSafeApp)
  isSafeApp() {
    return this.securityService.isSafeApp;
  }

  @MessagePattern(PATTERNS.Security.Encrypt)
  encrypt(@Payload() text: string) {
    return this.securityService.encrypt(text);
  }

  @MessagePattern(PATTERNS.Security.Decrypt)
  decrypt(@Payload() encrypted: EncryptedData) {
    return this.securityService.decrypt(encrypted);
  }

  @MessagePattern(PATTERNS.Security.IsValidPassword)
  isValidPassword(@Payload() password: string) {
    return this.securityService.isValidPassword(password);
  }
}
