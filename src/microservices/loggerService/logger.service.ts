import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { PrismaService } from 'src/global/prisma.service';

type AppSecureParams = {
  passwordHash: string;
  saltHex: string;
};

export type EncryptedData = {
  ivHex: string;
  encrypted: string;
};

const ALGORITHM = 'aes-256-cbc';
const APP_SECURE_PARAMS = 'appSecureParams';

@Injectable()
export class SecurityService {
  private appPassword: string | null;
  private saltHex: string | null;
  public isSafeApp: boolean;

  constructor(private prismaService: PrismaService) {
    this.appPassword = null;
    this.saltHex = null;
    this.isSafeApp = true;

    this.init();
  }

  async init() {
    const secureParams = await this.prismaService.metadata.findUnique({
      where: {
        key: APP_SECURE_PARAMS,
      },
    });

    this.isSafeApp = !!secureParams;
  }

  isReady() {
    return this.isSafeApp
      ? this.appPassword !== null && this.saltHex !== null
      : true;
  }

  // Create a hash of the password for precheck
  private getPasswordHash(password: string) {
    return crypto
      .createHash('sha256')
      .update('check:' + password)
      .digest('hex');
  }

  private getKeyFromPassword(password: string, saltHex: string) {
    return crypto.pbkdf2Sync(
      password,
      Buffer.from(saltHex, 'hex'),
      100000,
      32,
      'sha256',
    );
  }

  private _encrypt(text: string, key: Buffer): EncryptedData {
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    return {
      ivHex: iv.toString('hex'),
      encrypted,
    };
  }

  private _decrypt(encrypted: EncryptedData, key: Buffer) {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(encrypted.ivHex, 'hex'),
    );

    let decrypted = decipher.update(encrypted.encrypted, 'hex', 'utf-8');

    decrypted += decipher.final('utf-8');

    return decrypted;
  }

  encrypt(text: string) {
    if (this.appPassword === null || this.saltHex === null) {
      throw new Error("Password doesn't exist");
    }

    const key = this.getKeyFromPassword(this.appPassword, this.saltHex);

    return this._encrypt(text, key);
  }

  decrypt(encrypted: EncryptedData) {
    if (this.appPassword === null || this.saltHex === null) {
      throw new Error("Password doesn't exist");
    }

    const key = this.getKeyFromPassword(this.appPassword, this.saltHex);

    return this._decrypt(encrypted, key);
  }

  async makeSafeApp(password: string) {
    if (this.isSafeApp) {
      throw new Error('Already Encrypted!');
    }

    const salt = crypto.randomBytes(16);

    const saltHex = salt.toString('hex');
    const passwordHash = this.getPasswordHash(password);

    const key = this.getKeyFromPassword(password, saltHex);

    const allUsers = await this.prismaService.user.findMany();

    const userInputs: { address: string; mnemonic: string }[] = [];

    for (const user of allUsers) {
      const encrypted = this._encrypt(user.mnemonic, key);

      userInputs.push({
        address: user.address,
        mnemonic: JSON.stringify(encrypted),
      });
    }

    await this.prismaService.$transaction(
      userInputs.map((input) => {
        return this.prismaService.user.update({
          where: {
            address: input.address.toLowerCase(),
          },
          data: input,
        });
      }),
    );

    this.appPassword = password;
    this.saltHex = saltHex;
    this.isSafeApp = true;

    await this.prismaService.metadata.upsert({
      where: {
        key: APP_SECURE_PARAMS,
      },
      create: {
        key: APP_SECURE_PARAMS,
        value: JSON.stringify({
          passwordHash,
          saltHex,
        }),
      },
      update: {
        key: APP_SECURE_PARAMS,
        value: JSON.stringify({
          passwordHash,
          saltHex,
        }),
      },
    });

    return true;
  }

  async changePassword(oldPassword: string, newPassword: string) {
    const secureParams = await this.prismaService.metadata.findUnique({
      where: {
        key: APP_SECURE_PARAMS,
      },
    });

    if (!secureParams) {
      throw new Error('This is not a encrypted app');
    }

    const oldAppParams = JSON.parse(secureParams.value) as AppSecureParams;

    if (oldAppParams.passwordHash !== this.getPasswordHash(oldPassword)) {
      throw new Error('Password is incorrect');
    }

    const newSalt = crypto.randomBytes(16);

    const newSaltHex = newSalt.toString('hex');
    const newPasswordHash = this.getPasswordHash(newPassword);

    const newKey = this.getKeyFromPassword(newPassword, newSaltHex);
    const oldKey = this.getKeyFromPassword(oldPassword, oldAppParams.saltHex);

    const allUsers = await this.prismaService.user.findMany();

    const userInputs: { address: string; mnemonic: string }[] = [];

    for (const user of allUsers) {
      const encryptedData = JSON.parse(user.mnemonic) as EncryptedData;

      const originalMnemonic = this._decrypt(encryptedData, oldKey);

      const encrypted = this._encrypt(originalMnemonic, newKey);

      userInputs.push({
        address: user.address,
        mnemonic: JSON.stringify(encrypted),
      });
    }

    await this.prismaService.$transaction(
      userInputs.map((input) => {
        return this.prismaService.user.update({
          where: {
            address: input.address.toLowerCase(),
          },
          data: input,
        });
      }),
    );

    this.appPassword = newPassword;
    this.saltHex = newSaltHex;

    await this.prismaService.metadata.upsert({
      where: {
        key: APP_SECURE_PARAMS,
      },
      create: {
        key: APP_SECURE_PARAMS,
        value: JSON.stringify({
          passwordHash: newPasswordHash,
          saltHex: newSaltHex,
        }),
      },
      update: {
        key: APP_SECURE_PARAMS,
        value: JSON.stringify({
          passwordHash: newPasswordHash,
          saltHex: newSaltHex,
        }),
      },
    });

    return true;
  }

  async isValidPassword(password: string) {
    const secureParams = await this.prismaService.metadata.findUnique({
      where: {
        key: APP_SECURE_PARAMS,
      },
    });

    if (!secureParams) {
      return true;
    }

    const params = JSON.parse(secureParams.value) as AppSecureParams;

    const passwordHash = this.getPasswordHash(password);

    return params.passwordHash === passwordHash;
  }

  async loadPassword(password: string) {
    const secureParams = await this.prismaService.metadata.findUnique({
      where: {
        key: APP_SECURE_PARAMS,
      },
    });

    if (!secureParams) {
      throw new Error('This app is not secure');
    }

    const params = JSON.parse(secureParams.value) as AppSecureParams;

    const passwordHash = this.getPasswordHash(password);

    if (params.passwordHash !== passwordHash) {
      throw new Error('Password is incorrect');
    }

    this.appPassword = password;
    this.saltHex = params.saltHex;
  }
}
