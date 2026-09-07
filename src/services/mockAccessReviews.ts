/**
 * services/mockAccessReviews.ts — periodic access review campaigns.
 *
 * Certification is a standing quarterly job in every real identity team and
 * it was the one part of the estate with a service and no way to reach it.
 * Two things were missing from the service itself, and both of them are the
 * difference between a review and a form:
 *
 * Nothing was audited. A campaign whose decisions leave no trace cannot be
 * shown to an auditor, and being shown to an auditor is the entire reason
 * certification exists.
 *
 * And a revoke decision did nothing. You could mark every membership in the
 * estate for removal, close the campaign, and everybody would still have
 * everything. A review where revoke is a note teaches that certification is
 * paperwork, which is exactly the belief that lets access accumulate for
 * years.
 *
 * Revocations apply when the campaign is completed rather than at the moment
 * of the click, which is how Entra and Okta both behave — and the reason is
 * worth learning: a campaign where every reviewer has decided but nobody
 * pressed complete has changed nothing, and that is one of the most common
 * ways real access reviews fail to remove access.
 */
import { nanoid } from 'nanoid';
import type {
  AccessReview,
  AccessReviewDecision,
  GroupId,
  ReviewId,
  UserId,
} from '@/domain';
import { mkReviewId } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';
import type { MockDirectory } from './mockDirectory';

/** Sentinel for a decision nobody has made yet. */
export const PENDING = 'pending' as UserId;

export interface CompletionResult {
  revoked: { userId: UserId; groupId: GroupId }[];
  approved: number;
  /** Set when the campaign could not be completed, with the reason. */
  error?: string;
}

export class MockAccessReviews {
  private reviews = new Map<ReviewId, AccessReview>();

  /**
   * The audit log is optional so existing callers and tests are unchanged,
   * but everything that can record, does.
   */
  constructor(private readonly audit?: MockAuditLog) {}

  openCampaign(
    c: { campaign: string; openedAt: number; dueAt: number },
    actor: UserId = PENDING,
  ): AccessReview {
    const id = mkReviewId(nanoid(10));
    const review: AccessReview = {
      id,
      campaign: c.campaign,
      openedAt: c.openedAt,
      dueAt: c.dueAt,
      status: 'open',
      decisions: [],
    };
    this.reviews.set(id, review);
    this.audit?.record({
      actorId: actor,
      action: 'review.opened',
      targetId: id,
      note: `Campaign "${c.campaign}" opened, due ${new Date(c.dueAt).toISOString().slice(0, 10)}.`,
    });
    return review;
  }

  /** Seed a review with pre-existing pending decisions. */
  seedDecisions(
    id: ReviewId,
    decisions: Omit<AccessReviewDecision, 'decidedBy' | 'decidedAt'>[],
  ): void {
    const r = this.reviews.get(id);
    if (!r) throw new Error(`[reviews] seedDecisions: review ${id} not found`);
    // Placeholders until a reviewer makes the call.
    r.decisions = decisions.map((d) => ({ ...d, decidedBy: PENDING, decidedAt: 0 }));
  }

  /**
   * Scope a campaign to every membership in the directory.
   *
   * What a real campaign does: enumerate who has what, and ask a human about
   * each one. Built here rather than in the UI so the terminal and the console
   * cannot disagree about what a campaign covers.
   */
  scopeToDirectory(id: ReviewId, dir: MockDirectory): number {
    const rows: Omit<AccessReviewDecision, 'decidedBy' | 'decidedAt'>[] = [];
    for (const group of dir.listGroups()) {
      for (const userId of group.memberIds) {
        rows.push({ userId, groupId: group.id, decision: 'approve' });
      }
    }
    this.seedDecisions(id, rows);
    return rows.length;
  }

  recordDecision(
    reviewId: ReviewId,
    d: Omit<AccessReviewDecision, 'decidedAt'>,
    dir?: MockDirectory,
  ): void {
    const r = this.reviews.get(reviewId);
    if (!r) throw new Error(`[reviews] recordDecision: review not found`);
    if (r.status === 'closed') {
      throw new Error(`[reviews] recordDecision: campaign "${r.campaign}" is already closed.`);
    }
    const existing = r.decisions.findIndex(
      (e) => e.userId === d.userId && e.groupId === d.groupId && e.roleId === d.roleId,
    );
    if (existing >= 0) {
      r.decisions[existing] = { ...d, decidedAt: Date.now() };
    } else {
      r.decisions.push({ ...d, decidedAt: Date.now() });
    }
    r.status = 'in-progress';

    // Who decided what, and about whom. The decision is the evidence.
    const who = dir?.getUser(d.userId)?.username ?? d.userId;
    const what = dir?.listGroups().find((g) => g.id === d.groupId)?.name ?? d.groupId;
    this.audit?.record({
      actorId: d.decidedBy,
      action: d.decision === 'revoke' ? 'review.revoked' : 'review.approved',
      targetId: reviewId,
      subjectId: d.userId,
      ...(d.note ? { note: `${who} → ${what}: ${d.note}` } : { note: `${who} → ${what}` }),
    });
  }

  /** Decisions that still need a reviewer's call. */
  pending(reviewId: ReviewId): AccessReviewDecision[] {
    const r = this.reviews.get(reviewId);
    if (!r) return [];
    return r.decisions.filter((d) => d.decidedBy === PENDING);
  }

  /**
   * Complete the campaign, applying every revocation.
   *
   * This is the step that makes a review real. Without a directory it can
   * still close, but it says so rather than pretending it removed anything.
   */
  complete(id: ReviewId, actor: UserId, dir?: MockDirectory): CompletionResult {
    const r = this.reviews.get(id);
    if (!r) return { revoked: [], approved: 0, error: 'That campaign does not exist.' };
    if (r.status === 'closed') {
      return { revoked: [], approved: 0, error: `"${r.campaign}" is already closed.` };
    }
    const outstanding = this.pending(id).length;
    if (outstanding > 0) {
      // Completing with undecided rows would silently approve them, which is
      // rubber-stamping with extra steps.
      return {
        revoked: [],
        approved: 0,
        error: `${outstanding} item(s) still have no decision. Every row needs a call before the campaign can be completed.`,
      };
    }

    const revoked: { userId: UserId; groupId: GroupId }[] = [];
    for (const d of r.decisions) {
      if (d.decision !== 'revoke') continue;
      if (dir) dir.removeFromGroup(d.userId, d.groupId, actor);
      revoked.push({ userId: d.userId, groupId: d.groupId });
    }

    r.status = 'closed';
    this.audit?.record({
      actorId: actor,
      action: 'review.completed',
      targetId: id,
      note:
        `Campaign "${r.campaign}" completed: ${revoked.length} revoked, ` +
        `${r.decisions.length - revoked.length} approved.`,
    });

    return { revoked, approved: r.decisions.length - revoked.length };
  }

  /** Kept for callers that only need the status change. */
  close(id: ReviewId): void {
    const r = this.reviews.get(id);
    if (!r) return;
    r.status = 'closed';
  }

  list(): AccessReview[] {
    return Array.from(this.reviews.values());
  }

  get(id: ReviewId): AccessReview | undefined {
    return this.reviews.get(id);
  }

  reset(): void {
    this.reviews.clear();
  }
}
