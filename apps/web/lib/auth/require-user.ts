import { getAuthUserById } from '@nephix/db';
import { verifyAccessToken } from './tokens';
import { readAccessTokenFromRequest } from './session';

export async function requireAuthenticatedUser(request: Request) {
  const accessToken = readAccessTokenFromRequest(request);
  if (!accessToken) {
    return null;
  }

  const payload = await verifyAccessToken(accessToken);
  if (!payload) {
    return null;
  }

  const user = await getAuthUserById(payload.sub);
  return user;
}
