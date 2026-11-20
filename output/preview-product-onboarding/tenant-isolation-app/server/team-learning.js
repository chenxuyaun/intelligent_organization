import { isKnowledgeExpired } from './data-scope.js';

function latestReview(run) {
  return (run.reviews || []).reduce((latest, review) => (
    !latest || Number(review.id) > Number(latest.id) ? review : latest
  ), null);
}

/** Read-only, whole-workspace learning view for product mode. */
export function buildTeamLearning(store) {
  const tickets = store.listTickets();
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const allRuns = tickets.flatMap((ticket) => store.runsByTicket(ticket.id));
  const runs = allRuns.filter((run) => run.mode === 'organization');
  const latestReviewByRun = new Map(runs.map((run) => [run.id, latestReview(run)]));
  const cards = store.listCards();
  const publishedCards = cards.filter((card) => (
    card.status === 'published' && !card.superseded_by_card_id
  ));
  const pendingCards = cards.filter((card) => card.status === 'pending');
  const expiredCards = publishedCards.filter((card) => (
    card.scope === 'pilot' && Boolean(card.pilot_approved) && isKnowledgeExpired(card.valid_until)
  ));

  const events = store.raw.prepare(`SELECT id, ticket_id, actor_member_id, kind,
                                      CASE WHEN json_valid(payload) THEN json_extract(payload, '$.to') END AS status_to,
                                      CASE WHEN json_valid(payload) THEN json_extract(payload, '$.preparedEventId') END AS prepared_event_id,
                                      CASE WHEN json_valid(payload) THEN json_extract(payload, '$.recipientMemberId') END AS recipient_member_id,
                                      created_at
                                    FROM events
                                    WHERE kind IN ('ticket_status', 'assignee_changed', 'handoff_prepared', 'handoff_accepted')
                                    ORDER BY id`).all();
  const ticketsReopened = new Set();
  const ticketsEscalated = new Set();
  const handoffsById = new Map();
  const latestHandoffByTicket = new Map();
  const latestAssigneeEventByTicket = new Map();
  const latestStatusEventByTicket = new Map();
  const acceptedHandoffs = new Set();
  const handoffWaitMinutes = [];
  for (const event of events) {
    if (!event.ticket_id) continue;
    const ticket = ticketById.get(event.ticket_id);
    if (!ticket || ticket.scope === 'sample') continue;
    if (event.kind === 'ticket_status') {
      latestStatusEventByTicket.set(event.ticket_id, event);
      if (event.status_to === 'reopened') ticketsReopened.add(event.ticket_id);
      if (event.status_to === 'escalated') ticketsEscalated.add(event.ticket_id);
    }
    if (event.kind === 'assignee_changed') latestAssigneeEventByTicket.set(event.ticket_id, event);
    if (event.kind === 'handoff_prepared') {
      handoffsById.set(Number(event.id), event);
      latestHandoffByTicket.set(event.ticket_id, event);
    }
    if (event.kind === 'handoff_accepted') {
      const preparedId = Number(event.prepared_event_id);
      const prepared = handoffsById.get(preparedId);
      const recipientMemberId = Number(prepared?.recipient_member_id || 0);
      const acceptedAt = Date.parse(event.created_at || '');
      const preparedAt = Date.parse(prepared?.created_at || '');
      if (
        prepared && prepared.ticket_id === event.ticket_id
        && recipientMemberId > 0
        && Number(event.actor_member_id) === recipientMemberId
        && Number(event.recipient_member_id) === recipientMemberId
        && Number.isFinite(acceptedAt) && Number.isFinite(preparedAt) && acceptedAt >= preparedAt
        && !acceptedHandoffs.has(preparedId)
      ) {
        acceptedHandoffs.add(preparedId);
        handoffWaitMinutes.push((acceptedAt - preparedAt) / 60_000);
      }
    }
  }

  let pendingHandoffCount = 0;
  for (const [ticketId, prepared] of latestHandoffByTicket) {
    const ticket = ticketById.get(ticketId);
    const recipientMemberId = Number(prepared.recipient_member_id || 0);
    const lastAssigneeChange = latestAssigneeEventByTicket.get(ticketId);
    const lastStatusChange = latestStatusEventByTicket.get(ticketId);
    if (
      ticket && ticket.status !== 'resolved'
      && recipientMemberId > 0
      && Number(ticket.assignee_id) === recipientMemberId
      && (!lastAssigneeChange || Number(lastAssigneeChange.id) < Number(prepared.id))
      && (!lastStatusChange || Number(lastStatusChange.id) < Number(prepared.id))
      && !acceptedHandoffs.has(Number(prepared.id))
    ) pendingHandoffCount += 1;
  }

  // Count the sources actually returned to the organization run, including both
  // knowledge cards and resolved-ticket cases. knowledge_uses only tracks cards.
  const crossTaskUses = runs.flatMap((run) => {
    const usedTicket = ticketById.get(run.ticket_id);
    if (!usedTicket || usedTicket.scope === 'sample') return [];
    const citations = new Set((run.output?.citations || []).map((citation) => citation.ref));
    return (run.context_sources || [])
      .filter((source) => ['card', 'case'].includes(source.type))
      .map((source) => {
        const sourceTicketId = source.type === 'case'
          ? source.id
          : (source.meta?.sourceTicketId || null);
        const sourceTicket = sourceTicketId ? ticketById.get(sourceTicketId) : null;
        if (source.meta?.scope === 'sample' || (sourceTicketId && (!sourceTicket || sourceTicket.scope === 'sample'))) return null;
        if (sourceTicketId && sourceTicketId === run.ticket_id) return null;
        const sourceRef = source.ref || `${source.type === 'card' ? 'K' : 'C'}${source.id}`;
        return {
          sourceType: source.type,
          sourceId: source.id,
          sourceRef,
          sourceTitle: source.title,
          sourceTicketId,
          usedInTicketId: run.ticket_id,
          usedInTicketTitle: usedTicket.title,
          runId: run.id,
          createdAt: run.created_at,
          cited: citations.has(sourceRef),
        };
      })
      .filter(Boolean);
  }).sort((a, b) => Number(b.runId) - Number(a.runId));

  const resolvedTickets = tickets.filter((ticket) => ticket.status === 'resolved');
  const outcomeRecorded = resolvedTickets.filter((ticket) => Boolean(String(ticket.outcome_note || '').trim()));
  const resolutionCycles = resolvedTickets.map((ticket) => {
    const createdAt = Date.parse(ticket.created_at || '');
    const resolvedAt = Date.parse(ticket.resolved_at || '');
    if (!Number.isFinite(createdAt) || !Number.isFinite(resolvedAt) || resolvedAt < createdAt) return null;
    return (resolvedAt - createdAt) / 60_000;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(resolutionCycles.length / 2);
  const resolutionCycleMedianMinutes = resolutionCycles.length === 0
    ? null
    : resolutionCycles.length % 2 === 0
      ? (resolutionCycles[middle - 1] + resolutionCycles[middle]) / 2
      : resolutionCycles[middle];
  handoffWaitMinutes.sort((a, b) => a - b);
  const handoffMiddle = Math.floor(handoffWaitMinutes.length / 2);
  const handoffWaitMedianMinutes = handoffWaitMinutes.length === 0
    ? null
    : handoffWaitMinutes.length % 2 === 0
      ? (handoffWaitMinutes[handoffMiddle - 1] + handoffWaitMinutes[handoffMiddle]) / 2
      : handoffWaitMinutes[handoffMiddle];
  const humanReviewedRuns = runs.filter((run) => latestReviewByRun.get(run.id)?.review_source_type === 'human');
  const reviewedRuns = runs.filter((run) => Boolean(latestReviewByRun.get(run.id)));
  const dates = tickets.map((ticket) => ticket.created_at).filter(Boolean).sort();
  const recentTickets = [...tickets]
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 30)
    .map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      outcome: ticket.outcome || '',
      outcomeNote: ticket.outcome_note || '',
      updatedAt: ticket.updated_at,
    }));

  return {
    generatedAt: new Date().toISOString(),
    period: { from: dates[0] || null, to: dates.at(-1) || null },
    summary: {
      tickets: tickets.length,
      openTickets: tickets.filter((ticket) => ['open', 'reopened'].includes(ticket.status)).length,
      inProgressTickets: tickets.filter((ticket) => ['in_progress', 'escalated'].includes(ticket.status)).length,
      resolvedTickets: resolvedTickets.length,
      outcomeRecorded: outcomeRecorded.length,
      resolutionCycleCount: resolutionCycles.length,
      resolutionCycleMedianMinutes,
      organizationRuns: runs.length,
      reviewedRuns: reviewedRuns.length,
      humanReviewedRuns: humanReviewedRuns.length,
      publishedKnowledge: publishedCards.length,
      pendingKnowledge: pendingCards.length,
      expiredKnowledge: expiredCards.length,
      ticketsEverReopened: ticketsReopened.size,
      ticketsEverEscalated: ticketsEscalated.size,
      pendingHandoffs: pendingHandoffCount,
      handoffWaitCount: handoffWaitMinutes.length,
      handoffWaitMedianMinutes,
      crossTaskRetrievals: crossTaskUses.length,
      crossTaskCitations: crossTaskUses.filter((use) => use.cited).length,
    },
    crossTaskUses: crossTaskUses.slice(0, 100),
    recentTickets,
  };
}
