import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Wards and beds (e2e)', () => {
  let app: INestApplication;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createStaff(
    adminToken: string,
    n: string,
    role: 'DOCTOR' | 'NURSE' | 'PHARMACIST',
    password: string,
  ) {
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@ward.test`;
    const s = await api()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send({
        firstName: 'Staff',
        lastName: `${role}${n}`,
        email,
        password,
        role,
      });
    expect(s.status).toBe(201);
    const l = await api().post('/api/v1/auth/login').send({ email, password });
    expect(l.status).toBe(201);
    return { token: l.body.accessToken as string };
  }

  async function setupHospital(n: string) {
    const r = await api()
      .post('/api/v1/auth/register')
      .send({
        organizationName: `Org ${n} ${suffix}`,
        hospitalName: `Hospital ${n} ${suffix}`,
        firstName: 'Test',
        lastName: `Admin${n}`,
        email: `admin-${n.toLowerCase()}-${suffix}@ward.test`,
        password: 'IsolationPass#123',
      });
    expect(r.status).toBe(201);
    const adminToken = r.body.accessToken as string;
    const doctor = await createStaff(adminToken, n, 'DOCTOR', 'DoctorPass#12345');
    const nurse = await createStaff(adminToken, n, 'NURSE', 'NursePass#123456');
    const pharmacist = await createStaff(adminToken, n, 'PHARMACIST', 'PharmaPass#12345');
    return { adminToken, doctor, nurse, pharmacist };
  }

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;
  let wardA: string;

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

    A = await setupHospital('A');
    B = await setupHospital('B');

    const w = await api()
      .post('/api/v1/wards')
      .set(auth(A.adminToken))
      .send({ name: 'ICU' });
    expect(w.status).toBe(201);
    wardA = w.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin creates beds and the list shows them AVAILABLE', async () => {
    await api()
      .post(`/api/v1/wards/${wardA}/beds`)
      .set(auth(A.adminToken))
      .send({ label: 'Bed 1' })
      .expect(201);
    const res = await api().get('/api/v1/wards').set(auth(A.adminToken)).expect(200);
    const icu = res.body.find((w: { id: string }) => w.id === wardA);
    expect(icu.beds).toHaveLength(1);
    expect(icu.beds[0].status).toBe('AVAILABLE');
  });

  it('duplicate ward name and duplicate bed label return 409', async () => {
    await api()
      .post('/api/v1/wards')
      .set(auth(A.adminToken))
      .send({ name: 'ICU' })
      .expect(409);
    await api()
      .post(`/api/v1/wards/${wardA}/beds`)
      .set(auth(A.adminToken))
      .send({ label: 'Bed 1' })
      .expect(409);
  });

  it('hospital B sees no A wards and cannot add a bed to an A ward (404)', async () => {
    const res = await api().get('/api/v1/wards').set(auth(B.adminToken)).expect(200);
    expect(res.body).toEqual([]);
    await api()
      .post(`/api/v1/wards/${wardA}/beds`)
      .set(auth(B.adminToken))
      .send({ label: 'Sneaky' })
      .expect(404);
  });

  it('role rules: only admin writes, doctor and nurse read, pharmacist 403', async () => {
    await api()
      .post('/api/v1/wards')
      .set(auth(A.doctor.token))
      .send({ name: 'Doctor Ward' })
      .expect(403);
    await api()
      .post(`/api/v1/wards/${wardA}/beds`)
      .set(auth(A.nurse.token))
      .send({ label: 'Nurse Bed' })
      .expect(403);
    await api().get('/api/v1/wards').set(auth(A.doctor.token)).expect(200);
    await api().get('/api/v1/wards').set(auth(A.nurse.token)).expect(200);
    await api().get('/api/v1/wards').set(auth(A.pharmacist.token)).expect(403);
  });

  it('invalid input is rejected (400)', async () => {
    await api()
      .post('/api/v1/wards')
      .set(auth(A.adminToken))
      .send({ name: '' })
      .expect(400);
    await api()
      .post(`/api/v1/wards/${wardA}/beds`)
      .set(auth(A.adminToken))
      .send({ label: 'X', status: 'OCCUPIED' })
      .expect(400);
  });
});