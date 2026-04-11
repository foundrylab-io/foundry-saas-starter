import { ReactNode } from 'react';
import { UserButton } from '@clerk/nextjs';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-gray-900">
          {process.env.NEXT_PUBLIC_APP_NAME ?? 'Dashboard'}
        </span>
        <UserButton />
      </header>
      <main>{children}</main>
    </div>
  );
}
