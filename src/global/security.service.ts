import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { timeout } from 'rxjs';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { EncryptedData } from 'src/types';

@Injectable()
export class SecurityService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
  ) {}

  async isSafeApp() {
    return await new Promise<boolean>((resolve, reject) => {
      this.redisClient
        .send<boolean>(PATTERNS.Security.IsSafeApp, {})
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async encrypt(text: string) {
    return await new Promise<EncryptedData>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Security.Encrypt, text)
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async decrypt(encrypted: EncryptedData) {
    return await new Promise<string>((resolve, reject) => {
      this.redisClient
        .send<string>(PATTERNS.Security.Decrypt, encrypted)
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async isValidPassword(password: string) {
    return await new Promise<boolean>((resolve, reject) => {
      this.redisClient
        .send<boolean>(PATTERNS.Security.IsValidPassword, password)
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }
}
