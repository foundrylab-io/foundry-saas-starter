// lib/_reference/page-pattern.tsx
// PATTERN REFERENCE — never imported by any application code.
// Exists solely to demonstrate the canonical patterns that all generated
// pages and API routes must follow. Never modify or delete this file.
// It is protected from modification by the CTO Agent.

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureUserExists } from '@/lib/db/queries';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Pattern: inline type for server component data — matches the domain table shape
interface _ReferenceRecord {
  id: number;
  name: string;
  createdAt: Date;
}

// Pattern: server component default export — always async, always auth-gated
export default async function _ReferencePage() {
  // Pattern: Clerk auth check — always first, always null-check + redirect
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  // Pattern: JIT user provisioning — always call ensureUserExists before any DB query
  const user = await ensureUserExists(userId);
  if (!user) redirect('/sign-in');

  // Pattern: Drizzle select — filter by userId FK for per-user data isolation
  const records = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(100);

  // Pattern: inline server action — 'use server' directive, auth inside action
  async function _createRecord(formData: FormData) {
    'use server';
    const { userId } = await auth();
    if (!userId) return;
    const currentUser = await ensureUserExists(userId);
    if (!currentUser) return;
    const name = formData.get('name') as string;
    if (!name?.trim()) return;
    // ... domain-specific insert here ...
    revalidatePath('/_reference');
  }

  async function _deleteRecord(id: number) {
    'use server';
    const { userId } = await auth();
    if (!userId) return;
    const currentUser = await ensureUserExists(userId);
    if (!currentUser) return;
    // ... domain-specific delete here ...
    revalidatePath('/_reference');
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Records</h1>
        {/* Pattern: Dialog for create form — always shadcn Dialog, never inline form */}
        <Dialog>
          <DialogTrigger asChild>
            <Button>Add Record</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Record</DialogTitle>
            </DialogHeader>
            {/* Pattern: form with server action — action= attribute on <form> tag */}
            <form action={_createRecord} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <Button type="submit">Create</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Pattern: data table — always shadcn Table, always .map() with key */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                No records yet.
              </TableCell>
            </TableRow>
          ) : (
            records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>{record.name}</TableCell>
                <TableCell>{new Date(record.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <form action={_deleteRecord.bind(null, record.id)}>
                    <Button variant="destructive" size="sm" type="submit">
                      Delete
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
