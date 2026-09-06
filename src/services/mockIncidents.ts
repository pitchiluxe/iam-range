/**
 * services/mockIncidents.ts — identity incident response.
 */
import { nanoid } from 'nanoid';
import type { Incident, IncidentId, UserId } from '@/domain';
import { mkIncidentId } from '@/domain';

export class MockIncidents {
  private incidents = new Map<IncidentId, Incident>();

  open(
    input: Omit<Incident, 'id' | 'status' | 'containmentActions' | 'detectedAt'> & {
      detectedAt?: number;
    },
  ): Incident {
    const id = mkIncidentId(nanoid(10));
    const inc: Incident = {
      ...input,
      id,
      status: 'open',
      detectedAt: input.detectedAt ?? Date.now(),
      containmentActions: [],
    };
    this.incidents.set(id, inc);
    return inc;
  }

  contain(id: IncidentId, action: string, by: UserId): void {
    const inc = this.incidents.get(id);
    if (!inc) return;
    inc.containmentActions.push({ at: Date.now(), actorId: by, action });
    if (inc.status === 'open') {
      inc.status = 'contained';
      inc.containedAt = Date.now();
    }
  }

  recover(id: IncidentId, _by: UserId): void {
    const inc = this.incidents.get(id);
    if (!inc) return;
    inc.status = 'recovered';
  }

  close(id: IncidentId, _by: UserId): void {
    const inc = this.incidents.get(id);
    if (!inc) return;
    inc.status = 'closed';
    inc.closedAt = Date.now();
  }

  writeReport(id: IncidentId, body: string, _by: UserId): void {
    const inc = this.incidents.get(id);
    if (!inc) return;
    inc.reportBody = body;
  }

  list(): Incident[] {
    return Array.from(this.incidents.values());
  }

  get(id: IncidentId): Incident | undefined {
    return this.incidents.get(id);
  }

  reset(): void {
    this.incidents.clear();
  }
}
