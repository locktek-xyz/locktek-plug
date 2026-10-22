import { betterAuth } from 'better-auth';
import Database from 'better-sqlite3';
import { locktekPlugin } from '@locktek/better-auth';

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error(
    'BETTER_AUTH_SECRET is not defined. Set it in your .env file (at least 32 characters). Run: openssl rand -hex 32',
  );
}

export const auth = betterAuth({
  // WARNING: SQLite is for development only. Use PostgreSQL/MySQL in production.
  database: new Database('./dev.db'),
  secret: process.env.BETTER_AUTH_SECRET,

  emailAndPassword: {
    enabled: true,
  },

  plugins: [
    locktekPlugin({
      chains: ['ethereum-sepolia', 'base-sepolia'],
      encryptionKey: process.env.LOCKTEK_ENCRYPTION_KEY,
      // A wallet exists before the signup response returns, so the app never has to
      // handle a user who has none.
      autoCreateWallet: true,
      onWalletCreationError: 'fail',
    }),
  ],
});
