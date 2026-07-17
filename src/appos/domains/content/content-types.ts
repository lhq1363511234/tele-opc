export type ContentPlatform = 'douyin' | 'xiaohongshu' | 'kuaishou' | 'shipinhao' | 'wechat_mp' | 'bilibili' | 'other';

export type ContentPostStatus =
  | 'planned'
  | 'drafted'
  | 'reviewing'
  | 'approved'
  | 'video_ready'
  | 'published'
  | 'failed'
  | 'cancelled';

export type DifyContentMatrixOutput = {
  campaign: {
    name: string;
    objective: string;
  };
  posts: Array<{
    platform: ContentPlatform;
    title: string;
    script: string;
    caption: string;
    tags: string[];
  }>;
};
