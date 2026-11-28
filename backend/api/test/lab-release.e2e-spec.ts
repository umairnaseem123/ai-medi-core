import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Lab result release (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createStaff(
    adminToken: string,
    tag: string,
    role: 'DOCTOR' | 'NURSE' | 'LAB_TECH',
    password: string,
  ) {
    const email = `${role.toLowerCase()}-${tag.toLowerCase()}-${suffix}@rel.test`;
    const s = await api()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send({
        firstName: 'Staff',
        lastName: `${role}${tag}`,
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
        email: `admin-${n.toLowerCase()}-${suffix}@rel.test`,
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

    const doctor = await createStaff(adminToken, `${n}1`, 'DOCTOR', 'DoctorPass#12345');
    const doctor2 = await createStaff(adminToken, `${n}2`, 'DOCTOR', 'DoctorPass#12345');
    const nurse = await createStaff(adminToken, n, 'NURSE', 'NursePass#123456');
    const labTech = await createStaff(adminToken, n, 'LAB_TECH', 'LabTechPass#12345');

    return {
      adminToken,
      doctor,
      doctor2,
      nurse,
      labTech,
      patientId: p.body.id as string,
      hospitalId: r.body.user.hospitalId as string,
    };
  }

  let A: Awaited<ReturnType<typeof setupHospital>>;
  let B: Awaited<ReturnType<typeof setupHospital>>;

  const newOrder = (completed: boolean) =>
    prisma.labOrder.create({
      data: {
        hospitalId: A.hospitalId,
        patientId: A.patientId,
        orderedById: A.doctor.id,
        testName: `Test ${Math.random().toString(36).slice(2, 7)}`,
        ...(completed
          ? {
              status: 'COMPLETED',
              result: 'All values normal',
              resultById: A.labTech.id,
              resultAt: new Date(),
            }
          : {}),
      },
    });

  const release = (token: string, id: string) =>
    api().patch(`/api/v1/lab-orders/${id}/release`).set(auth(token));

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

  it('a doctor releases a completed result once, a second release returns 409', async () => {
    const order = await newOrder(true);

    const res = await release(A.doctor2.token, order.id).expect(200);
    expect(res.body.releasedAt).not.toBeNull();
    expect(res.body.releasedById).toBe(A.doctor2.id);

    await release(A.doctor.token, order.id).expect(409);

    const logs = await prisma.auditLog.findMany({
      where: { hospitalId: A.hospitalId, entity: 'LabOrder', entityId: order.id, action: 'UPDATE' },
    });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('an order that is not completed cannot be released (409)', async () => {
    const order = await newOrder(false);
    await release(A.doctor.token, order.id).expect(409);
    const row = await prisma.labOrder.findUnique({ where: { id: order.id } });
    expect(row?.releasedAt).toBeNull();
  });

  it('hospital B gets 404, nurse and lab tech get 403', async () => {
    const order = await newOrder(true);
    await release(B.doctor.token, order.id).expect(404);
    await release(A.nurse.token, order.id).expect(403);
    await release(A.labTech.token, order.id).expect(403);
    const row = await prisma.labOrder.findUnique({ where: { id: order.id } });
    expect(row?.releasedAt).toBeNull();
  });

  it('two releases at once, only one wins', async () => {
    const order = await newOrder(true);
    const [x, y] = await Promise.all([
      release(A.doctor.token, order.id),
      release(A.doctor2.token, order.id),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });
});