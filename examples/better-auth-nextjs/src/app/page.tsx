'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

interface Wallet {
  readonly id: string;
  readonly address: string;
  readonly chain: string;
  readonly chainFamily: string;
  readonly publicKey: string;
  readonly label: string | null;
}

export default function Home() {
  const { data: session, isPending } = authClient.useSession();

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  // Auth form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading('auth');

    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({
          email,
          password,
          name,
        });
        if (result.error) {
          setError(result.error.message ?? 'Sign up failed');
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
        });
        if (result.error) {
          setError(result.error.message ?? 'Sign in failed');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading('');
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    setWallets([]);
    setBalances({});
  }

  async function handleCreateWallet() {
    setError('');
    setLoading('create');

    try {
      const result = await authClient.locktek.createWallet();

      if (result.error) {
        setError(result.error.message ?? 'Failed to create wallet');
        return;
      }

      if (result.data?.wallet) {
        setWallets((prev) => [...prev, result.data.wallet as Wallet]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setLoading('');
    }
  }

  async function handleLoadWallets() {
    setError('');
    setLoading('load');

    try {
      const result = await authClient.locktek.getWallets();

      if (result.error) {
        setError(result.error.message ?? 'Failed to load wallets');
        return;
      }

      if (result.data?.wallets) {
        setWallets(result.data.wallets as Wallet[]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load wallets');
    } finally {
      setLoading('');
    }
  }

  async function handleCheckBalance(address: string, chain: string) {
    setError('');
    setLoading(`balance-${address}`);

    try {
      const result = await authClient.locktek.getBalance({ address, chain });

      if (result.error) {
        setError(result.error.message ?? 'Failed to check balance');
        return;
      }

      if (result.data) {
        setBalances((prev) => ({
          ...prev,
          [address]: result.data.balance,
        }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to check balance');
    } finally {
      setLoading('');
    }
  }

  if (isPending) {
    return <p>Loading...</p>;
  }

  // Unauthenticated: show sign in / sign up form
  if (!session) {
    return (
      <div style={{ maxWidth: 400, margin: '4rem auto' }}>
        <h1>Locktek + BetterAuth</h1>
        <p style={{ color: '#666' }}>Embedded wallet provisioning example</p>

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>{isSignUp ? 'Sign Up' : 'Sign In'}</h2>

          {isSignUp && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required={isSignUp}
              style={inputStyle}
            />
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />

          <button type="submit" disabled={loading === 'auth'} style={buttonStyle}>
            {loading === 'auth' ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>

          <button
            type="button"
            onClick={() => setIsSignUp((prev) => !prev)}
            style={{
              ...buttonStyle,
              background: 'transparent',
              color: '#333',
              border: '1px solid #ccc',
            }}
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
          </button>
        </form>

        {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  // Authenticated: show wallet management
  return (
    <div style={{ maxWidth: 600, margin: '2rem auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Locktek Wallets</h1>
        <div>
          <span style={{ marginRight: 12, color: '#666' }}>{session.user.email}</span>
          <button
            onClick={handleSignOut}
            style={{ ...buttonStyle, background: '#666', padding: '6px 12px' }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button onClick={handleCreateWallet} disabled={loading === 'create'} style={buttonStyle}>
          {loading === 'create' ? 'Creating...' : 'Create Wallet'}
        </button>

        <button
          onClick={handleLoadWallets}
          disabled={loading === 'load'}
          style={{ ...buttonStyle, background: '#2563eb' }}
        >
          {loading === 'load' ? 'Loading...' : 'Load Wallets'}
        </button>
      </div>

      {wallets.length === 0 ? (
        <p style={{ color: '#666' }}>
          No wallets loaded. Click &quot;Load Wallets&quot; — one was provisioned automatically at
          signup.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {wallets.map((wallet) => (
            <div key={wallet.id} style={cardStyle}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <strong>{wallet.chain}</strong>
                <span style={{ fontSize: 12, color: '#666' }}>{wallet.chainFamily}</span>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={fieldStyle}>
                  <span style={labelStyle}>Address</span>
                  <code style={codeStyle}>{wallet.address}</code>
                </div>

                <div style={fieldStyle}>
                  <span style={labelStyle}>Public Key</span>
                  <code style={codeStyle}>{truncate(wallet.publicKey, 20)}</code>
                </div>

                {wallet.label && (
                  <div style={fieldStyle}>
                    <span style={labelStyle}>Label</span>
                    <span>{wallet.label}</span>
                  </div>
                )}

                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => handleCheckBalance(wallet.address, wallet.chain)}
                    disabled={loading === `balance-${wallet.address}`}
                    style={{
                      ...buttonStyle,
                      background: '#16a34a',
                      padding: '4px 10px',
                      fontSize: 13,
                    }}
                  >
                    {loading === `balance-${wallet.address}` ? 'Checking...' : 'Check Balance'}
                  </button>

                  {balances[wallet.address] !== undefined && (
                    <span style={{ fontSize: 14 }}>
                      Balance: <strong>{balances[wallet.address]}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return `${str.slice(0, len)}...`;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #ccc',
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: '#111',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e2e2',
  borderRadius: 8,
  padding: 16,
  background: '#fafafa',
};

const fieldStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 80,
  color: '#666',
  fontWeight: 500,
};

const codeStyle: React.CSSProperties = {
  background: '#eee',
  padding: '1px 4px',
  borderRadius: 3,
  fontSize: 12,
  wordBreak: 'break-all',
};
