import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual, createHash } from 'node:crypto';

/**
 * Admin guard. Two modes:
 *  - shared-secret (now): Authorization: Bearer <ADMIN_TOKEN>, compared timing-safe.
 *    Server refuses to boot admin routes without ADMIN_TOKEN set — there is no
 *    "auth disabled" mode, so the unguarded state cannot exist.
 *  - clerk (next): swap verify() for Clerk JWT verification (@clerk/backend
 *    verifyToken) — the guard interface and controllers don't change.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const secret = process.env.ADMIN_TOKEN;
    if (!secret) throw new UnauthorizedException('admin routes disabled: ADMIN_TOKEN not configured');
    const auth: string = ctx.switchToHttp().getRequest().headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const a = createHash('sha256').update(token).digest();
    const b = createHash('sha256').update(secret).digest();
    if (!token || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
