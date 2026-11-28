import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Password reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const OLD_PW = 'NursePass#123456';
  const NEW_PW = 'BrandNewPass#2026';

  // Capture the dev-mode reset token that the service logs
  const logged: string[] = [];
  const originalWarn = Logger.prototype.warn;

  const tokenFor = (email: string): string => {
    for (let i = logged.length - 1; i >= 0; i--) {
      const m = logged[i].match(/DEV password reset token for (\S+): ([0-9a-f]{64})/);
      if (m && m[1] === email) return m[2];
    }
    throw new Error(`No reset token was logged for ${email}`);
  };

  // Inserts a token directly, so some tests need no forgot-password call
  const insertToken = async (userId: string, expiresAt = new Date(Date.now() + 600_000)) => {
    const token = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt,
      },
    });
    return token;
  };

  let adminToken: string;
  const users: Record<string, { id: string; email: string }> = {};

  async function addNurse(key: string) {
    const email = `nurse-${key}-${suffix}@reset.test`;
    const s = await api()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send({
        firstName: 'Nina',
        lastName: `Nurse${key}`,
        email,
        password: OLD_PW,
        role: 'NURSE',
      });
    expect(s.status).toBe(201);
    users[key] = { id: s.body.id as string, email };
  }

  beforeAll(async () => {
    Logger.prototype.warn = function (message: unknown, ...rest: unknown[]) {
      if (String(message).includes('DEV password reset token')) {
        logged.push(String(message));
        return;
      }
      return (originalWarn as (...a: unknown[]) => void).call(this, message, ...rest);
    } as typeof Logger.prototype.warn;

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

    const r = await api()
      .post('/api/v1/auth/register')
      .send({
        organizationName: `Org R ${suffix}`,
        hospitalName: `Hospital R ${suffix}`,
        firstName: 'Test',
        lastName: 'AdminR',
        email: `admin-r-${suffix}@reset.test`,
        password: 'IsolationPass#123',
      });
    expect(r.status).toBe(201);
    adminToken = r.body.accessToken as string;

    for (const key of ['flow', 'newest', 'suspended', 'expiry', 'race', 'valid']) {
      await addNurse(key);
    }
  });

  afterAll(async () => {
    Logger.prototype.warn = originalWarn;
    await app.close();
  });

  it('forgot-password answers the same for unknown and suspended accounts, and issues no token', async () => {
    await api()
      .patch(`/api/v1/staff/${users.suspended.id}/suspend`)
      .set(auth(adminToken))
      .expect(200);

    logged.length = 0;
    const unknown = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody-${suffix}@reset.test` });
    const suspended = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: users.suspended.email });

    expect(unknown.status).toBe(201);
    expect(suspended.status).toBe(201);
    expect(unknown.body).toEqual({ success: true });
    expect(suspended.body).toEqual({ success: true });
    expect(logged).toHaveLength(0);
    expect(
      await prisma.passwordResetToken.count({ where: { userId: users.suspended.id } }),
    ).toBe(0);
  });

  it('full flow: reset changes the password, ends all sessions, and the token works only once', async () => {
    const u = users.flow;
    await prisma.refreshToken.create({
      data: {
        userId: u.id,
        tokenHash: `x${randomBytes(16).toString('hex')}`,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    logged.length = 0;
    const forgot = await api().post('/api/v1/auth/forgot-password').send({ email: u.email });
    expect(forgot.status).toBe(201);
    expect(forgot.body).toEqual({ success: true });
    const token = tokenFor(u.email);

    // The raw token is never stored, only its hash
    expect(
      await prisma.passwordResetToken.count({ where: { tokenHash: token } }),
    ).toBe(0);

    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: NEW_PW })
      .expect(201);

    // Every old session was revoked
    expect(
      await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } }),
    ).toBe(0);

    await api().post('/api/v1/auth/login').send({ email: u.email, password: OLD_PW }).expect(401);
    await api().post('/api/v1/auth/login').send({ email: u.email, password: NEW_PW }).expect(201);

    // Used token cannot be replayed
    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'AnotherPass#2026x' })
      .expect(400);
  });

  it('only the newest token works after a second forgot-password request', async () => {
    const u = users.newest;
    logged.length = 0;
    await api().post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(201);
    const first = tokenFor(u.email);
    await api().post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(201);
    const second = tokenFor(u.email);
    expect(second).not.toBe(first);

    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: first, newPassword: NEW_PW })
      .expect(400);
    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: second, newPassword: NEW_PW })
      .expect(201);
  });

  it('an expired token is refused (400) and the password is unchanged', async () => {
    const u = users.expiry;
    const token = await insertToken(u.id, new Date(Date.now() - 60_000));
    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: NEW_PW })
      .expect(400);
    await api().post('/api/v1/auth/login').send({ email: u.email, password: OLD_PW }).expect(201);
  });

  it('a short password and an unknown token are rejected (400)', async () => {
    const u = users.valid;
    const token = await insertToken(u.id);
    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'short' })
      .expect(400);
    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token: randomBytes(32).toString('hex'), newPassword: NEW_PW })
      .expect(400);
    // The valid token was not consumed by the rejected short-password attempt
    await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: NEW_PW })
      .expect(201);
  });

  it('two resets with the same token at once, only one wins', async () => {
    const token = await insertToken(users.race.id);
    const [x, y] = await Promise.all([
      api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'RacePassOne#2026' }),
      api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'RacePassTwo#2026' }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 400]);
  });
});