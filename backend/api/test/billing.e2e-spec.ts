import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Billing (e2e)', () => {
  let app: INestApplication;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createStaff(
    adminToken: string,
    n: string,
    role: 'DOCTOR' | 'RECEPTIONIST',
    password: string,
  ) {
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@bill.test`;
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
        email: `admin-${n.toLowerCase()}-${suffix}@bill.test`,
        password: 'IsolationPass#123',
      });
    expect(r.status).toBe(201);
    const adminToken = r.body.accessToken as string;

    const p = await api()
      .post('/api/v1/patients')
      .set(auth(adminToken))
      .send({
        firstName: 'Pat',
        lastName: `Ient${n}`,
        dateOfBirth: '1990-01-01',
        gender: 'MALE',
      });
    expect(p.status).toBe(201);

    const doctor = await createStaff(adminToken, n, 'DOCTOR', 'DoctorPass#12345');
    const receptionist = await createStaff(
      adminToken,
      n,
      'RECEPTIONIST',
      'ReceptPass#12345',
    );

    return { adminToken, doctor, receptionist, patientId: p.body.id as string };
  }

  const inv = (patientId: string) => ({
    patientId,
    items: [
      { description: 'Consultation', quantity: 2, unitPrice: 500 },
      { description: 'Blood test', quantity: 1, unitPrice: 1000 },
    ],
  });

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('server computes the total and starts PENDING', async () => {
    const res = await api()
      .post('/api/v1/invoices')
      .set(auth(A.receptionist.token))
      .send(inv(A.patientId))
      .expect(201);
    expect(res.body.total).toBe(2000);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.paidAmount).toBe(0);
    expect(res.body.items).toHaveLength(2);
  });

  it('client cannot send its own total (400)', async () => {
    await api()
      .post('/api/v1/invoices')
      .set(auth(A.adminToken))
      .send({ ...inv(A.patientId), total: 1 })
      .expect(400);
  });

  it('invalid items are rejected (400)', async () => {
    await api()
      .post('/api/v1/invoices')
      .set(auth(A.adminToken))
      .send({ patientId: A.patientId, items: [] })
      .expect(400);
    await api()
      .post('/api/v1/invoices')
      .set(auth(A.adminToken))
      .send({
        patientId: A.patientId,
        items: [{ description: 'Free', quantity: 1, unitPrice: 0 }],
      })
      .expect(400);
  });

  it('hospital B cannot invoice an A patient (400) and sees no A invoices', async () => {
    await api()
      .post('/api/v1/invoices')
      .set(auth(B.adminToken))
      .send(inv(A.patientId))
      .expect(400);
    const res = await api()
      .get('/api/v1/invoices')
      .set(auth(B.adminToken))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('role rules: doctor 403, receptionist and admin allowed', async () => {
    await api().get('/api/v1/invoices').set(auth(A.doctor.token)).expect(403);
    await api()
      .post('/api/v1/invoices')
      .set(auth(A.doctor.token))
      .send(inv(A.patientId))
      .expect(403);
    await api().get('/api/v1/invoices').set(auth(A.receptionist.token)).expect(200);
    await api().get('/api/v1/invoices').set(auth(A.adminToken)).expect(200);
  });
});