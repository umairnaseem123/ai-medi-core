import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Laboratory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createStaff(
    adminToken: string,
    n: string,
    role: 'DOCTOR' | 'LAB_TECH',
    password: string,
  ) {
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@lab.test`;
    const s = await api()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send({
        firstName: role === 'DOCTOR' ? 'Doc' : 'Tech',
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
        email: `admin-${n.toLowerCase()}-${suffix}@lab.test`,
        password: 'IsolationPass#123',
      });
    expect(r.status).toBe(201);
    const adminToken = r.body.accessToken as string;

    const p = await api()
      .post('/api/v1/patients')
      .set(auth(adminToken))
      .send({ firstName: 'Pat', lastName: `Ient${n}`, dateOfBirth: '1990-01-01', gender: 'MALE' });
    expect(p.status).toBe(201);

    const doctor = await createStaff(adminToken, n, 'DOCTOR', 'DoctorPass#12345');
    const tech = await createStaff(adminToken, n, 'LAB_TECH', 'LabTechPass#12345');

    return {
      adminToken,
      doctor,
      tech,
      patientId: p.body.id as string,
      hospitalId: r.body.user.hospitalId as string,
    };
  }

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;
  let orderA: string;

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
      .post('/api/v1/lab-orders')
      .set(auth(A.doctor.token))
      .send({ patientId: A.patientId, testName: 'Synthetic CBC', priority: 'ROUTINE' });
    expect(o.status).toBe(201);
    orderA = o.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('doctor B cannot order a test for an A patient (400)', async () => {
    await api()
      .post('/api/v1/lab-orders')
      .set(auth(B.doctor.token))
      .send({ patientId: A.patientId, testName: 'Nope', priority: 'ROUTINE' })
      .expect(400);
  });

  it('doctor B gets 404 listing labs of an A patient', async () => {
    await api()
      .get(`/api/v1/lab-orders/patient/${A.patientId}`)
      .set(auth(B.doctor.token))
      .expect(404);
  });

  it("lab tech B queue does not contain A's order", async () => {
    const res = await api()
      .get('/api/v1/lab-orders/queue')
      .set(auth(B.tech.token))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('lab tech B cannot change status or enter a result on an A order (404)', async () => {
    await api()
      .patch(`/api/v1/lab-orders/${orderA}/status`)
      .set(auth(B.tech.token))
      .send({ status: 'IN_PROGRESS' })
      .expect(404);
    await api()
      .patch(`/api/v1/lab-orders/${orderA}/result`)
      .set(auth(B.tech.token))
      .send({ result: 'Forged result' })
      .expect(404);
  });

  it('role rules: admin 403 on lab data, doctor 403 on queue, tech 403 creating orders', async () => {
    await api()
      .get(`/api/v1/lab-orders/patient/${A.patientId}`)
      .set(auth(A.adminToken))
      .expect(403);
    await api()
      .get('/api/v1/lab-orders/queue')
      .set(auth(A.doctor.token))
      .expect(403);
    await api()
      .post('/api/v1/lab-orders')
      .set(auth(A.tech.token))
      .send({ patientId: A.patientId, testName: 'X', priority: 'ROUTINE' })
      .expect(403);
  });

  it('tech A completes the order, then it is closed (409) and audit logged', async () => {
    await api()
      .patch(`/api/v1/lab-orders/${orderA}/result`)
      .set(auth(A.tech.token))
      .send({ result: 'Synthetic result' })
      .expect(200);

    await api()
      .patch(`/api/v1/lab-orders/${orderA}/result`)
      .set(auth(A.tech.token))
      .send({ result: 'Second attempt' })
      .expect(409);

    const logs = await prisma.auditLog.findMany({
      where: { hospitalId: A.hospitalId, entity: 'LabOrder', entityId: orderA },
    });
    expect(logs.some((l) => l.action === 'CREATE')).toBe(true);
    expect(logs.some((l) => l.action === 'UPDATE')).toBe(true);
  });
});