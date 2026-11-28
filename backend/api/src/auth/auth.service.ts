import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface JwtPayload {
  sub: string;
  role: string;
  hospitalId: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const code = `H-${randomBytes(4).toString('hex').toUpperCase()}`;

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: dto.organizationName },
      });
      const hospital = await tx.hospital.create({
        data: {
          organizationId: organization.id,
          name: dto.hospitalName,
          code,
        },
      });
      return tx.user.create({
        data: {
          hospitalId: hospital.id,
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'HOSPITAL_ADMIN',
        },
      });
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // Same error for unknown email and wrong password
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    return this.issueTokens(user);
  }

  async refresh(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    // Reuse of a revoked token means it may be stolen: revoke all sessions
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (stored.expiresAt < new Date() || stored.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user);
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async forgotPassword(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same silent result for unknown, suspended and active accounts
    if (!user || user.status !== 'ACTIVE') return;

    const token = randomBytes(32).toString('hex');
    await this.prisma.$transaction([
      // Only the newest token may work
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashToken(token),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      }),
    ]);

    // No email service yet: in development the token is printed instead
    if (this.config.get<string>('nodeEnv') !== 'production') {
      this.logger.warn(`DEV password reset token for ${email}: ${token}`);
    }
  }

  async resetPassword(token: string, newPassword: string) {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });
    if (
      !stored ||
      stored.usedAt ||
      stored.expiresAt < new Date() ||
      stored.user.status !== 'ACTIVE'
    ) {
      throw new BadRequestException('Invalid or expired token');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      // Only one request can claim a token
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Invalid or expired token');
      }
      await tx.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      });
      // Every existing session ends with the old password
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { success: true };
  }
  private async issueTokens(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    hospitalId: string | null;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      hospitalId: user.hospitalId,
    };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(48).toString('hex');
    const days = this.config.get<number>('jwt.refreshExpiresDays') ?? 7;
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        hospitalId: user.hospitalId,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}