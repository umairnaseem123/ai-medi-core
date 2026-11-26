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

  const newBed = async (token: string, ward: string) =>
    (
      await api()
        .post(`/api/v1/wards/${ward}/beds`)
        .set(auth(token))
        .send({ label: `B-${Math.random().toString(36).slice(2, 8)}` })
        .expect(201)
    ).body.id as string;

  const admit = (token: string, bedId: string, patientId: string) =>
    api()
      .post(`/api/v1/wards/beds/${bedId}/admit`)
      .set(auth(token))
      .send({ patientId });

  const discharge = (token: string, admissionId: string) =>
    api()
      .post(`/api/v1/wards/admissions/${admissionId}/discharge`)
      .set(auth(token));

  const bedStatus = async (token: string, bedId: string) => {
    const res = await api().get('/api/v1/wards').set(auth(token)).expect(200);
    for (const w of res.body) {
      const b = w.beds.find((x: { id: string }) => x.id === bedId);
      if (b) return b.status as string;
    }
    return undefined;
  };

  it('admit: one bed per patient and one patient per bed, discharge frees the bed', async () => {
    const bed1 = await newBed(A.adminToken, wardA);
    const bed2 = await newBed(A.adminToken, wardA);
    const p1 = await newPatient(A.adminToken, 'AdmitOne');
    const p2 = await newPatient(A.adminToken, 'AdmitTwo');

    const a = await admit(A.nurse.token, bed1, p1).expect(201);
    expect(await bedStatus(A.adminToken, bed1)).toBe('OCCUPIED');

    await admit(A.nurse.token, bed2, p1).expect(409); // already admitted
    await admit(A.nurse.token, bed1, p2).expect(409); // bed taken

    await discharge(A.nurse.token, a.body.id).expect(201);
    expect(await bedStatus(A.adminToken, bed1)).toBe('AVAILABLE');
    await discharge(A.nurse.token, a.body.id).expect(409); // already discharged

    await admit(A.doctor.token, bed1, p2).expect(201); // bed is reusable
  });

  it('admit: hospital B gets 404 on A beds and admissions, pharmacist 403', async () => {
    const bed = await newBed(A.adminToken, wardA);
    const p = await newPatient(A.adminToken, 'AdmitIso');
    const pB = await newPatient(B.adminToken, 'AdmitIsoB');

    await admit(B.adminToken, bed, pB).expect(404);
    await admit(A.pharmacist.token, bed, p).expect(403);

    const a = await admit(A.adminToken, bed, p).expect(201);
    await discharge(B.adminToken, a.body.id).expect(404);
    await discharge(A.pharmacist.token, a.body.id).expect(403);
    expect(await bedStatus(A.adminToken, bed)).toBe('OCCUPIED');
  });

  it('admit: two patients racing for one bed, only one wins', async () => {
    const bed = await newBed(A.adminToken, wardA);
    const p1 = await newPatient(A.adminToken, 'RaceOne');
    const p2 = await newPatient(A.adminToken, 'RaceTwo');

    const [x, y] = await Promise.all([
      admit(A.nurse.token, bed, p1),
      admit(A.doctor.token, bed, p2),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await bedStatus(A.adminToken, bed)).toBe('OCCUPIED');
  });
});