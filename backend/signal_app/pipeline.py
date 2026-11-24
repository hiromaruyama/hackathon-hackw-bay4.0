from collections import defaultdict

from .models import FunnelGroup, Lead, PipelineEvent, PipelineStage


PIPELINE_STAGES: tuple[PipelineStage, ...] = ('matched', 'contacted', 'replied', 'meeting_booked', 'closed_lost')


def funnel_analytics(leads: list[Lead], events: list[PipelineEvent]) -> dict[str, list[FunnelGroup]]:
    reached: dict[str, set[PipelineStage]] = defaultdict(set)
    for event in events:
        reached[event.account_id].update((event.from_stage, event.to_stage))

    groups: dict[str, dict[str, dict[PipelineStage, int]]] = {
        'industry': {}, 'tier': {}, 'message_variant': {}, 'channel': {}, 'value_proposition': {},
    }
    for lead in leads:
        stages = reached[lead.account_id] | {'matched', lead.stage}
        for dimension, labels in groups.items():
            label = getattr(lead, dimension)
            # A lead enters a variant cohort after its first confirmed send.
            if dimension in ('message_variant', 'channel', 'value_proposition') and not label:
                continue
            counts = labels.setdefault(label or 'Unknown', dict.fromkeys(PIPELINE_STAGES, 0))
            for stage in stages:
                counts[stage] += 1

    return {
        dimension: [FunnelGroup(label=label, reached=counts) for label, counts in sorted(labels.items())]
        for dimension, labels in groups.items()
    }
