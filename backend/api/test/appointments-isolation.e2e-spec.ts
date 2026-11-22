import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Appointments isolation (e2e)', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let patientA: string;
  let doctorA: string;
  let patientB: string;
  let doctorB: string;
  let apptA: string;

  const suffix = Date.now();
  const reg = (n: string) => ({
    organizationName: `Org ${n} ${suffix}`,
    hospitalName: `Hospital ${n} ${suffix}`,
    firstName: 'Test',
    lastName: `Admin${n}`,
    email: `admin-${n.toLowerCase()}-${suffix}@appt.test`,
    password: 'IsolationPass#123',
  });

  const api = () => request(app.getHttpServer());

  async function setupHospital(n: string) {
    const r = await api().post('/api/v1/auth/register').send(reg(n));
    expect(r.status).toBe(201);
    const token = r.body.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    const p = await api()
      .post('/api/v1/patients')
      .set(auth)
      .send({ firstName: 'Pat', lastName: `Ient${n}`, dateOfBirth: '1990-01-01', gender: 'MALE' });
    expect(p.status).toBe(201);

    const d = await api()
      .post('/api/v1/staff')
      .set(auth)
      .send({
        firstName: 'Doc',
        lastName: `Tor${n}`,
        email: `doc-${n.toLowerCase()}-${suffix}@appt.test`,
        password: 'DoctorPass#12345',
        role: 'DOCTOR',
      });
    expect(d.status).toBe(201);

    return { token, patientId: p.body.id as string, doctorId: d.body.id as string };
  }

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

    const a = await setupHospital('A');
    const b = await setupHospital('B');
    tokenA = a.token;
    patientA = a.patientId;
    doctorA = a.doctorId;
    tokenB = b.token;
    patientB = b.patientId;
    doctorB = b.doctorId;

    const appt = await api()
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId: patientA,
        doctorId: doctorA,
        startsAt: '2027-01-10T09:00:00Z',
        endsAt: '2027-01-10T09:30:00Z',
      });
    expect(appt.status).toBe(201);
    apptA = appt.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('B cannot book using hospital A patient (400)', async () => {
    await api()
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        patientId: patientA,
        doctorId: doctorB,
        startsAt: '2027-01-11T09:00:00Z',
        endsAt: '2027-01-11T09:30:00Z',
      })
      .expect(400);
  });

  it('B cannot book using hospital A doctor (400)', async () => {
    await api()
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        patientId: patientB,
        doctorId: doctorA,
        startsAt: '2027-01-11T10:00:00Z',
        endsAt: '2027-01-11T10:30:00Z',
      })
      .expect(400);
  });

  it('B cannot change the status of an A appointment (404)', async () => {
    await api()
      .patch(`/api/v1/appointments/${apptA}/status`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ status: 'CANCELLED' })
      .expect(404);
  });

  it("B's appointment list does not contain A's appointment", async () => {
    const res = await api()
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});