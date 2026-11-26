import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Medical records (e2e)', () => {
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
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@rec.test`;
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
        email: `admin-${n.toLowerCase()}-${suffix}@rec.test`,
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

  it('a patient with no record yet returns an empty summary', async () => {
    const res = await api()
      .get(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.doctor.token))
      .expect(200);
    expect(res.body.patientId).toBe(A.patientId);
    expect(res.body.bloodGroup).toBeNull();
  });

  it('doctor writes the record, nurse reads it, and the read is audit logged', async () => {
    await api()
      .put(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.doctor.token))
      .send({ bloodGroup: 'O+', allergies: 'Penicillin', chronicConditions: 'Asthma' })
      .expect(200);

    const res = await api()
      .get(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.nurse.token))
      .expect(200);
    expect(res.body.bloodGroup).toBe('O+');
    expect(res.body.allergies).toBe('Penicillin');

    const logs = await prisma.auditLog.findMany({
      where: { hospitalId: A.hospitalId, entity: 'Patient', entityId: A.patientId, action: 'READ' },
    });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('a second write updates the same record (no duplicate)', async () => {
    await api()
      .put(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.doctor.token))
      .send({ bloodGroup: 'A-' })
      .expect(200);
    const count = await prisma.medicalRecord.count({
      where: { patientId: A.patientId },
    });
    expect(count).toBe(1);
    const res = await api()
      .get(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.doctor.token))
      .expect(200);
    expect(res.body.bloodGroup).toBe('A-');
  });

  it('hospital B gets 404 on an A patient, for read and write', async () => {
    await api()
      .get(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(B.doctor.token))
      .expect(404);
    await api()
      .put(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(B.doctor.token))
      .send({ bloodGroup: 'B+' })
      .expect(404);
  });

  it('role rules: admin 403, nurse cannot write, pharmacist 403', async () => {
    await api()
      .get(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.adminToken))
      .expect(403);
    await api()
      .put(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.nurse.token))
      .send({ bloodGroup: 'B+' })
      .expect(403);
    await api()
      .get(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.pharmacist.token))
      .expect(403);
  });

  it('invalid input is rejected (400)', async () => {
    await api()
      .put(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.doctor.token))
      .send({ bloodGroup: 'Z+' })
      .expect(400);
    await api()
      .put(`/api/v1/medical-records/patient/${A.patientId}`)
      .set(auth(A.doctor.token))
      .send({ allergies: 'None', hospitalId: 'x' })
      .expect(400);
  });
});