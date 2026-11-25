import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Inventory (e2e)', () => {
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
    const email = `${role.toLowerCase()}-${n.toLowerCase()}-${suffix}@inv.test`;
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
        email: `admin-${n.toLowerCase()}-${suffix}@inv.test`,
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
    const pharmacist = await createStaff(adminToken, n, 'PHARMACIST', 'PharmaPass#12345');

    return {
      adminToken,
      doctor,
      pharmacist,
      patientId: p.body.id as string,
      hospitalId: r.body.user.hospitalId as string,
    };
  }

  const rx = (patientId: string, medicine: string) => ({
    patientId,
    items: [{ medicine, dose: '1 tablet', frequency: 'Daily', durationDays: 3 }],
  });

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;
  let medA: string;

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

    const m = await api()
      .post('/api/v1/inventory')
      .set(auth(A.pharmacist.token))
      .send({ name: `Synth Med ${suffix}`, unit: 'tablet', reorderAt: 2 });
    expect(m.status).toBe(201);
    medA = m.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("pharmacist B list does not contain A's medicine", async () => {
    const res = await api()
      .get('/api/v1/inventory')
      .set(auth(B.pharmacist.token))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('pharmacist B cannot receive stock on an A medicine (404)', async () => {
    await api()
      .post(`/api/v1/inventory/${medA}/receive`)
      .set(auth(B.pharmacist.token))
      .send({ quantity: 5 })
      .expect(404);
  });

  it('role rules: doctor 403, admin can read but not write', async () => {
    await api().get('/api/v1/inventory').set(auth(A.doctor.token)).expect(403);
    await api().get('/api/v1/inventory').set(auth(A.adminToken)).expect(200);
    await api()
      .post('/api/v1/inventory')
      .set(auth(A.adminToken))
      .send({ name: 'Admin Med', unit: 'tablet' })
      .expect(403);
  });

  it('duplicate medicine name returns 409', async () => {
    await api()
      .post('/api/v1/inventory')
      .set(auth(A.pharmacist.token))
      .send({ name: `Synth Med ${suffix}`, unit: 'tablet' })
      .expect(409);
  });

  it('dispensing a medicine not in inventory returns 409 and stays PENDING', async () => {
    const p = await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.doctor.token))
      .send(rx(A.patientId, 'Unknown Medicine XYZ'))
      .expect(201);
    await api()
      .patch(`/api/v1/prescriptions/${p.body.id}/status`)
      .set(auth(A.pharmacist.token))
      .send({ status: 'DISPENSED' })
      .expect(409);
    const row = await prisma.prescription.findUnique({ where: { id: p.body.id } });
    expect(row?.status).toBe('PENDING');
  });

  it('stock never goes negative when two dispenses race (only one wins)', async () => {
    await api()
      .post(`/api/v1/inventory/${medA}/receive`)
      .set(auth(A.pharmacist.token))
      .send({ quantity: 1, reason: 'one unit only' })
      .expect(201);

    const name = `Synth Med ${suffix}`;
    const r1 = await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.doctor.token))
      .send(rx(A.patientId, name))
      .expect(201);
    const r2 = await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.doctor.token))
      .send(rx(A.patientId, name))
      .expect(201);

    const [a, b] = await Promise.all([
      api()
        .patch(`/api/v1/prescriptions/${r1.body.id}/status`)
        .set(auth(A.pharmacist.token))
        .send({ status: 'DISPENSED' }),
      api()
        .patch(`/api/v1/prescriptions/${r2.body.id}/status`)
        .set(auth(A.pharmacist.token))
        .send({ status: 'DISPENSED' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const med = await prisma.medicine.findUnique({ where: { id: medA } });
    expect(med?.quantity).toBe(0);

    const movements = await prisma.stockMovement.findMany({
      where: { medicineId: medA, type: 'DISPENSE' },
    });
    expect(movements).toHaveLength(1);
  });
  it('dispense deducts the prescribed quantity, and is refused when stock is short', async () => {
    const name = `Qty Med ${suffix}`;
    const m = await api()
      .post('/api/v1/inventory')
      .set(auth(A.pharmacist.token))
      .send({ name, unit: 'tablet' })
      .expect(201);
    await api()
      .post(`/api/v1/inventory/${m.body.id}/receive`)
      .set(auth(A.pharmacist.token))
      .send({ quantity: 5 })
      .expect(201);

    const mk = (quantity: number) => ({
      patientId: A.patientId,
      items: [
        { medicine: name, dose: '1 tablet', frequency: 'Daily', durationDays: 3, quantity },
      ],
    });

    // 3 of 5 units: succeeds, 2 left
    const p1 = await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.doctor.token))
      .send(mk(3))
      .expect(201);
    await api()
      .patch(`/api/v1/prescriptions/${p1.body.id}/status`)
      .set(auth(A.pharmacist.token))
      .send({ status: 'DISPENSED' })
      .expect(200);
    const after1 = await prisma.medicine.findUnique({ where: { id: m.body.id } });
    expect(after1?.quantity).toBe(2);

    // another 3 with only 2 left: refused, nothing changes
    const p2 = await api()
      .post('/api/v1/prescriptions')
      .set(auth(A.doctor.token))
      .send(mk(3))
      .expect(201);
    await api()
      .patch(`/api/v1/prescriptions/${p2.body.id}/status`)
      .set(auth(A.pharmacist.token))
      .send({ status: 'DISPENSED' })
      .expect(409);
    const after2 = await prisma.medicine.findUnique({ where: { id: m.body.id } });
    expect(after2?.quantity).toBe(2);
    const row = await prisma.prescription.findUnique({ where: { id: p2.body.id } });
    expect(row?.status).toBe('PENDING');
  });
});