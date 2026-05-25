import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import type { LlmClient } from './llm.client.js';
import type { Logger } from '../utils/logger.js';
import type { EventsRepository } from '../db/events.repo.js';
import type { ClustersRepository } from '../db/clusters.repo.js';
import type { PersistedEvent } from '../types/event.js';

const CLUSTER_LOOKBACK_HOURS = 24;
const CLUSTER_CANDIDATE_LIMIT = 50;
const CLUSTER_REPRESENTATIVE_LIMIT = 5;

export type ClusterDecision =
  | { kind: 'new'; clusterId: number; role: 'primary' }
  | { kind: 'merged'; clusterId: number; role: 'secondary'; topicSummary: string | null };

interface ClusterDeps {
  llm: LlmClient;
  eventsRepo: EventsRepository;
  clustersRepo: ClustersRepository;
  logger: Logger;
}

interface JudgeResponse {
  matchedClusterId: number | null;
  isNewTopic: boolean;
  mergedTopicSummary: string | null;
}

export class ClusterService {
  constructor(private readonly deps: ClusterDeps) {}

  async assign(event: PersistedEvent): Promise<ClusterDecision> {
    if (!event.affectedAssets || event.affectedAssets.length === 0) {
      // No assets to cross-correlate on: treat as its own cluster.
      return this.createNew(event);
    }

    const candidates = await this.deps.eventsRepo.findRecentRefinedForClustering({
      affectedAssets: event.affectedAssets,
      category: event.category,
      sinceHours: CLUSTER_LOOKBACK_HOURS,
      excludeId: event.id,
      limit: CLUSTER_CANDIDATE_LIMIT
    });

    const withCluster = candidates.filter((c) => c.clusterId !== null);
    if (withCluster.length === 0) {
      return this.createNew(event);
    }

    // Group by clusterId, pick representative per cluster (most recent refined first).
    const byCluster = new Map<number, typeof withCluster>();
    for (const candidate of withCluster) {
      const list = byCluster.get(candidate.clusterId!) ?? [];
      list.push(candidate);
      byCluster.set(candidate.clusterId!, list);
    }

    const representatives = [...byCluster.entries()]
      .map(([clusterId, members]) => ({
        clusterId,
        member: members[0]
      }))
      .slice(0, CLUSTER_REPRESENTATIVE_LIMIT);

    let judgment: JudgeResponse | null = null;
    try {
      judgment = await this.judge(event, representatives);
    } catch (error) {
      this.deps.logger.warn('Cluster LLM judgment failed', { eventId: event.id, error });
    }

    if (judgment && judgment.matchedClusterId !== null) {
      const matched = representatives.find((rep) => rep.clusterId === judgment!.matchedClusterId);
      if (matched) {
        await this.deps.clustersRepo.touch(matched.clusterId, new Date(), judgment.mergedTopicSummary);
        await this.deps.eventsRepo.assignCluster(event.id, matched.clusterId, 'secondary');
        return {
          kind: 'merged',
          clusterId: matched.clusterId,
          role: 'secondary',
          topicSummary: judgment.mergedTopicSummary
        };
      }
    }

    return this.createNew(event);
  }

  private async createNew(event: PersistedEvent): Promise<ClusterDecision> {
    const cluster = await this.deps.clustersRepo.createForEvent({
      eventId: event.id,
      topicSummary: event.tldr,
      seenAt: new Date()
    });
    await this.deps.eventsRepo.assignCluster(event.id, cluster.id, 'primary');
    return { kind: 'new', clusterId: cluster.id, role: 'primary' };
  }

  private async judge(
    event: PersistedEvent,
    representatives: Array<{ clusterId: number; member: { id: number; title: string; tldr: string | null } }>
  ): Promise<JudgeResponse | null> {
    const candidatesText = representatives
      .map((rep, index) => `${index + 1}. {cluster_id=${rep.clusterId}} ${rep.member.title} | ${rep.member.tldr ?? '(无 tldr)'}`)
      .join('\n');

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是新闻聚类助手。判断"新事件"和候选事件中是否描述同一件事。
仅当你高度确信描述同一具体事件（同一公司/资产/时间窗口/动作）才匹配；同一话题不同事件不算匹配。
输出严格 JSON：
{
  "matched_cluster_id": <数字或 null>,
  "is_new_topic": true|false,
  "merged_topic_summary": "如果匹配，给一句 <=40 字的统一标题；否则填 null"
}`
      },
      {
        role: 'user',
        content: `新事件：${event.title} | ${event.tldr ?? '(无 tldr)'}
候选：
${candidatesText}`
      }
    ];

    const result = await this.deps.llm.chat(messages, { json: true, temperature: 0.0, maxTokens: 200 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const matched = typeof obj.matched_cluster_id === 'number' ? obj.matched_cluster_id : null;
    const summary = typeof obj.merged_topic_summary === 'string' ? obj.merged_topic_summary : null;
    return {
      matchedClusterId: matched,
      isNewTopic: typeof obj.is_new_topic === 'boolean' ? obj.is_new_topic : matched === null,
      mergedTopicSummary: summary
    };
  }
}
