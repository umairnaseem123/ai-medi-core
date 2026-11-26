import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Care records (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createStaff(
    adminToken: string,
    n: string,
    role: 'DOCTOR' | 'NURSE' | 'PHARMACIST',
    password: string,
  ) {
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@care.test`;
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
        email: `admin-${n.toLowerCase()}-${suffix}@care.test`,
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
    const nurse = await createStaff(adminToken, n, 'NURSE', 'NursePass#123456');
    const pharmacist = await createStaff(adminToken, n, 'PHARMACIST', 'PharmaPass#12345');

    return {
      adminToken,
      doctor,
      nurse,
      pharmacist,
      patientId: p.body.id as string,
      hospitalId: r.body.user.hospitalId as string,
    };
  }

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;

  const url = (patientId: string) => `/api/v1/care-records/patient/${patientId}`;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('nurse and doctor both record entries, and the list is newest first', async () => {
    const first = await api()
      .post(url(A.patientId))
      .set(auth(A.nurse.token))
      .send({ systolic: 120, diastolic: 80, pulse: 72, temperatureC: 36.6, oxygenSat: 98 })
      .expect(201);
    expect(first.body.systolic).toBe(120);
    expect(first.body.recordedBy.role).toBe('NURSE');

    await new Promise((r) => setTimeout(r, 25));
    await api()
      .post(url(A.patientId))
      .set(auth(A.doctor.token))
      .send({ note: 'Patient resting comfortably' })
      .expect(201);

    const res = await api().get(url(A.patientId)).set(auth(A.doctor.token)).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].note).toBe('Patient resting comfortably');
    expect(res.body[1].pulse).toBe(72);
  });

  it('reading the history is audit logged', async () => {
    const logs = await prisma.auditLog.findMany({
      where: { hospitalId: A.hospitalId, entity: 'Patient', entityId: A.patientId, action: 'READ' },
    });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('an empty record is rejected (400)', async () => {
    await api().post(url(A.patientId)).set(auth(A.nurse.token)).send({}).expect(400);
    await api().post(url(A.patientId)).set(auth(A.nurse.token)).send({ note: '   ' }).expect(400);
  });

  it('blood pressure needs both values and diastolic below systolic (400)', async () => {
    await api().post(url(A.patientId)).set(auth(A.nurse.token)).send({ systolic: 120 }).expect(400);
    await api()
      .post(url(A.patientId))
      .set(auth(A.nurse.token))
      .send({ systolic: 80, diastolic: 120 })
      .expect(400);
  });

  it('out of range values and unknown fields are rejected (400)', async () => {
    await api().post(url(A.patientId)).set(auth(A.nurse.token)).send({ pulse: 900 }).expect(400);
    await api().post(url(A.patientId)).set(auth(A.nurse.token)).send({ oxygenSat: 150 }).expect(400);
    await api()
      .post(url(A.patientId))
      .set(auth(A.nurse.token))
      .send({ note: 'ok', hospitalId: 'x' })
      .expect(400);
  });

  it('hospital B gets 404 on an A patient, for write and read', async () => {
    await api().post(url(A.patientId)).set(auth(B.nurse.token)).send({ note: 'sneaky' }).expect(404);
    await api().get(url(A.patientId)).set(auth(B.doctor.token)).expect(404);
  });

  it('role rules: admin and pharmacist get 403', async () => {
    await api().get(url(A.patientId)).set(auth(A.adminToken)).expect(403);
    await api().post(url(A.patientId)).set(auth(A.adminToken)).send({ note: 'x' }).expect(403);
    await api().get(url(A.patientId)).set(auth(A.pharmacist.token)).expect(403);
    await api().post(url(A.patientId)).set(auth(A.pharmacist.token)).send({ note: 'x' }).expect(403);
  });
});