import type { Metadata } from 'next';
import { LoginForm } from '@/components/forms';
import { Shell } from '@/components/shell';
import { loginAction } from '../admin/actions';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function LoginPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-sm">
        <h1 className="mb-4 text-2xl font-semibold">Operator sign in</h1>
        <LoginForm action={loginAction} />
      </div>
    </Shell>
  );
}
