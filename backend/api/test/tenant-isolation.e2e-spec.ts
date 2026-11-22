import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let patientId: string;

  const suffix = Date.now();
  const reg = (n: string) => ({
    organizationName: `Org ${n} ${suffix}`,
    hospitalName: `Hospital ${n} ${suffix}`,
    firstName: 'Test',
    lastName: `Admin${n}`,
    email: `admin-${n.toLowerCase()}-${suffix}@isolation.test`,
    password: 'IsolationPass#123',
  });

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

    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(reg('A'));
    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(reg('B'));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    tokenA = a.body.accessToken;
    tokenB = b.body.accessToken;

    const p = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Iso',
        lastName: 'Lated',
        dateOfBirth: '1990-01-01',
        gender: 'MALE',
      });
    expect(p.status).toBe(201);
    patientId = p.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('hospital A can read its own patient', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
  });

  it('hospital B cannot read hospital A patient (404)', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('hospital B cannot update hospital A patient (404)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ phone: '0000' })
      .expect(404);
  });

  it('hospital B list does not contain hospital A patient', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});