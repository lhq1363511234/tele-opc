import type { BusinessContract } from '../../contracts/types.js';
import type { ContentPostStatus, DifyContentMatrixOutput } from './content-types.js';

export function createContentMatrixFromContract(contract: BusinessContract, output: DifyContentMatrixOutput) {
  const campaign = {
    id: `camp_${contract.id}`,
    contractId: contract.id,
    name: output.campaign.name,
    objective: output.campaign.objective,
    platforms: output.posts.map((post) => post.platform),
    status: 'reviewing' as const
  };

  const posts = output.posts.map((post, index) => ({
    id: `post_${contract.id}_${String(index + 1).padStart(2, '0')}`,
    campaignId: campaign.id,
    platform: post.platform,
    title: post.title,
    script: post.script,
    caption: post.caption,
    tags: post.tags,
    status: 'reviewing' as const
  }));

  const approvals = posts.map((post) => ({
    id: `appr_${post.id}`,
    objectType: 'content_post' as const,
    objectId: post.id,
    action: 'approve_content_post_before_video_or_publish',
    riskLevel: contract.riskLevel,
    status: 'requested' as const,
    reason: 'Content matrix posts require owner review before video generation or publishing'
  }));

  return { campaign, posts, approvals };
}

export function canGenerateCapcutDraft(post: { status: ContentPostStatus }) {
  return post.status === 'approved';
}
