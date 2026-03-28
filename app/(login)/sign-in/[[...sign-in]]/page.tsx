import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME;

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Sign in to {appName || 'your account'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome back! Please sign in to continue.
          </p>
        </div>
        <SignIn fallbackRedirectUrl="/dashboard" />
      </div>
    </div>
  );
}
