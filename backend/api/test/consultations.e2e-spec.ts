import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Consultations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setupHospital(n: string) {
    const r = await api()
      .post('/api/v1/auth/register')
      .send({
        organizationName: `Org ${n} ${suffix}`,
        hospitalName: `Hospital ${n} ${suffix}`,
        firstName: 'Test',
        lastName: `Admin${n}`,
        email: `admin-${n.toLowerCase()}-${suffix}@consult.test`,
        password: 'IsolationPass#123',
      });
    expect(r.status).toBe(201);
    const adminToken = r.body.accessToken as string;

    const p = await api()
      .post('/api/v1/patients')
      .set(auth(adminToken))
      .send({ firstName: 'Pat', lastName: `Ient${n}`, dateOfBirth: '1990-01-01', gender: 'MALE' });
    expect(p.status).toBe(201);

    const docEmail = `doc-${n.toLowerCase()}-${suffix}@consult.test`;
    const d = await api()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send({
        firstName: 'Doc',
        lastName: `Tor${n}`,
        email: docEmail,
        password: 'DoctorPass#12345',
        role: 'DOCTOR',
      });
    expect(d.status).toBe(201);

    const l = await api()
      .post('/api/v1/auth/login')
      .send({ email: docEmail, password: 'DoctorPass#12345' });
    expect(l.status).toBe(201);

    return {
      adminToken,
      doctorToken: l.body.accessToken as string,
      doctorId: d.body.id as string,
      patientId: p.body.id as string,
      hospitalId: r.body.user.hospitalId as string,
    };
  }

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
    prisma = app.get(PrismaService);

    A = await setupHospital('A');
    B = await setupHospital('B');
  });

  afterAll(async () => {
    await app.close();
  });

  it('doctor A can write a consultation for an A patient', async () => {
    const res = await api()
      .post('/api/v1/consultations')
      .set(auth(A.doctorToken))
      .send({ patientId: A.patientId, complaint: 'Synthetic complaint' });
    expect(res.status).toBe(201);
  });

  it('doctor B cannot write for an A patient (400)', async () => {
    await api()
      .post('/api/v1/consultations')
      .set(auth(B.doctorToken))
      .send({ patientId: A.patientId, complaint: 'Should not work' })
      .expect(400);
  });

  it('doctor B sees no consultations for an A patient', async () => {
    const res = await api()
      .get(`/api/v1/consultations/patient/${A.patientId}`)
      .set(auth(B.doctorToken))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('hospital admin gets 403 on clinical data (read and write)', async () => {
    await api()
      .get(`/api/v1/consultations/patient/${A.patientId}`)
      .set(auth(A.adminToken))
      .expect(403);
    await api()
      .post('/api/v1/consultations')
      .set(auth(A.adminToken))
      .send({ patientId: A.patientId, complaint: 'Admin should not write' })
      .expect(403);
  });

  it('reads and writes are audit logged', async () => {
    await api()
      .get(`/api/v1/consultations/patient/${A.patientId}`)
      .set(auth(A.doctorToken))
      .expect(200);

    const logs = await prisma.auditLog.findMany({
      where: { hospitalId: A.hospitalId },
    });
    expect(logs.some((l) => l.action === 'CREATE' && l.entity === 'Consultation')).toBe(true);
    expect(
      logs.some(
        (l) =>
          l.action === 'READ' &&
          l.entity === 'Patient' &&
          l.entityId === A.patientId &&
          l.userId === A.doctorId,
      ),
    ).toBe(true);
  });
});