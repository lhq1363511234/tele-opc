import { describe, expect, it } from 'vitest';
import {
  buildMoboboostDifyPayload,
  buildMoboboostFeishuBatchPayloads,
  normalizeMoboboostResults
} from '../../src/appos/domains/cps/moboboost.js';

describe('MoboBoost CPS normalization', () => {
  it('normalizes content-center drama cards into AppOS CPS records', () => {
    const [task] = normalizeMoboboostResults([
      {
        dramaId: '51447322',
        title: 'The Lost Heiress Came Back',
        platform: 'MoboReels',
        language: '英语',
        dramaType: '原声剧',
        commissionRate: '分佣比例:40%',
        coverImageUrl: 'https://g.cdreader.com/covers/lost.jpg',
        shortDramaLink: 'https://eng.moboreels.com/VTMBi/DVET',
        appLink: 'https://eng.moboreels.com/video/DVET',
        description: 'After being adopted as a cash cow for twenty years.',
        materialActions: ['生成推广资源', '复制网盘地址', '原片下载', '素材下载']
      }
    ]);

    expect(task?.source).toBe('moboboost');
    expect(task?.productId).toBe('cps_moboboost_moboreels_51447322');
    expect(task?.taskId).toBe('51447322');
    expect(task?.name).toBe('The Lost Heiress Came Back');
    expect(task?.platform).toBe('MoboReels');
    expect(task?.commissionRate).toBe(0.4);
    expect(task?.promoLinks.moboreels).toEqual({
      serial: 'https://eng.moboreels.com/VTMBi/DVET',
      app: 'https://eng.moboreels.com/video/DVET',
      copy: 'After being adopted as a cash cow for twenty years.'
    });
    expect(task?.downloadTasks).toContainEqual({
      action: '素材下载',
      status: 'pending_browser_confirmation'
    });
  });

  it('builds Feishu and Dify payloads that identify the MoboBoost source', () => {
    const tasks = normalizeMoboboostResults([
      {
        dramaId: '46506322',
        title: "The Prince Is A Girl: The Beast King's Captive Mate",
        platform: 'MoboReels',
        language: '英语',
        commissionRate: '40%',
        coverImageUrl: 'https://g.cdreader.com/covers/prince.jpg',
        shortDramaLink: 'https://eng.moboreels.com/VTMBi/PRINCE',
        appLink: 'https://eng.moboreels.com/video/PRINCE'
      }
    ]);

    const feishu = buildMoboboostFeishuBatchPayloads(tasks, new Date('2026-06-26T10:00:00+08:00'));
    const productFields = feishu.CPSProducts.fields;
    const productRow = feishu.CPSProducts.rows[0] ?? [];
    const sourceMaterials = feishu.SourceMaterials.rows;
    const publishRow = feishu.PublishRecords.rows[0] ?? [];

    expect(productRow[productFields.indexOf('id')]).toBe('cps_moboboost_moboreels_46506322');
    expect(productRow[productFields.indexOf('name')]).toContain('The Prince Is A Girl');
    expect(productRow[productFields.indexOf('core_selling_points')]).toContain('MoboBoost');
    expect(productFields).toEqual(
      expect.arrayContaining([
        'source_platform',
        'source_site_name',
        'drama_id',
        'source_task_id',
        'title_en',
        '短剧类型',
        '短剧推广链接',
        'App推广链接',
        '数据原文'
      ])
    );
    expect(productRow[productFields.indexOf('source_platform')]).toBe('moboboost');
    expect(productRow[productFields.indexOf('source_site_name')]).toBe('MoboBoost/CDReader');
    expect(productRow[productFields.indexOf('短剧推广链接')]).toBe('https://eng.moboreels.com/VTMBi/PRINCE');
    expect(productRow[productFields.indexOf('App推广链接')]).toBe('https://eng.moboreels.com/video/PRINCE');
    expect(feishu.SourceMaterials.fields).toEqual(
      expect.arrayContaining(['source_platform', 'source_site_name', 'drama_id', '素材角色', '素材动作', '远程链接', '网盘链接'])
    );
    expect(sourceMaterials.some((row) => String(row).includes('cover'))).toBe(true);
    expect(sourceMaterials.some((row) => String(row).includes('封面'))).toBe(true);
    expect(feishu.PublishRecords.fields).toEqual(
      expect.arrayContaining(['source_platform', 'source_site_name', 'drama_id', 'promo_platform', 'publish_status', '短剧推广链接', 'APP推广链接'])
    );
    expect(String(publishRow)).toContain('moboboost');

    const dify = buildMoboboostDifyPayload(tasks, { operator: 'opctoai', editBriefPath: 'D:/剪辑思路.txt' });
    expect(dify.source).toBe('moboboost');
    expect(dify.tasks[0]?.sourcePlatform).toBe('MoboBoost/CDReader');
    expect(dify.tasks[0]?.requiredOutput).toContain('edit_plan');
  });
});
