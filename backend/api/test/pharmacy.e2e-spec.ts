import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Pharmacy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createStaff(
    adminToken: string,
    n: string,
    role: 'DOCTOR' | 'PHARMACIST',
    password: string,
  ) {
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@pharm.test`;
    const s = await api()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send({
        firstName: role === 'DOCTOR' ? 'Doc' : 'Pharm',
        lastName: `Staff${n}`,
        email,
        password,
        role,
      });
    expect(s.status).toBe(201);
    const l = await api().post('/api/v1/auth/login').send({ email, password });
    expect(l.status).toBe(201);
    return { token: l.body.accessToken as string, id: s.body.id as string };
  }

  async function setupHospital(n: string) {
    const r = await api()
      .post('/api/v1/auth/register')
      .send({
        organizationName: `Org ${n} ${suffix}`,
        hospitalName: `Hospital ${n} ${suffix}`,
        firstName: 'Test',
        lastName: `Admin${n}`,
        email: `admin-${n.toLowerCase()}-${suffix}@pharm.test`,
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
    const pharmacist = await createStaff(
      adminToken,
      n,
      'PHARMACIST',
      'PharmaPass#12345',
    );

    return {
      adminToken,
      doctor,
      pharmacist,
      patientId: p.body.id as string,
      hospitalId: r.body.user.hospitalId as string,
    };
  }

  const rx = (patientId: string) => ({
    patientId,
    items: [
      {
        medicine: 'Synthetic Med 100mg',
        dose: '1 tablet',
        frequency: 'Daily',
        durationDays: 3,
      },
    ],
  });

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;
  let rxA: string;

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
    prisma = app.get(PrismaService);

    A = await setupHospital('A');
    B = await setupHospital('B');

    const o = await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.doctor.token))
      .send(rx(A.patientId));
    expect(o.status).toBe(201);
    rxA = o.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('doctor B cannot prescribe for an A patient (400)', async () => {
    await api()
      .post('/api/v1/prescriptions')
      .set(auth(B.doctor.token))
      .send(rx(A.patientId))
      .expect(400);
  });

  it('doctor B gets 404 listing prescriptions of an A patient', async () => {
    await api()
      .get(`/api/v1/prescriptions/patient/${A.patientId}`)
      .set(auth(B.doctor.token))
      .expect(404);
  });

  it("pharmacist B queue does not contain A's prescription", async () => {
    const res = await api()
      .get('/api/v1/prescriptions/queue')
      .set(auth(B.pharmacist.token))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('pharmacist B cannot dispense an A prescription (404)', async () => {
    await api()
      .patch(`/api/v1/prescriptions/${rxA}/status`)
      .set(auth(B.pharmacist.token))
      .send({ status: 'DISPENSED' })
      .expect(404);
  });

  it('role rules: admin 403 on prescriptions, doctor 403 on queue, pharmacist 403 prescribing', async () => {
    await api()
      .get(`/api/v1/prescriptions/patient/${A.patientId}`)
      .set(auth(A.adminToken))
      .expect(403);
    await api()
      .get('/api/v1/prescriptions/queue')
      .set(auth(A.doctor.token))
      .expect(403);
    await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.pharmacist.token))
      .send(rx(A.patientId))
      .expect(403);
  });

  it('invalid items are rejected (400)', async () => {
    await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.doctor.token))
      .send({ patientId: A.patientId, items: [] })
      .expect(400);
  });

  it('pharmacist A dispenses, then it is closed (409) and audit logged', async () => {
    // Dispensing deducts stock, so the medicine must exist with stock
    const med = await api()
      .post('/api/v1/inventory')
      .set(auth(A.pharmacist.token))
      .send({ name: 'Synthetic Med 100mg', unit: 'tablet' })
      .expect(201);
    await api()
      .post(`/api/v1/inventory/${med.body.id}/receive`)
      .set(auth(A.pharmacist.token))
      .send({ quantity: 10 })
      .expect(201);

    await api()
      .patch(`/api/v1/prescriptions/${rxA}/status`)
      .set(auth(A.pharmacist.token))
      .send({ status: 'DISPENSED' })
      .expect(200);

    await api()
      .patch(`/api/v1/prescriptions/${rxA}/status`)
      .set(auth(A.pharmacist.token))
      .send({ status: 'DISPENSED' })
      .expect(409);

    const logs = await prisma.auditLog.findMany({
      where: { hospitalId: A.hospitalId, entity: 'Prescription', entityId: rxA },
    });
    expect(logs.some((l) => l.action === 'CREATE')).toBe(true);
    expect(logs.some((l) => l.action === 'UPDATE')).toBe(true);
  });
});