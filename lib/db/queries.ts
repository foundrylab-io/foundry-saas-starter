import { desc, and, eq, isNull } from 'drizzle-orm';
import { db } from './drizzle';
import { activityLogs, teamMembers, teams, users } from './schema';
import { currentUser } from '@clerk/nextjs/server';
import type { TeamDataWithMembers } from './schema';

export async function getUser() {
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return null;
  }

  const existing = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.clerkId, clerkUser.id),
        isNull(users.deletedAt)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Ensure user has a team (may be missing if provisioned before this fix)
    await ensureTeamExists(existing[0].id, existing[0].name || existing[0].email);
    return existing[0];
  }

  // Just-in-time provisioning: create a DB row for new Clerk users
  const email =
    clerkUser.emailAddresses[0]?.emailAddress ?? 'unknown@example.com';
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') ||
    clerkUser.username ||
    email.split('@')[0];

  const inserted = await db
    .insert(users)
    .values({
      clerkId: clerkUser.id,
      email,
      name,
      role: 'owner',
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    await ensureTeamExists(inserted[0].id, name);
    return inserted[0];
  }

  // Race condition: another request inserted between our SELECT and INSERT
  const retry = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkUser.id))
    .limit(1);

  if (retry[0]) {
    await ensureTeamExists(retry[0].id, retry[0].name || retry[0].email);
  }
  return retry[0] ?? null;
}

async function ensureTeamExists(userId: number, userName: string) {
  // Check if user already has a team membership
  const membership = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);

  if (membership.length > 0) {
    return; // already has a team
  }

  // Create a default team + membership
  const teamName = `${userName}'s Team`;
  const [newTeam] = await db
    .insert(teams)
    .values({ name: teamName })
    .returning();

  if (newTeam) {
    await db.insert(teamMembers).values({
      userId,
      teamId: newTeam.id,
      role: 'owner',
    });
  }
}

export async function getTeamByStripeCustomerId(customerId: string) {
  const result = await db
    .select()
    .from(teams)
    .where(eq(teams.stripeCustomerId, customerId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateTeamSubscription(
  teamId: number,
  subscriptionData: {
    stripeSubscriptionId: string | null;
    stripeProductId: string | null;
    planName: string | null;
    subscriptionStatus: string;
  }
) {
  await db
    .update(teams)
    .set({
      ...subscriptionData,
      updatedAt: new Date()
    })
    .where(eq(teams.id, teamId));
}

export async function getUserWithTeam(userId: number) {
  const result = await db
    .select({
      user: users,
      teamId: teamMembers.teamId
    })
    .from(users)
    .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
    .where(eq(users.id, userId))
    .limit(1);

  return result[0];
}

export async function getActivityLogs() {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  return await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      timestamp: activityLogs.timestamp,
      ipAddress: activityLogs.ipAddress,
      userName: users.name
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(eq(activityLogs.userId, user.id))
    .orderBy(desc(activityLogs.timestamp))
    .limit(10);
}

export async function getTeamForUser(): Promise<TeamDataWithMembers | null> {
  const user = await getUser();
  if (!user) {
    return null;
  }

  const result = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.userId, user.id),
    with: {
      team: {
        with: {
          teamMembers: {
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          }
        }
      }
    }
  });

  return (result?.team as TeamDataWithMembers) ?? null;
}
