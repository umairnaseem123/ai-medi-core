import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Patient portal login (e2e)', () => {
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
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@portal.test`;
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
        email: `admin-${n.toLowerCase()}-${suffix}@portal.test`,
        password: 'IsolationPass#123',
      });
    expect(r.status).toBe(201);
    const adminToken = r.body.accessToken as string;
    const doctor = await createStaff(adminToken, n, 'DOCTOR', 'DoctorPass#12345');
    const receptionist = await createStaff(
      adminToken,
      n,
      'RECEPTIONIST',
      'ReceptPass#12345',
    );
    return { adminToken, doctor, receptionist };
  }

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;

  const newPatient = async (token: string, tag: string) =>
    (
      await api()
        .post('/api/v1/patients')
        .set(auth(token))
        .send({
          firstName: 'Pat',
          lastName: `${tag}${Math.random().toString(36).slice(2, 7)}`,
          dateOfBirth: '1990-01-01',
          gender: 'MALE',
        })
        .expect(201)
    ).body.id as string;

  const makeLogin = (token: string, patientId: string, email: string, password = 'PatientPass#12345') =>
    api()
      .post(`/api/v1/patients/${patientId}/login`)
      .set(auth(token))
      .send({ email, password });

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

  it('receptionist creates a login, the patient can sign in, and is blocked from staff routes', async () => {
    const id = await newPatient(A.adminToken, 'LoginOne');
    const email = `patient-one-${suffix}@portal.test`;

    const res = await makeLogin(A.receptionist.token, id, email).expect(201);
    expect(res.body.role).toBe('PATIENT');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: 'PatientPass#12345' });
    expect(login.status).toBe(201);

    await api()
      .get('/api/v1/patients')
      .set(auth(login.body.accessToken))
      .expect(403);
  });

  it('a second login for the same patient returns 409', async () => {
    const id = await newPatient(A.adminToken, 'LoginTwo');
    await makeLogin(A.adminToken, id, `patient-two-${suffix}@portal.test`).expect(201);
    await makeLogin(A.adminToken, id, `patient-two-b-${suffix}@portal.test`).expect(409);
  });

  it('an email that is already registered returns 409', async () => {
    const id = await newPatient(A.adminToken, 'LoginThree');
    await makeLogin(A.adminToken, id, `admin-a-${suffix}@portal.test`).expect(409);
  });

  it('a short password or unknown fields are rejected (400)', async () => {
    const id = await newPatient(A.adminToken, 'LoginFour');
    await makeLogin(A.adminToken, id, `patient-four-${suffix}@portal.test`, 'short').expect(400);
    await api()
      .post(`/api/v1/patients/${id}/login`)
      .set(auth(A.adminToken))
      .send({
        email: `patient-four-${suffix}@portal.test`,
        password: 'PatientPass#12345',
        role: 'HOSPITAL_ADMIN',
      })
      .expect(400);
  });

  it('hospital B gets 404 on an A patient, doctor gets 403', async () => {
    const id = await newPatient(A.adminToken, 'LoginFive');
    await makeLogin(B.adminToken, id, `patient-five-${suffix}@portal.test`).expect(404);
    await makeLogin(A.doctor.token, id, `patient-five-${suffix}@portal.test`).expect(403);
  });

  it('two logins created at once for one patient, only one wins', async () => {
    const id = await newPatient(A.adminToken, 'LoginRace');
    const [x, y] = await Promise.all([
      makeLogin(A.receptionist.token, id, `race-x-${suffix}@portal.test`),
      makeLogin(A.adminToken, id, `race-y-${suffix}@portal.test`),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });
});