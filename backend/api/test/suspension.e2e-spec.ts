import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Suspension (e2e)', () => {
  let app: INestApplication;
  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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

  it('a suspended user is locked out immediately, and can return when reactivated', async () => {
    const admin = await api()
      .post('/api/v1/auth/register')
      .send({
        organizationName: `Org S ${suffix}`,
        hospitalName: `Hospital S ${suffix}`,
        firstName: 'Test',
        lastName: 'AdminS',
        email: `admin-s-${suffix}@susp.test`,
        password: 'IsolationPass#123',
      });
    expect(admin.status).toBe(201);
    const adminToken = admin.body.accessToken as string;

    const email = `nurse-s-${suffix}@susp.test`;
    const staff = await api()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send({
        firstName: 'Nina',
        lastName: 'Nurse',
        email,
        password: 'NursePass#12345',
        role: 'NURSE',
      });
    expect(staff.status).toBe(201);

    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: 'NursePass#12345' });
    expect(login.status).toBe(201);
    const nurseToken = login.body.accessToken as string;

    // Works before suspension
    await api().get('/api/v1/patients').set(auth(nurseToken)).expect(200);

    // Suspend
    await api()
      .patch(`/api/v1/staff/${staff.body.id}/suspend`)
      .set(auth(adminToken))
      .expect(200);

    // The SAME token stops working at once
    await api().get('/api/v1/patients').set(auth(nurseToken)).expect(401);

    // And a fresh login is refused
    await api()
      .post('/api/v1/auth/login')
      .send({ email, password: 'NursePass#12345' })
      .expect(401);

    // Reactivate: new login works again
    await api()
      .patch(`/api/v1/staff/${staff.body.id}/activate`)
      .set(auth(adminToken))
      .expect(200);
    const again = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: 'NursePass#12345' });
    expect(again.status).toBe(201);
    await api()
      .get('/api/v1/patients')
      .set(auth(again.body.accessToken))
      .expect(200);
  });
});