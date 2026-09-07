/**
 * tests/ticketClocks.test.ts — one card, one clock.
 *
 * A ticket card shows two elapsed times: the SLA countdown badge and the age
 * beside the assignee. They are two views of the same number — now minus
 * createdAt — so they must always agree.
 *
 * They did not. The tick updated the badge and left the age as it was written
 * at render, so a card left alone for a few minutes read "raised 2m 55s ago"
 * next to "20m 24s left" of a thirty-minute SLA. One says three minutes old,
 * the other says nearly ten.
 *
 * The cause was a good fix stopping one line short: the tick used to call
 * render(), which rebuilt every card once a second and destroyed scroll
 * position, half-typed comments and focus. Replacing that with a targeted
 * update was right; its comment claimed "nothing outside the badges changes on
 * a clock tick", and the age does.
 *
 * This is asserted at the source level because the failure is a missing call,
 * not a wrong value — nothing computed the wrong answer, one element simply
 * stopped being asked. A DOM test of a correct render would have passed
 * throughout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(process.cwd(), 'src', 'ui', 'consoles', 'ticketConsole.ts'),
  'utf8',
);

/** The body of the once-a-second interval. */
function tickBody(): string {
  const start = SOURCE.indexOf('slaInterval = window.setInterval(');
  expect(start, 'the SLA tick moved').toBeGreaterThan(-1);
  // Bounded by the interval's own closing arguments, so this reads the tick
  // and nothing after it.
  const end = SOURCE.indexOf('}, 1000)', start);
  expect(end, 'the tick is no longer a one-second interval').toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('every clock on a ticket card ticks', () => {
  it('refreshes the SLA countdown and the age in the same tick', () => {
    const body = tickBody();
    expect(body).toContain('updateSLABadges()');
    expect(body).toContain('updateAges()');
  });

  it('marks both clocks in the markup so the tick can find them', () => {
    // Without the attribute the element is unreachable from the tick, which is
    // exactly how the age came to be updated only at render.
    expect(SOURCE).toContain('data-sla-for="${t.id}"');
    expect(SOURCE).toContain('data-age-for="${t.id}"');
  });

  it('derives both from createdAt, so they cannot drift apart', () => {
    for (const fn of ['updateAges', 'updateSLABadges']) {
      const at = SOURCE.indexOf(`function ${fn}(`);
      expect(at, `${fn} moved`).toBeGreaterThan(-1);
      expect(SOURCE.slice(at, at + 700), fn).toMatch(/createdAt/);
    }
  });

  it('does not rebuild the cards on a tick', () => {
    // The reason the age was frozen in the first place: calling render() here
    // destroys scroll position, half-typed comments and focus once a second.
    //
    // Comments are stripped first. The tick explains in prose why it does not
    // call render(), and a naive match reads that explanation as the very
    // thing it warns against.
    const code = tickBody().replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\brender\(\)/);
  });
});
