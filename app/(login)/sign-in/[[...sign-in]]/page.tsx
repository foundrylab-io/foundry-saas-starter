import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50">
      <SignIn />
    </div>
  );
}
