import { INestApplication } from '@nestjs/common';
import { describe, expect, beforeEach, afterEach, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiModule } from '../src/microservices/apiService/api.module';

describe('ApiModule (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('initializes the API module', () => {
    expect(app).toBeDefined();
  });
});
