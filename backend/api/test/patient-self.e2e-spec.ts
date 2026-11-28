import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Patient self-service (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PW = 'PatientPass#12345';

  async function createStaff(
    adminToken: string,
    n: string,
    role: 'DOCTOR' | 'RECEPTIONIST',
    password: string,
  ) {
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@self.test`;
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
        email: `admin-${n.toLowerCase()}-${suffix}@self.test`,
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
    return {
      adminToken,
      doctor,
      receptionist,
      hospitalId: r.body.user.hospitalId as string,
    };
  }

  // Creates a patient, gives it a login, signs in, returns what the tests need
  async function patientWithLogin(
    adminToken: string,
    tag: string,
  ) {
    const p = await api()
      .post('/api/v1/patients')
      .set(auth(adminToken))
      .send({
        firstName: 'Pat',
        lastName: `${tag}${Math.random().toString(36).slice(2, 7)}`,
        dateOfBirth: '1990-01-01',
        gender: 'MALE',
      });
    expect(p.status).toBe(201);
    const email = `${tag.toLowerCase()}-${suffix}@self.test`;
    await api()
      .post(`/api/v1/patients/${p.body.id}/login`)
      .set(auth(adminToken))
      .send({ email, password: PW })
      .expect(201);
    const l = await api().post('/api/v1/auth/login').send({ email, password: PW });
    expect(l.status).toBe(201);
    return { patientId: p.body.id as string, token: l.body.accessToken as string };
  }

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;
  let P1: Awaited<ReturnType<typeof patientWithLogin>>;
  let P2: Awaited<ReturnType<typeof patientWithLogin>>;
  let PB: Awaited<ReturnType<typeof patientWithLogin>>;

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
    P1 = await patientWithLogin(A.adminToken, 'SelfOne');
    P2 = await patientWithLogin(A.adminToken, 'SelfTwo');
    PB = await patientWithLogin(B.adminToken, 'SelfB');

    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 1_800_000);
    for (const [pid, reason] of [
      [P1.patientId, 'reason-for-patient-one'],
      [P2.patientId, 'reason-for-patient-two'],
    ] as const) {
      await prisma.appointment.create({
        data: {
          hospitalId: A.hospitalId,
          patientId: pid,
          doctorId: A.doctor.id,
          startsAt: start,
          endsAt: end,
          reason,
        },
      });
      await api()
        .post('/api/v1/prescriptions')
        .set(auth(A.doctor.token))
        .send({
          patientId: pid,
          notes: 'internal doctor note',
          items: [
            {
              medicine: `Med for ${reason}`,
              dose: '1 tablet',
              frequency: 'Daily',
              durationDays: 3,
            },
          ],
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('patient one sees only their own appointments', async () => {
    const res = await api().get('/api/v1/me/appointments').set(auth(P1.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reason).toBe('reason-for-patient-one');
    expect(JSON.stringify(res.body)).not.toContain('patient-two');
  });

  it('patient two sees only their own prescriptions, without internal fields', async () => {
    const res = await api().get('/api/v1/me/prescriptions').set(auth(P2.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].items[0].medicine).toContain('patient-two');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('patient-one');
    expect(text).not.toContain('internal doctor note');
    expect(text).not.toContain('hospitalId');
    expect(text).not.toContain('prescriberId');
  });

  it("a patient from hospital B sees none of hospital A's data", async () => {
    const a = await api().get('/api/v1/me/appointments').set(auth(PB.token)).expect(200);
    const p = await api().get('/api/v1/me/prescriptions').set(auth(PB.token)).expect(200);
    expect(a.body).toEqual([]);
    expect(p.body).toEqual([]);
  });

  it('staff roles get 403 on the patient routes', async () => {
    for (const token of [A.adminToken, A.doctor.token, A.receptionist.token]) {
      await api().get('/api/v1/me/appointments').set(auth(token)).expect(403);
      await api().get('/api/v1/me/prescriptions').set(auth(token)).expect(403);
    }
  });

  it('no token returns 401', async () => {
    await api().get('/api/v1/me/appointments').expect(401);
    await api().get('/api/v1/me/prescriptions').expect(401);
  });

  it('a patient is blocked from the staff routes of other modules', async () => {
    await api().get('/api/v1/prescriptions/queue').set(auth(P1.token)).expect(403);
    await api().get('/api/v1/invoices').set(auth(P1.token)).expect(403);
    await api().get('/api/v1/wards').set(auth(P1.token)).expect(403);
    await api()
      .get(`/api/v1/medical-records/patient/${P2.patientId}`)
      .set(auth(P1.token))
      .expect(403);
  });

  it('reading own data is audit logged', async () => {
    const logs = await prisma.auditLog.findMany({
      where: {
        hospitalId: A.hospitalId,
        entity: 'Patient',
        entityId: P1.patientId,
        action: 'READ',
      },
    });
    expect(logs.length).toBeGreaterThan(0);
  });
  const labOrder = (patientId: string, testName: string, released: boolean) =>
    prisma.labOrder.create({
      data: {
        hospitalId: A.hospitalId,
        patientId,
        orderedById: A.doctor.id,
        testName,
        status: 'COMPLETED',
        result: `result of ${testName}`,
        resultAt: new Date(),
        ...(released ? { releasedAt: new Date(), releasedById: A.doctor.id } : {}),
      },
    });

  it('lab-results: patient sees only their own released results, without internal fields', async () => {
    await labOrder(P1.patientId, 'released-one', true);
    await labOrder(P1.patientId, 'unreleased-one', false);
    await labOrder(P2.patientId, 'released-two', true);

    const res = await api().get('/api/v1/me/lab-results').set(auth(P1.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].testName).toBe('released-one');

    const text = JSON.stringify(res.body);
    expect(text).not.toContain('unreleased-one');
    expect(text).not.toContain('released-two');
    expect(text).not.toContain('hospitalId');
    expect(text).not.toContain('resultById');
    expect(text).not.toContain('releasedById');
  });

  it('lab-results: a patient from hospital B sees nothing from hospital A', async () => {
    const res = await api().get('/api/v1/me/lab-results').set(auth(PB.token)).expect(200);
    expect(res.body).toEqual([]);
  });

  it('lab-results: staff get 403 and no token gets 401', async () => {
    for (const token of [A.adminToken, A.doctor.token, A.receptionist.token]) {
      await api().get('/api/v1/me/lab-results').set(auth(token)).expect(403);
    }
    await api().get('/api/v1/me/lab-results').expect(401);
  });
  const makeInvoice = async (patientId: string, description: string) =>
    (
      await api()
        .post('/api/v1/invoices')
        .set(auth(A.adminToken))
        .send({ patientId, items: [{ description, quantity: 2, unitPrice: 500 }] })
        .expect(201)
    ).body.id as string;

  it('invoices: patient sees only their own invoices with items and payments, without internal fields', async () => {
    const inv1 = await makeInvoice(P1.patientId, 'invoice-item-one');
    await makeInvoice(P2.patientId, 'invoice-item-two');
    await api()
      .post(`/api/v1/invoices/${inv1}/payments`)
      .set(auth(A.adminToken))
      .send({ amount: 400, method: 'CASH' })
      .expect(201);

    const res = await api().get('/api/v1/me/invoices').set(auth(P1.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].total).toBe(1000);
    expect(res.body[0].paidAmount).toBe(400);
    expect(res.body[0].status).toBe('PENDING');
    expect(res.body[0].items[0].description).toBe('invoice-item-one');
    expect(res.body[0].payments).toHaveLength(1);

    const text = JSON.stringify(res.body);
    expect(text).not.toContain('invoice-item-two');
    expect(text).not.toContain('hospitalId');
    expect(text).not.toContain('createdById');
    expect(text).not.toContain('receivedById');
  });

  it('invoices: a patient from hospital B sees nothing from hospital A', async () => {
    const res = await api().get('/api/v1/me/invoices').set(auth(PB.token)).expect(200);
    expect(res.body).toEqual([]);
  });

  it('invoices: staff get 403 and no token gets 401', async () => {
    for (const token of [A.adminToken, A.doctor.token, A.receptionist.token]) {
      await api().get('/api/v1/me/invoices').set(auth(token)).expect(403);
    }
    await api().get('/api/v1/me/invoices').expect(401);
  });
});