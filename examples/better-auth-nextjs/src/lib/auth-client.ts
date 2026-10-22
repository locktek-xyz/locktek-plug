import { createAuthClient } from 'better-auth/react';
import { locktekClient } from '@locktek/better-auth/client';

export const authClient = createAuthClient({
  plugins: [locktekClient()],
});
