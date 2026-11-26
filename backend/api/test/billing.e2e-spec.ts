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
  const newInvoice = async (token: string, patientId: string) =>
    (
      await api()
        .post('/api/v1/invoices')
        .set(auth(token))
        .send(inv(patientId))
        .expect(201)
    ).body.id as string;

  const pay = (token: string, id: string, amount: number, method = 'CASH') =>
    api()
      .post(`/api/v1/invoices/${id}/payments`)
      .set(auth(token))
      .send({ amount, method });

  const getInvoice = async (token: string, id: string) => {
    const res = await api().get('/api/v1/invoices').set(auth(token)).expect(200);
    return res.body.find((i: { id: string }) => i.id === id);
  };

  it('payments: partial then full closes the invoice, overpay and extra payments are refused', async () => {
    const id = await newInvoice(A.receptionist.token, A.patientId); // total 2000

    await pay(A.receptionist.token, id, 500).expect(201);
    let row = await getInvoice(A.adminToken, id);
    expect(row.paidAmount).toBe(500);
    expect(row.status).toBe('PENDING');

    await pay(A.receptionist.token, id, 2000).expect(409); // more than the 1500 left

    await pay(A.receptionist.token, id, 1500, 'CARD').expect(201);
    row = await getInvoice(A.adminToken, id);
    expect(row.paidAmount).toBe(2000);
    expect(row.status).toBe('PAID');

    await pay(A.receptionist.token, id, 1).expect(409); // already closed
  });

  it('payments: hospital B gets 404, doctor 403, bad input 400', async () => {
    const id = await newInvoice(A.adminToken, A.patientId);

    await pay(B.adminToken, id, 100).expect(404);
    await pay(A.doctor.token, id, 100).expect(403);
    await pay(A.adminToken, id, 0).expect(400);
    await pay(A.adminToken, id, 100, 'GOLD').expect(400);

    const row = await getInvoice(A.adminToken, id);
    expect(row.paidAmount).toBe(0);
  });

  it('payments: two at once that together exceed the total, only one wins', async () => {
    const id = await newInvoice(A.receptionist.token, A.patientId); // total 2000

    const [a, b] = await Promise.all([
      pay(A.receptionist.token, id, 1500),
      pay(A.adminToken, id, 1500),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    const row = await getInvoice(A.adminToken, id);
    expect(row.paidAmount).toBe(1500);
    expect(row.status).toBe('PENDING');
  });
});