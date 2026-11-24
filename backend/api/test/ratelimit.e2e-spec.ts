import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Login rate limit (e2e)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks repeated failed logins with 429 after 10 attempts', async () => {
    const body = { email: 'nobody@ratelimit.test', password: 'WrongPass#12345' };

    for (let i = 0; i < 10; i++) {
      await api().post('/api/v1/auth/login').send(body).expect(401);
    }

    await api().post('/api/v1/auth/login').send(body).expect(429);
  });
});