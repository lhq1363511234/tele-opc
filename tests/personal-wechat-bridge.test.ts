import { describe,expect,it } from 'vitest';
import { hashToken } from '../src/channels/personal-wechat/store.js';

describe('personal WeChat bridge device auth',()=>{
 it('hashes tokens deterministically without preserving plaintext',()=>{
  const token='brg_example-device-secret';
  expect(hashToken(token)).toBe(hashToken(token));
  expect(hashToken(token)).not.toContain(token);
  expect(hashToken(token)).toHaveLength(64);
 });
});
