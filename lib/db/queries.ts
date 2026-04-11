import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { auth, currentUser } from '@clerk/nextjs/server';

/**
 * Ensure a user row exists for the given Clerk user ID.
 * Creates the row on first call (JIT provisioning).
 * Returns the internal user record.
 */
export async function ensureUserExists(clerkId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const clerkUser = await currentUser();
  const [newUser] = await db
    .insert(users)
    .values({
      clerkId,
      name: clerkUser?.fullName ?? '',
      email: clerkUser?.emailAddresses[0]?.emailAddress ?? '',
    })
    .returning();

  return newUser;
}
