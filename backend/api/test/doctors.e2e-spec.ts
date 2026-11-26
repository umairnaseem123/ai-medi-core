import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Doctor profiles (e2e)', () => {
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
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@doc.test`;
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
        email: `admin-${n.toLowerCase()}-${suffix}@doc.test`,
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

  it('doctor updates their own profile and the list shows it', async () => {
    await api()
      .put('/api/v1/doctors/me')
      .set(auth(A.doctor.token))
      .send({ specialization: 'Cardiology', licenseNumber: 'LIC-1' })
      .expect(200);

    const res = await api().get('/api/v1/doctors').set(auth(A.nurse.token)).expect(200);
    const me = res.body.find((d: { id: string }) => d.id === A.doctor.id);
    expect(me.doctorProfile.specialization).toBe('Cardiology');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('email');
  });

  it('a second update changes the same profile (no duplicate)', async () => {
    await api()
      .put('/api/v1/doctors/me')
      .set(auth(A.doctor.token))
      .send({ specialization: 'Neurology' })
      .expect(200);
    const res = await api().get('/api/v1/doctors').set(auth(A.adminToken)).expect(200);
    const mine = res.body.filter((d: { id: string }) => d.id === A.doctor.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].doctorProfile.specialization).toBe('Neurology');
  });

  it('admin can update a doctor, but not a non-doctor (404)', async () => {
    await api()
      .put(`/api/v1/doctors/${A.doctor.id}`)
      .set(auth(A.adminToken))
      .send({ specialization: 'Pediatrics' })
      .expect(200);
    await api()
      .put(`/api/v1/doctors/${A.nurse.id}`)
      .set(auth(A.adminToken))
      .send({ specialization: 'Pediatrics' })
      .expect(404);
  });

  it('hospital B gets 404 on an A doctor and sees none in its list', async () => {
    await api()
      .put(`/api/v1/doctors/${A.doctor.id}`)
      .set(auth(B.adminToken))
      .send({ specialization: 'Hacked' })
      .expect(404);
    const res = await api().get('/api/v1/doctors').set(auth(B.adminToken)).expect(200);
    expect(res.body.some((d: { id: string }) => d.id === A.doctor.id)).toBe(false);
  });

  it('role rules: nurse cannot write, pharmacist cannot read', async () => {
    await api()
      .put('/api/v1/doctors/me')
      .set(auth(A.nurse.token))
      .send({ specialization: 'Nope' })
      .expect(403);
    await api()
      .put(`/api/v1/doctors/${A.doctor.id}`)
      .set(auth(A.nurse.token))
      .send({ specialization: 'Nope' })
      .expect(403);
    await api().get('/api/v1/doctors').set(auth(A.pharmacist.token)).expect(403);
  });

  it('invalid input is rejected (400)', async () => {
    await api()
      .put('/api/v1/doctors/me')
      .set(auth(A.doctor.token))
      .send({ specialization: '' })
      .expect(400);
    await api()
      .put('/api/v1/doctors/me')
      .set(auth(A.doctor.token))
      .send({ specialization: 'Surgery', hospitalId: 'x' })
      .expect(400);
  });
});