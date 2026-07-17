import { describe, expect, it } from 'vitest';
import { APPOS_FEISHU_TABLES, parseFeishuTableMap, resolveFeishuTableId } from '../../src/appos/feishu/base-tables.js';

describe('Feishu Base table resolution', () => {
  it('resolves default AppOS logical names to stable table IDs', () => {
    expect(resolveFeishuTableId('CPSProducts', undefined)).toBe('tbl18D4jhOy76S8d');
    expect(resolveFeishuTableId('PublishRecords', undefined)).toBe('tblAThebEIdZnWnm');
  });

  it('resolves Chinese display names after Base tables are renamed', () => {
    expect(resolveFeishuTableId('CPS商品', undefined)).toBe('tbl18D4jhOy76S8d');
    expect(resolveFeishuTableId('发布记录', undefined)).toBe('tblAThebEIdZnWnm');
  });

  it('defines CPS matrix table display aliases for Feishu Base users', () => {
    expect(APPOS_FEISHU_TABLES.CloakProfiles.displayName).toBe('Profile资产');
    expect(APPOS_FEISHU_TABLES.PlatformAccounts.displayName).toBe('平台账号');
    expect(APPOS_FEISHU_TABLES.MediaAnalyses.displayName).toBe('媒体分析');
    expect(APPOS_FEISHU_TABLES.EditingVersions.displayName).toBe('剪辑版本');
    expect(APPOS_FEISHU_TABLES.PublishRecords.displayName).toBe('发布记录');
  });

  it('resolves new CPS matrix tables from environment maps before live Base tables exist', () => {
    const raw = JSON.stringify({
      CloakProfiles: 'tbl_cloak',
      MediaAnalyses: 'tbl_media',
      EditingVersions: 'tbl_editing'
    });

    expect(resolveFeishuTableId('CloakProfiles', raw)).toBe('tbl_cloak');
    expect(resolveFeishuTableId('MediaAnalyses', raw)).toBe('tbl_media');
    expect(resolveFeishuTableId('EditingVersions', raw)).toBe('tbl_editing');
  });

  it('keeps direct table IDs unchanged', () => {
    expect(resolveFeishuTableId('tbl_custom')).toBe('tbl_custom');
  });

  it('accepts legacy flat environment table maps', () => {
    const raw = JSON.stringify({ CPSProducts: 'tbl_legacy' });

    expect(parseFeishuTableMap(raw)).toEqual({ CPSProducts: 'tbl_legacy' });
    expect(resolveFeishuTableId('CPSProducts', raw)).toBe('tbl_legacy');
  });

  it('accepts structured table maps with ids and display names', () => {
    const raw = JSON.stringify({
      tables: {
        CPSProducts: { id: 'tbl_structured', displayName: 'CPS商品' }
      }
    });

    expect(parseFeishuTableMap(raw)).toEqual({ CPSProducts: 'tbl_structured' });
    expect(resolveFeishuTableId('CPSProducts', raw)).toBe('tbl_structured');
  });
});
